// src/server/admin.ts
import type { Messenger } from "../bot/messenger";
import { invertChanges } from "../domain/changes";
import { isSoldOut } from "../domain/effective";
import { renderPreview } from "../domain/preview";
import { TEMPLATE_IDS, type ChangeSet, type DeployInfo, type TemplateId, type Venue, type VenueStatus } from "../domain/types";
import type { Deployer, DeployInput, DomainInstructions } from "../deploy/types";
import { normalizeDomain } from "../deploy/vercel-domains";
import type { DestinationStatus, Store, SyncStatus } from "../store/types";
import { formatDateTime } from "../time";

export interface AdminOverview {
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
  template: TemplateId;
  status: VenueStatus;
  /** True when this server has no deployer (no VERCEL_TOKEN): the hosted /<slug> is the site; no deploy record, no custom domain. */
  hosted: boolean;
  /** Always null when `hosted`. */
  deploy: DeployInfo | null;
  /** The provider URL when the deploy is ready, otherwise our hosted copy. */
  site_url: string;
  /** Custom domain attached to the deploy (Pro), and whether the provider confirmed its DNS at the last check. */
  custom_domain: string | null;
  domain_verified: boolean | null;
  pending: ChangeSet[];
  scheduled: ChangeSet[];
  log: ChangeSet[];
  sold_out: { id: string; name_bg: string; name_en: string; sold_out_until: string }[];
  wordpress?: WordPressOverview | null;
}

export async function adminOverview(store: Store, venue: Venue, now: Date, baseUrl = "", opts: { hosted?: boolean } = {}): Promise<AdminOverview> {
  const [pending, scheduled, log, site] = await Promise.all([
    store.listChangeSets(venue.id, { status: ["proposed"], limit: 20 }),
    store.listChangeSets(venue.id, { status: ["scheduled"], limit: 50 }),
    store.listChangeSets(venue.id, { status: ["applied", "reverted", "rejected", "expired", "cancelled"], limit: 50 }),
    store.getSite(venue.id),
  ]);
  const nowMs = now.getTime();
  const hosted = opts.hosted ?? false;
  // In hosted mode a deploy record left from an earlier setup means nothing: no provider is reachable from this server.
  const deploy = hosted ? null : venue.deploy;
  return {
    venue: { id: venue.id, slug: venue.slug, name: venue.name, tz: venue.tz, default_lang: venue.default_lang },
    now: now.toISOString(),
    public_url: `${baseUrl}/${venue.slug}`,
    template: venue.template,
    status: venue.status,
    hosted,
    deploy,
    site_url: deploy?.status === "ready" && deploy.url ? deploy.url : `${baseUrl}/${venue.slug}`,
    custom_domain: deploy?.custom_domain ?? null,
    domain_verified: deploy?.custom_domain ? (deploy.domain_verified ?? false) : null,
    pending,
    scheduled: [...scheduled].sort((a, b) => (a.apply_at ?? "").localeCompare(b.apply_at ?? "")),
    log,
    sold_out: site.items.filter((i) => i.active && isSoldOut(i, nowMs)).map((i) => ({ id: i.id, name_bg: i.name_bg, name_en: i.name_en, sold_out_until: i.sold_out_until as string })),
    wordpress: await wordPressOverview(store, venue.id),
  };
}

export type AdminActionName = "apply" | "reject" | "cancel" | "undo";
export interface AdminDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  baseUrl: string;
}

async function editTelegram(d: AdminDeps, cs: ChangeSet, mark: { bg: string; en: string }) {
  if (cs.chat_id === null || cs.tg_message_id === null) return;
  const member = await d.store.findMember(cs.chat_id);
  const lang = member?.lang ?? "bg";
  await d.messenger.edit(cs.chat_id, cs.tg_message_id, `${lang === "bg" ? cs.preview_bg : cs.preview_en}\n\n${lang === "bg" ? mark.bg : mark.en}`);
}

/** The owner's dashboard decisions. The owner's key is the authority, so "apply" applies at once (or schedules a future apply_at). */
export async function adminAction(d: AdminDeps, venue: Venue, action: AdminActionName, setId: string): Promise<{ ok: boolean; status?: string; change_set_id?: string; error?: string }> {
  let cs: ChangeSet;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { ok: false, error: "Change set not found." };
  }
  if (cs.venue_id !== venue.id) return { ok: false, error: "Change set not found." };
  const now = d.now();
  const nowIso = now.toISOString();
  if (action === "undo") {
    if (cs.status !== "applied") return { ok: false, error: `Change set is "${cs.status}".` };
    const site = await d.store.getSite(venue.id);
    const changes = invertChanges(cs.changes);
    const undo = await d.store.createChangeSet({
      venue_id: venue.id, chat_id: cs.chat_id, summary_bg: `Отмяна: ${cs.summary_bg}`, summary_en: `Undo: ${cs.summary_en}`,
      preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
      source: "undo", status: "proposed", undoes_id: cs.id, changes,
    });
    await d.store.applyChangeSet(undo.id, nowIso);
    if (cs.chat_id !== null) await d.messenger.send(cs.chat_id, (await d.store.findMember(cs.chat_id))?.lang === "en" ? `↩️ Reverted from the dashboard: ${cs.summary_en}` : `↩️ Отменено от таблото: ${cs.summary_bg}`);
    return { ok: true, status: "applied", change_set_id: undo.id };
  }
  if (action === "cancel") {
    if (cs.status !== "proposed" && cs.status !== "scheduled") return { ok: false, error: `Change set is "${cs.status}".` };
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: nowIso });
    await editTelegram(d, cs, { bg: "❌ Отказано от таблото.", en: "❌ Cancelled from the dashboard." });
    return { ok: true, status: "cancelled", change_set_id: cs.id };
  }
  if (cs.status !== "proposed") return { ok: false, error: `Change set is "${cs.status}".` };
  if (action === "reject") {
    await d.store.updateChangeSet(cs.id, { status: "rejected", decided_at: nowIso });
    await editTelegram(d, cs, { bg: "❌ Отхвърлено от таблото.", en: "❌ Rejected from the dashboard." });
    return { ok: true, status: "rejected", change_set_id: cs.id };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: nowIso });
    await editTelegram(d, cs, { bg: `⏰ Насрочено от таблото за ${formatDateTime(cs.apply_at, "bg", venue.tz)}`, en: `⏰ Scheduled from the dashboard for ${formatDateTime(cs.apply_at, "en", venue.tz)}` });
    return { ok: true, status: "scheduled", change_set_id: cs.id };
  }
  const r = await d.store.applyChangeSet(cs.id, nowIso);
  if (r === "skipped") return { ok: false, error: `Change set is "${(await d.store.getChangeSet(cs.id)).status}".` };
  await editTelegram(d, cs, { bg: "✅ Приложено от таблото.", en: "✅ Applied from the dashboard." });
  return { ok: true, status: "applied", change_set_id: cs.id };
}

// --- WordPress card (integrations track, appended 2026-10-10) ---
export interface WordPressOverview {
  site_url: string;
  site_name: string;
  status: DestinationStatus;
  connected_at: string | null;
  last_error: string | null;
  /** The last five pushes, newest first. */
  syncs: { id: string; change_set_id: string; status: SyncStatus; summary_bg: string; summary_en: string; updated_at: string; last_error: string | null }[];
}

/** Never includes secrets: it reads the destination row and drops everything but display fields. */
export async function wordPressOverview(store: Store, venueId: string): Promise<WordPressOverview | null> {
  const d = await store.getDestination(venueId, "wordpress");
  if (!d) return null;
  const all = (await store.listSyncs({ venueId })).filter((s) => s.destination_id === d.id);
  const last = all.slice(-5).reverse();
  const sets = await Promise.all(last.map((s) => store.getChangeSet(s.change_set_id).catch(() => null)));
  return {
    site_url: String(d.config.site_url ?? ""),
    site_name: String(d.config.site_name ?? ""),
    status: d.status,
    connected_at: typeof d.config.connected_at === "string" ? d.config.connected_at : null,
    last_error: d.last_error,
    syncs: last.map((s, i) => ({ id: s.id, change_set_id: s.change_set_id, status: s.status, summary_bg: sets[i]?.summary_bg ?? "", summary_en: sets[i]?.summary_en ?? "", updated_at: s.updated_at, last_error: s.last_error })),
  };
}

export type AdminSiteActionName = "set_template" | "add_domain" | "check_domain";
export interface AdminSiteDeps {
  store: Store;
  /** null on a server without VERCEL_TOKEN (hosted mode). */
  deployer: Deployer | null;
  feedUrlFor: (slug: string) => string;
  now: () => Date;
}
export type SetTemplateResult =
  | { ok: true; template: TemplateId; deploy: DeployInfo | null }
  | { ok: false; code: "unknown_template" | "busy"; error: string; bg: string; en: string };

const UNKNOWN_TEMPLATE: SetTemplateResult = { ok: false, code: "unknown_template", error: "Unknown template.", bg: "Непознат шаблон.", en: "Unknown template." };
const BUSY: SetTemplateResult = { ok: false, code: "busy", error: "The site is publishing right now.", bg: "Сайтът се публикува в момента. Опитайте след минута.", en: "The site is publishing right now. Try again in a minute." };

/**
 * Dashboard "Change template": updates the venue (our /[slug] switches at once) and, when the site is deployed, redeploys it
 * with the new template. Refuses while a deploy is pending/building; the redeploy is claimed through the store so two
 * concurrent switches cannot both start one. Never calls startDeploy.
 */
export async function setTemplate(d: AdminSiteDeps, venue: Venue, template: unknown): Promise<SetTemplateResult> {
  if (typeof template !== "string" || !(TEMPLATE_IDS as readonly string[]).includes(template)) return UNKNOWN_TEMPLATE;
  const id = template as TemplateId;
  const deploy = venue.deploy;
  // Hosted mode: the hosted /<slug> renders the venue's template, so the switch is just the venue field.
  if (!d.deployer) {
    await d.store.updateVenue(venue.id, { template: id });
    return { ok: true, template: id, deploy: null };
  }
  if (!deploy) {
    await d.store.updateVenue(venue.id, { template: id });
    return { ok: true, template: id, deploy: null };
  }
  if (deploy.status === "pending" || deploy.status === "building") return BUSY;
  const updated_at = d.now().toISOString();
  const claimed: DeployInfo = { ...deploy, deployment_id: "", status: "building", error: null, template: id, updated_at };
  if (!(await d.store.claimDeploy(venue.id, claimed, { whenStatusIn: ["ready", "error"] }))) return BUSY;
  await d.store.updateVenue(venue.id, { template: id });
  const input: DeployInput = { slug: venue.slug, templateId: id, feedUrl: d.feedUrlFor(venue.slug) };
  let next: DeployInfo;
  try {
    // An errored first deploy may have no project yet (createSite failed): create it now instead of redeploying into "".
    const r = deploy.project_id ? { projectId: deploy.project_id, ...(await d.deployer.redeploy(deploy.project_id, input)) } : await d.deployer.createSite(input);
    next = { ...claimed, project_id: r.projectId, deployment_id: r.deploymentId };
  } catch {
    next = { ...claimed, status: "error", error: "Redeploy could not start." }; // the provider message stays out of the stored record
  }
  await d.store.setDeploy(venue.id, next);
  return { ok: true, template: id, deploy: next };
}

export type DomainResult =
  | { ok: true; domain: string; instructions: DomainInstructions }
  | { ok: false; code: "invalid_domain" | "no_site" | "no_domain" | "busy" | "refused" | "provider" | "unavailable"; error: string; bg: string; en: string };

const INVALID_DOMAIN: DomainResult = { ok: false, code: "invalid_domain", error: "Invalid domain.", bg: "Това не прилича на домейн.", en: "That does not look like a domain name." };
const NO_SITE: DomainResult = { ok: false, code: "no_site", error: "Publish the site first.", bg: "Първо публикувайте сайта.", en: "Publish the site first." };
const NO_DOMAIN: DomainResult = { ok: false, code: "no_domain", error: "No domain connected.", bg: "Няма свързан домейн.", en: "No domain connected." };
const DOMAIN_BUSY: DomainResult = { ok: false, code: "busy", error: BUSY.error, bg: BUSY.bg, en: BUSY.en };
const DOMAIN_REFUSED: DomainResult = { ok: false, code: "refused", error: "The provider refused this domain.", bg: "Доставчикът отказа този домейн. Проверете дали не се използва от друг сайт.", en: "The provider refused this domain. Check that it is not used by another site." };
const DOMAIN_UNAVAILABLE: DomainResult = { ok: false, code: "unavailable", error: "Not available on this server.", bg: "Това не е налично на този сървър.", en: "This is not available on this server." };
const DOMAIN_FAILED: DomainResult = { ok: false, code: "provider", error: "The domain could not be added.", bg: "Домейнът не можа да бъде добавен. Опитайте след минута.", en: "The domain could not be added. Try again in a minute." };

/**
 * Attaches `domain` to the deployed project (idempotent at the provider) and remembers it on the deploy record together with
 * the verification result. Only a `ready` deploy can take a domain; the write is a conditional claim so a redeploy that
 * started meanwhile (status no longer `ready`) is never overwritten with the stale record.
 */
/** True for a provider error carrying a numeric 4xx status other than 429 (the provider refused this domain, retrying will not help). */
function isRefusal(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status <= 499 && status !== 429;
}

/** Busy while a publish is in flight; no_site without a deploy, after a failed publish, or without a project. */
function siteGate(deploy: DeployInfo | null | undefined): DomainResult | null {
  if (deploy?.status === "pending" || deploy?.status === "building") return DOMAIN_BUSY;
  if (!deploy || deploy.status !== "ready" || !deploy.project_id) return NO_SITE;
  return null;
}

async function attachDomain(d: AdminSiteDeps, venue: Venue, domain: string): Promise<DomainResult> {
  const deploy = venue.deploy;
  const gate = siteGate(deploy);
  if (gate || !deploy?.project_id) return gate ?? NO_SITE;
  if (!d.deployer?.addDomain) return DOMAIN_FAILED;
  let instructions: DomainInstructions;
  try {
    instructions = await d.deployer.addDomain(deploy.project_id, domain);
  } catch (e) {
    return isRefusal(e) ? DOMAIN_REFUSED : DOMAIN_FAILED; // the provider message stays out of the response and the stored record
  }
  const current = (await d.store.getVenue(venue.id)).deploy;
  if (!current || current.status !== "ready") return DOMAIN_BUSY;
  const next: DeployInfo = { ...current, custom_domain: domain, domain_verified: instructions.verified, updated_at: d.now().toISOString() };
  if (!(await d.store.claimDeploy(venue.id, next, { whenStatusIn: ["ready"] }))) return DOMAIN_BUSY;
  return { ok: true, domain, instructions };
}

/** Dashboard "Connect": validate and normalise the hostname, attach it to the provider project, return the DNS records to set. */
export async function connectDomain(d: AdminSiteDeps, venue: Venue, domainRaw: unknown): Promise<DomainResult> {
  if (!d.deployer) return DOMAIN_UNAVAILABLE;
  const domain = normalizeDomain(domainRaw);
  if (!domain) return INVALID_DOMAIN;
  return attachDomain(d, venue, domain);
}

/** Dashboard "Check again": re-reads the records and the verification for the stored domain (attaching again is idempotent). */
export async function checkDomain(d: AdminSiteDeps, venue: Venue): Promise<DomainResult> {
  if (!d.deployer) return DOMAIN_UNAVAILABLE;
  const gate = siteGate(venue.deploy);
  if (gate || !venue.deploy) return gate ?? NO_SITE;
  const domain = venue.deploy.custom_domain;
  if (!domain) return NO_DOMAIN;
  return attachDomain(d, venue, domain);
}
