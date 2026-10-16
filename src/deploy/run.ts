// src/deploy/run.ts
// Deploy lifecycle over the Store: startDeploy (pending → building | error) and pollDeployments (building → ready | error, owner notifications).
import { copy } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
import { maskRef } from "../channels/ref";
import { baseLang } from "../domain/format";
import type { DeployInfo, Lang, Venue } from "../domain/types";
import type { Store } from "../store/types";
import type { Deployer, DeployInput, DeployStatusResult } from "./types";

export const DEPLOY_TIMEOUT_MS = 20 * 60_000;
/** Deployments checked per tick. */
export const POLL_MAX = 10;
const ERROR_MAX = 2000;

/** Masks any bearer token fragment that leaked into an error message. */
const mask = (s: string) => s.replace(/Bearer\s+\S+/gi, "Bearer …");
/** Short, secret-free message for deploy.error and logs. */
function short(e: unknown): string {
  return mask(e instanceof Error ? e.message : String(e)).slice(0, 300);
}

export interface StartDeployDeps {
  store: Store;
  deployer: Deployer;
  feedUrlFor: (slug: string) => string;
  now: () => Date;
  log?: (s: string) => void;
}

/**
 * Creates the venue's site (or redeploys into its existing project after an error). Sets deploy to pending, then building or error.
 * No-op when the venue has its own site (site_url), is not live, or already has a deployment that is not in error. Never throws.
 */
export async function startDeploy(d: StartDeployDeps, venueId: string): Promise<void> {
  const log = d.log ?? ((s: string) => console.log(s));
  try {
    const venue = await d.store.getVenue(venueId);
    // Own site (built and hosted elsewhere, reads our feed): never create a provider project for it.
    if (venue.site_url) {
      log(`[deploy] ${venue.slug}: own site, skipped`);
      return;
    }
    if (venue.status !== "live") {
      log(`[deploy] ${venue.slug}: not live, skipped`);
      return;
    }
    if (venue.deploy && venue.deploy.status !== "error") {
      log(`[deploy] ${venue.slug}: already ${venue.deploy.status}, skipped`);
      return;
    }
    const projectId = venue.deploy?.project_id || "";
    const base: DeployInfo = {
      provider: d.deployer.provider,
      project_id: projectId,
      deployment_id: "",
      url: venue.deploy?.url ?? null,
      status: "pending",
      error: null,
      template: venue.template,
      updated_at: d.now().toISOString(),
    };
    // The claim is the only gate that holds under concurrency (two /start webhooks, a tick and a /start): one caller wins pending.
    if (!(await d.store.claimDeploy(venueId, base, { whenStatusIn: [null, "error"] }))) {
      log(`[deploy] ${venue.slug}: another request is deploying, skipped`);
      return;
    }
    const input: DeployInput = { slug: venue.slug, templateId: venue.template, feedUrl: d.feedUrlFor(venue.slug) };
    try {
      const r = projectId ? { projectId, ...(await d.deployer.redeploy(projectId, input)) } : await d.deployer.createSite(input);
      await d.store.setDeploy(venueId, { ...base, project_id: r.projectId, deployment_id: r.deploymentId, status: "building", updated_at: d.now().toISOString() });
      log(`[deploy] ${venue.slug}: building (${d.deployer.provider} ${r.deploymentId})`);
    } catch (e) {
      await d.store.setDeploy(venueId, { ...base, status: "error", error: short(e), updated_at: d.now().toISOString() });
      log(`[deploy] ${venue.slug}: failed: ${short(e)}`);
    }
  } catch (e) {
    log(`[deploy] ${venueId}: ${short(e)}`);
  }
}

export interface PollDeps {
  store: Store;
  deployer: Deployer;
  messenger: Messenger | null;
  now: () => Date;
  venueId?: string;
}

const inFlight = (dep: DeployInfo | null) => dep?.status === "pending" || dep?.status === "building";

/**
 * Checks venues with deploy.status pending|building (max POLL_MAX). The provider is asked first; the 20-minute timeout
 * applies only when the answer is still pending/building (or there is no deployment id / the provider cannot be reached).
 * Ready/error are written through claimDeploy with the polled deployment id, so a result lands only once (one owner
 * message however many pollers run) and never on a newer deployment. A ready redeploy (the record already had a URL
 * from an earlier ready deploy) gets the short "new design is live" message; the first one gets the full "site is live".
 */
export async function pollDeployments(d: PollDeps): Promise<{ ready: string[]; failed: string[] }> {
  const report = { ready: [] as string[], failed: [] as string[] };
  const venues = (await d.store.listVenues({ deploying: true })).filter((v) => !d.venueId || v.id === d.venueId).slice(0, POLL_MAX);
  for (const v of venues) {
    const dep = v.deploy;
    if (!dep || !inFlight(dep)) continue;
    const now = d.now();
    const timedOut = now.getTime() - Date.parse(dep.updated_at) > DEPLOY_TIMEOUT_MS;
    let result: DeployStatusResult | null = null;
    if (dep.deployment_id) {
      try {
        result = await d.deployer.status(dep.deployment_id);
      } catch (e) {
        console.error(`[deploy] status ${v.slug} failed:`, short(e));
        if (!timedOut) continue; // transient: next poll retries
      }
    }
    if (!result || result.state === "pending" || result.state === "building") {
      // No deployment id yet means createSite is still running in another request; the timeout catches a lost one.
      if (timedOut) result = { state: "error", url: null, error: "timeout: no result after 20 minutes" };
      else if (!result) continue;
    }
    const claim = (next: DeployInfo) => d.store.claimDeploy(v.id, next, { whenStatusIn: ["pending", "building"], whenDeploymentId: dep.deployment_id });
    const updated_at = now.toISOString();
    if (result.state === "ready") {
      const url = result.url ?? dep.url;
      const redeploy = dep.url !== null;
      if (!(await claim({ ...dep, status: "ready", url, error: null, updated_at }))) continue;
      report.ready.push(v.id);
      await notify(d, v, (lang) => (redeploy ? copy(lang).designLive(url ?? "") : copy(lang).siteLive(v.name, url ?? "")));
    } else if (result.state === "error") {
      if (!(await claim({ ...dep, status: "error", error: mask(result.error ?? "error").slice(0, ERROR_MAX), updated_at }))) continue;
      report.failed.push(v.id);
      await notify(d, v, (lang) => copy(lang).siteFailed(v.name));
    } else if (result.state !== dep.status) {
      await claim({ ...dep, status: result.state, updated_at });
    }
  }
  return report;
}

/** Background watch after a deploy starts: one poll every WATCH_INTERVAL_MS, at most WATCH_MAX_MS (fits a 300 s function). */
export const WATCH_INTERVAL_MS = 10_000;
export const WATCH_MAX_MS = 240_000;

/**
 * Polls one venue's deployment until it is ready/error or WATCH_MAX_MS has passed, so completion (and the owner's Telegram
 * message) never depends on an open tab. Runs inside after(); the 5-minute cron and the page nudges cover anything longer.
 * Never throws.
 */
export async function watchDeploy(d: Omit<PollDeps, "venueId"> & { sleep?: (ms: number) => Promise<void>; log?: (s: string) => void }, venueId: string): Promise<void> {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    // Bounded by both the iteration count and a wall clock: a slow provider call must not carry the job past the function's maxDuration.
    const deadline = Date.now() + WATCH_MAX_MS;
    for (let waited = 0; waited + WATCH_INTERVAL_MS <= WATCH_MAX_MS && Date.now() + WATCH_INTERVAL_MS <= deadline; waited += WATCH_INTERVAL_MS) {
      if (!inFlight((await d.store.getVenue(venueId)).deploy)) return;
      await sleep(WATCH_INTERVAL_MS);
      await pollDeployments({ store: d.store, deployer: d.deployer, messenger: d.messenger, now: d.now, venueId });
    }
  } catch (e) {
    (d.log ?? ((s: string) => console.log(s)))(`[deploy] watch ${venueId}: ${short(e)}`);
  }
}

async function notify(d: PollDeps, venue: Venue, text: (lang: Lang) => string): Promise<void> {
  if (!d.messenger) return;
  for (const m of await d.store.listMembers(venue.id)) {
    if (m.role !== "owner") continue;
    try {
      await d.messenger.send(m.chat_ref, text(baseLang(m.lang)), { proactive: true });
    } catch (e) {
      console.error(`[deploy] notify ${venue.slug} chat ${maskRef(m.chat_ref)} failed:`, short(e));
    }
  }
}
