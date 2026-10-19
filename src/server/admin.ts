// src/server/admin.ts
import { limitReachedLine, usageLine } from "../bot/limit";
import type { Messenger } from "../bot/messenger";
import { invertChanges } from "../domain/changes";
import { isSoldOut } from "../domain/effective";
import { baseLang, unkeep, unkeepTexts } from "../domain/format";
import { renderPreview } from "../domain/preview";
import { isBoostPlanSet, isBoostPlanUndoSet, TEMPLATE_IDS, type BillingStatus, type ChangeSet, type DeployInfo, type Plan, type SiteMode, type TemplateId, type Venue, type VenueStatus } from "../domain/types";
import { canBuyWebsiteLater, hasStoredSubscription, socialWebsiteNote, trialDaysLeft, websiteAllowed } from "../billing/plans";
import type { Deployer, DeployInput, DomainInstructions } from "../deploy/types";
import { normalizeDomain } from "../deploy/vercel-domains";
import type { DestinationStatus, Store, SyncStatus } from "../store/types";
import { formatDateTime } from "../time";
import { changeUsage } from "../store/usage";
import { accentAfterTemplateSwitch } from "../wizard/schema";
import { connectedApps, type ConnectedApp } from "./connect-apps";
import { publishedIn, safeLink } from "../destinations/social-common";
import { commentsOverview, type CommentsOverview } from "./admin-comments";

export interface AdminOverview {
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
  template: TemplateId;
  status: VenueStatus;
  /** True when this server has no deployer (no VERCEL_TOKEN): the hosted /<slug> is the site; no deploy record, no custom domain. */
  hosted: boolean;
  /** True when the venue has its own site (Venue.site_mode "own", built and hosted elsewhere at Venue.site_url): no deploy, template switch or custom domain. */
  own_site?: boolean;
  /** The venue's site mode; "none" (social media only) hides the site, template and domain cards like own_site does. */
  site_mode?: SiteMode;
  /** Always null when `hosted` or `own_site`. */
  deploy: DeployInfo | null;
  /** The venue's own site when `own_site`; else the provider URL when the deploy is ready, otherwise our hosted copy. */
  site_url: string;
  /** Custom domain attached to the deploy (Pro), and whether the provider confirmed its DNS at the last check. */
  custom_domain: string | null;
  domain_verified: boolean | null;
  pending: ChangeSet[];
  scheduled: ChangeSet[];
  log: ChangeSet[];
  sold_out: { id: string; name_bg: string; name_en: string; sold_out_until: string }[];
  wordpress?: WordPressOverview | null;
  /** Linked chats per app ("Your apps" card). */
  connected_apps: ConnectedApp[];
  /** "Facebook and Instagram" card. */
  social?: SocialOverview;
  /** Monthly change limit (src/domain/limits.ts): changes applied this calendar month in the venue's zone; limit null = unlimited. */
  changes_this_month?: { used: number; limit: number | null };
  /** "Comments" card (comment replies, 2026-10-15). */
  comments?: CommentsOverview;
  /** The plan and trial card (billing, 2026-10-19). Present only when billing is on. */
  billing?: BillingOverview;
}

export interface BillingOverview {
  plan: Plan | null;
  status: BillingStatus | null;
  /** Whole days of free trial left while the status is "trialing"; null otherwise. */
  trial_days_left: number | null;
  trial_ends_at: string | null;
  /** A Stripe subscription exists that is not canceled (live, paused or unpaid): it is managed in the Customer Portal, not by a new Checkout. */
  subscribed: boolean;
  /** A Stripe customer exists, so the Customer Portal can open. */
  has_customer: boolean;
  /** The website add-on is paid and the venue has no Claudia site yet: the dashboard offers "Build your website". */
  can_build_website: boolean;
  /** An Admin or Both subscriber with no Claudia site who has not paid the 199 € website yet: the dashboard offers "Add a website". */
  can_buy_website: boolean;
  /** A Social media subscriber with no Claudia site: the dashboard says a website comes with Admin or Both. */
  website_note: boolean;
}

function billingOverview(venue: Venue, now: Date): BillingOverview {
  return {
    plan: venue.plan,
    status: venue.billing_status,
    trial_days_left: venue.billing_status === "trialing" && venue.trial_ends_at ? trialDaysLeft(venue, now) : null,
    trial_ends_at: venue.trial_ends_at,
    subscribed: hasStoredSubscription(venue),
    has_customer: venue.stripe_customer_id !== null,
    can_build_website: venue.site_mode !== "claudia" && venue.status === "live" && websiteAllowed(venue),
    can_buy_website: canBuyWebsiteLater(venue),
    website_note: socialWebsiteNote(venue),
  };
}

/** How many proposed sets the generic pending list shows. */
const PENDING_MAX = 20;

export async function adminOverview(store: Store, venue: Venue, now: Date, baseUrl = "", opts: { hosted?: boolean; social?: { facebook: boolean; instagram: boolean }; billing?: boolean } = {}): Promise<AdminOverview> {
  const [pending, scheduled, log, site, members] = await Promise.all([
    // Comment sets are decided in the Comments card or the chat only: fetched wider, then left out of the generic list.
    store.listChangeSets(venue.id, { status: ["proposed"], limit: 200 }),
    store.listChangeSets(venue.id, { status: ["scheduled"], limit: 50 }),
    store.listChangeSets(venue.id, { status: ["applied", "reverted", "rejected", "expired", "cancelled"], limit: 50 }),
    store.getSite(venue.id),
    store.listMembers(venue.id),
  ]);
  const nowMs = now.getTime();
  const hosted = opts.hosted ?? false;
  const ownSite = venue.site_mode === "own" && venue.site_url !== null && venue.site_url !== "";
  // In hosted mode a deploy record left from an earlier setup means nothing: no provider is reachable from this server.
  // An own site (or none) is not ours to deploy either, whatever record an earlier template setup left behind.
  const deploy = hosted || venue.site_mode !== "claudia" ? null : venue.deploy;
  return {
    venue: { id: venue.id, slug: venue.slug, name: venue.name, tz: venue.tz, default_lang: venue.default_lang },
    now: now.toISOString(),
    public_url: `${baseUrl}/${venue.slug}`,
    template: venue.template,
    status: venue.status,
    hosted,
    own_site: ownSite,
    site_mode: venue.site_mode,
    deploy,
    site_url: ownSite ? (venue.site_url as string) : deploy?.status === "ready" && deploy.url ? deploy.url : `${baseUrl}/${venue.slug}`,
    custom_domain: deploy?.custom_domain ?? null,
    domain_verified: deploy?.custom_domain ? (deploy.domain_verified ?? false) : null,
    // Summaries and previews without the keep markers their chat copies carry (src/domain/format.ts keep).
    pending: pending.filter((cs) => cs.source !== "comment").slice(0, PENDING_MAX).map(unkeepTexts),
    scheduled: [...scheduled].sort((a, b) => (a.apply_at ?? "").localeCompare(b.apply_at ?? "")).map(unkeepTexts),
    log: log.map(unkeepTexts),
    sold_out: site.items.filter((i) => i.active && isSoldOut(i, nowMs)).map((i) => ({ id: i.id, name_bg: i.name_bg, name_en: i.name_en, sold_out_until: i.sold_out_until as string })),
    wordpress: await wordPressOverview(store, venue.id),
    connected_apps: connectedApps(members),
    social: await socialOverview(store, venue.id, opts.social ?? { facebook: false, instagram: false }),
    changes_this_month: await changesThisMonth(store, venue, now),
    comments: await commentsOverview(store, venue, now),
    ...(opts.billing ? { billing: billingOverview(venue, now) } : {}),
  };
}

async function changesThisMonth(store: Store, venue: Venue, now: Date): Promise<{ used: number; limit: number | null }> {
  const u = await changeUsage(store, venue, now);
  return { used: u.used, limit: u.limit };
}

export type AdminActionName = "apply" | "reject" | "cancel" | "undo";
export interface AdminDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  baseUrl: string;
}

async function concludeOnChannel(d: AdminDeps, cs: ChangeSet, mark: { bg: string; en: string }) {
  if (cs.chat_ref === null) return;
  const member = await d.store.findMember(cs.chat_ref);
  const lang = baseLang(member?.lang ?? "bg");
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const line = lang === "bg" ? mark.bg : mark.en;
  await d.messenger.conclude(cs.chat_ref, cs.message_ref, `${preview}\n\n${line}`, line, { proactive: true });
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
  // A comment set is decided in the Comments card (src/server/admin-comments.ts) or with the chat's buttons, never here:
  // that flow concludes every owner's message and puts the comments in the right state. Undo of an applied one stays here.
  if (cs.source === "comment" && action !== "undo") return { ok: false, error: "Comment replies are decided in the Comments card." };
  const now = d.now();
  const nowIso = now.toISOString();
  if (action === "undo") {
    if (cs.status !== "applied") return { ok: false, error: `Change set is "${cs.status}".` };
    const site = await d.store.getSite(venue.id);
    const changes = invertChanges(cs.changes);
    const undo = await d.store.createChangeSet({
      venue_id: venue.id, chat_ref: cs.chat_ref, summary_bg: `Отмяна: ${cs.summary_bg}`, summary_en: `Undo: ${cs.summary_en}`,
      preview_bg: renderPreview(site, changes, "bg", venue.tz, { restore: true }), preview_en: renderPreview(site, changes, "en", venue.tz, { restore: true }),
      source: "undo", status: "proposed", undoes_id: cs.id, changes,
    });
    await d.store.applyChangeSet(undo.id, nowIso);
    if (cs.chat_ref !== null) {
      const lang = baseLang((await d.store.findMember(cs.chat_ref))?.lang ?? "bg");
      await d.messenger.send(cs.chat_ref, lang === "en" ? `↩️ Reverted from the dashboard: ${cs.summary_en}` : `↩️ Отменено от таблото: ${cs.summary_bg}`, { proactive: true });
    }
    return { ok: true, status: "applied", change_set_id: undo.id };
  }
  if (action === "cancel") {
    if (cs.status !== "proposed" && cs.status !== "scheduled") return { ok: false, error: `Change set is "${cs.status}".` };
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: nowIso });
    await concludeOnChannel(d, cs, { bg: "❌ Отказано от таблото.", en: "❌ Cancelled from the dashboard." });
    return { ok: true, status: "cancelled", change_set_id: cs.id };
  }
  if (cs.status !== "proposed") return { ok: false, error: `Change set is "${cs.status}".` };
  if (action === "reject") {
    await d.store.updateChangeSet(cs.id, { status: "rejected", decided_at: nowIso });
    await concludeOnChannel(d, cs, { bg: "❌ Отхвърлено от таблото.", en: "❌ Rejected from the dashboard." });
    return { ok: true, status: "rejected", change_set_id: cs.id };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: nowIso });
    await concludeOnChannel(d, cs, { bg: `⏰ Насрочено от таблото за ${formatDateTime(cs.apply_at, "bg", venue.tz)}`, en: `⏰ Scheduled from the dashboard for ${formatDateTime(cs.apply_at, "en", venue.tz)}` });
    return { ok: true, status: "scheduled", change_set_id: cs.id };
  }
  const r = await d.store.applyChangeSet(cs.id, nowIso);
  if (r === "limited") {
    // The store refused it (monthly change limit) and cancelled the set; the chat message loses its buttons.
    const line = { bg: await limitReachedLine(d.store, venue.id, now, "bg"), en: await limitReachedLine(d.store, venue.id, now, "en") };
    await concludeOnChannel(d, cs, line);
    return { ok: false, status: "cancelled", change_set_id: cs.id, error: line.en };
  }
  if (r === "skipped") return { ok: false, error: `Change set is "${(await d.store.getChangeSet(cs.id)).status}".` };
  if (isBoostPlanSet(cs.changes)) {
    // A saved ad plan changed nothing and used no change: no "applied", no usage line.
    await concludeOnChannel(d, cs, { bg: "✅ Планът е запазен от таблото — ще може да се пусне, щом рекламите са свързани.", en: "✅ Plan saved from the dashboard — it can run once ads are connected." });
    return { ok: true, status: "applied", change_set_id: cs.id };
  }
  if (isBoostPlanUndoSet(cs.changes)) {
    await concludeOnChannel(d, cs, { bg: "✅ Планът е премахнат от таблото.", en: "✅ Plan removed from the dashboard." });
    return { ok: true, status: "applied", change_set_id: cs.id };
  }
  const usage = { bg: await usageLine(d.store, venue.id, now, "bg"), en: await usageLine(d.store, venue.id, now, "en") };
  const withUsage = (mark: string, line: string | null) => (line ? `${mark}\n${line}` : mark);
  await concludeOnChannel(d, cs, { bg: withUsage("✅ Приложено от таблото.", usage.bg), en: withUsage("✅ Applied from the dashboard.", usage.en) });
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
    syncs: last.map((s, i) => ({ id: s.id, change_set_id: s.change_set_id, status: s.status, summary_bg: unkeep(sets[i]?.summary_bg ?? ""), summary_en: unkeep(sets[i]?.summary_en ?? ""), updated_at: s.updated_at, last_error: s.last_error })),
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
  | { ok: false; code: "unknown_template" | "busy" | "failed" | "own_site" | "no_site"; error: string; bg: string; en: string };

const UNKNOWN_TEMPLATE: SetTemplateResult = { ok: false, code: "unknown_template", error: "Unknown template.", bg: "Непознат шаблон.", en: "Unknown template." };
const SAVE_FAILED: SetTemplateResult = { ok: false, code: "failed", error: "The template could not be saved.", bg: "Шаблонът не можа да бъде запазен. Опитайте отново.", en: "The template could not be saved. Try again." };
const OWN_SITE: SetTemplateResult = { ok: false, code: "own_site", error: "This venue has its own site; templates do not apply.", bg: "Сайтът ви е изграден отделно и не използва шаблон.", en: "Your site is built separately and does not use a template." };
const NO_WEBSITE: SetTemplateResult = { ok: false, code: "no_site", error: "This venue has no website; templates do not apply.", bg: "Нямате уебсайт, затова няма шаблон за смяна.", en: "You have no website, so there is no template to change." };
const BUSY: SetTemplateResult = { ok: false, code: "busy", error: "The site is publishing right now.", bg: "Сайтът се публикува в момента. Опитайте след минута.", en: "The site is publishing right now. Try again in a minute." };

/**
 * Dashboard "Change template": updates the venue (our /[slug] switches at once) and, when the site is deployed, redeploys it
 * with the new template. Refuses while a deploy is pending/building; the redeploy is claimed through the store so two
 * concurrent switches cannot both start one. Never calls startDeploy. Refuses for a venue with its own site.
 */
export async function setTemplate(d: AdminSiteDeps, venue: Venue, template: unknown): Promise<SetTemplateResult> {
  if (venue.site_mode === "own") return OWN_SITE; // its own site never wears one of our templates
  if (venue.site_mode === "none") return NO_WEBSITE;
  if (typeof template !== "string" || !(TEMPLATE_IDS as readonly string[]).includes(template)) return UNKNOWN_TEMPLATE;
  const id = template as TemplateId;
  const deploy = venue.deploy;
  // Hosted mode or never deployed: the hosted /<slug> renders the venue's template, so the switch is just the venue field.
  if (!d.deployer || !deploy) return (await saveTemplate(d, venue, id)) ? { ok: true, template: id, deploy: null } : SAVE_FAILED;
  if (deploy.status === "pending" || deploy.status === "building") return BUSY;
  // The venue field goes first: a store that refuses it (say, a template its schema does not know yet) must not leave a
  // claimed deploy stuck in "building" until the stale-deploy timeout.
  if (!(await saveTemplate(d, venue, id))) return SAVE_FAILED;
  const updated_at = d.now().toISOString();
  const claimed: DeployInfo = { ...deploy, deployment_id: "", status: "building", error: null, template: id, updated_at };
  if (!(await d.store.claimDeploy(venue.id, claimed, { whenStatusIn: ["ready", "error"] }))) {
    // A concurrent switch won the claim: the venue fields follow the deploy that is actually running.
    const current = await d.store.getVenue(venue.id).catch(() => null);
    const winner = current?.deploy?.template;
    if (current && winner && winner !== id) await saveTemplate(d, current, winner, id);
    return BUSY;
  }
  const input: DeployInput = { slug: venue.slug, templateId: id, feedUrl: d.feedUrlFor(venue.slug) };
  let next: DeployInfo;
  try {
    // An errored first deploy may have no project yet (createSite failed): create it now instead of redeploying into "".
    const r = deploy.project_id ? { projectId: deploy.project_id, ...(await d.deployer.redeploy(deploy.project_id, input)) } : await d.deployer.createSite(input);
    next = { ...claimed, project_id: r.projectId, deployment_id: r.deploymentId };
    await d.store.setDeploy(venue.id, next);
  } catch {
    // Any failure after the claim ends in "error" (retryable at once); the provider message stays out of the stored record.
    next = { ...claimed, status: "error", error: "Redeploy could not start." };
    await d.store.setDeploy(venue.id, next);
  }
  return { ok: true, template: id, deploy: next };
}

/** Writes the venue's template (and moves a default accent along, as the wizard does); false when the store refuses it. */
async function saveTemplate(d: AdminSiteDeps, venue: Venue, id: TemplateId, from: TemplateId = venue.template): Promise<boolean> {
  const accent = accentAfterTemplateSwitch(venue.theme.accent, from, id);
  try {
    await d.store.updateVenue(venue.id, { template: id, ...(accent !== venue.theme.accent ? { theme: { ...venue.theme, accent } } : {}) });
    return true;
  } catch {
    return false;
  }
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

// --- Facebook and Instagram card (social track, appended 2026-10-11) ---
export interface SocialAccountOverview {
  status: DestinationStatus;
  /** Page name, or @username. */
  name: string;
  connected_at: string | null;
  last_error: string | null;
}
export interface SocialPostOverview {
  id: string;
  change_set_id: string;
  kind: "facebook" | "instagram";
  status: SyncStatus;
  summary_bg: string;
  summary_en: string;
  updated_at: string;
  last_error: string | null;
  /** Public links of what went out (https only). */
  links: string[];
}
export interface SocialOverview {
  /** Which Connect buttons this server can serve (app id + secret + destination key). */
  available: { facebook: boolean; instagram: boolean };
  facebook: SocialAccountOverview | null;
  instagram: SocialAccountOverview | null;
  /** The last five pushes to either network, newest first. */
  posts: SocialPostOverview[];
}

/** Never includes secrets: display fields of the two destination rows and of their sync rows only. */
export async function socialOverview(store: Store, venueId: string, available: { facebook: boolean; instagram: boolean }): Promise<SocialOverview> {
  const [fb, ig] = await Promise.all([store.getDestination(venueId, "facebook"), store.getDestination(venueId, "instagram")]);
  const account = (d: typeof fb, name: string): SocialAccountOverview | null =>
    d ? { status: d.status, name, connected_at: typeof d.config.connected_at === "string" ? d.config.connected_at : null, last_error: d.last_error } : null;
  const ids = new Map<string, "facebook" | "instagram">();
  if (fb) ids.set(fb.id, "facebook");
  if (ig) ids.set(ig.id, "instagram");
  const rows = ids.size ? (await store.listSyncs({ venueId })).filter((s) => ids.has(s.destination_id)) : [];
  const last = rows.slice(-5).reverse();
  const sets = await Promise.all(last.map((s) => store.getChangeSet(s.change_set_id).catch(() => null)));
  return {
    available,
    facebook: account(fb, String(fb?.config.page_name ?? "")),
    instagram: account(ig, ig?.config.username ? `@${String(ig.config.username)}` : ""),
    posts: last.map((s, i) => ({
      id: s.id, change_set_id: s.change_set_id, kind: ids.get(s.destination_id)!, status: s.status,
      summary_bg: unkeep(sets[i]?.summary_bg ?? ""), summary_en: unkeep(sets[i]?.summary_en ?? ""), updated_at: s.updated_at, last_error: s.last_error,
      links: publishedIn([s.result]).map((p) => safeLink(p.permalink)).filter((x): x is string => !!x),
    })),
  };
}
