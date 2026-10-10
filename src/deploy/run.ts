// src/deploy/run.ts
// Deploy lifecycle over the Store: startDeploy (pending → building | error) and pollDeployments (building → ready | error, owner notifications).
import { copy } from "../bot/copy";
import type { Messenger } from "../bot/messenger";
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
 * No-op when the venue is not live or already has a deployment that is not in error. Never throws.
 */
export async function startDeploy(d: StartDeployDeps, venueId: string): Promise<void> {
  const log = d.log ?? ((s: string) => console.log(s));
  try {
    const venue = await d.store.getVenue(venueId);
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
    await d.store.setDeploy(venueId, base);
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

/** Checks venues with deploy.status pending|building (max POLL_MAX), 20-minute timeout → error; notifies owners on ready/error. */
export async function pollDeployments(d: PollDeps): Promise<{ ready: string[]; failed: string[] }> {
  const report = { ready: [] as string[], failed: [] as string[] };
  const venues = (await d.store.listVenues({ deploying: true })).filter((v) => !d.venueId || v.id === d.venueId).slice(0, POLL_MAX);
  for (const v of venues) {
    const dep = v.deploy;
    if (!dep) continue;
    const now = d.now();
    let result: DeployStatusResult;
    if (now.getTime() - Date.parse(dep.updated_at) > DEPLOY_TIMEOUT_MS) {
      result = { state: "error", url: null, error: "timeout: no result after 20 minutes" };
    } else if (!dep.deployment_id) {
      continue; // createSite still running in another request; the timeout above catches a lost one
    } else {
      try {
        result = await d.deployer.status(dep.deployment_id);
      } catch (e) {
        console.error(`[deploy] status ${v.slug} failed:`, short(e));
        continue; // transient: next tick retries
      }
    }
    if (result.state === "ready") {
      const url = result.url ?? dep.url;
      await d.store.setDeploy(v.id, { ...dep, status: "ready", url, error: null, updated_at: now.toISOString() });
      report.ready.push(v.id);
      await notify(d, v, (lang) => copy(lang).siteLive(v.name, url ?? ""));
    } else if (result.state === "error") {
      await d.store.setDeploy(v.id, { ...dep, status: "error", error: mask(result.error ?? "error").slice(0, ERROR_MAX), updated_at: now.toISOString() });
      report.failed.push(v.id);
      await notify(d, v, (lang) => copy(lang).siteFailed(v.name));
    } else if (result.state !== dep.status) {
      await d.store.setDeploy(v.id, { ...dep, status: result.state, updated_at: now.toISOString() });
    }
  }
  return report;
}

async function notify(d: PollDeps, venue: Venue, text: (lang: Lang) => string): Promise<void> {
  if (!d.messenger) return;
  for (const m of await d.store.listMembers(venue.id)) {
    if (m.role !== "owner") continue;
    try {
      await d.messenger.send(m.tg_chat_id, text(m.lang));
    } catch (e) {
      console.error(`[deploy] notify ${venue.slug} chat ${m.tg_chat_id} failed:`, short(e));
    }
  }
}
