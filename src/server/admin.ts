// src/server/admin.ts
import type { Messenger } from "../bot/messenger";
import { invertChanges } from "../domain/changes";
import { isSoldOut } from "../domain/effective";
import { renderPreview } from "../domain/preview";
import { TEMPLATE_IDS, type ChangeSet, type DeployInfo, type TemplateId, type Venue, type VenueStatus } from "../domain/types";
import type { Deployer, DeployInput } from "../deploy/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";

export interface AdminOverview {
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
  template: TemplateId;
  status: VenueStatus;
  deploy: DeployInfo | null;
  /** The provider URL when the deploy is ready, otherwise our hosted copy. */
  site_url: string;
  pending: ChangeSet[];
  scheduled: ChangeSet[];
  log: ChangeSet[];
  sold_out: { id: string; name_bg: string; name_en: string; sold_out_until: string }[];
}

export async function adminOverview(store: Store, venue: Venue, now: Date, baseUrl = ""): Promise<AdminOverview> {
  const [pending, scheduled, log, site] = await Promise.all([
    store.listChangeSets(venue.id, { status: ["proposed"], limit: 20 }),
    store.listChangeSets(venue.id, { status: ["scheduled"], limit: 50 }),
    store.listChangeSets(venue.id, { status: ["applied", "reverted", "rejected", "expired", "cancelled"], limit: 50 }),
    store.getSite(venue.id),
  ]);
  const nowMs = now.getTime();
  return {
    venue: { id: venue.id, slug: venue.slug, name: venue.name, tz: venue.tz, default_lang: venue.default_lang },
    now: now.toISOString(),
    public_url: `${baseUrl}/${venue.slug}`,
    template: venue.template,
    status: venue.status,
    deploy: venue.deploy,
    site_url: venue.deploy?.status === "ready" && venue.deploy.url ? venue.deploy.url : `${baseUrl}/${venue.slug}`,
    pending,
    scheduled: [...scheduled].sort((a, b) => (a.apply_at ?? "").localeCompare(b.apply_at ?? "")),
    log,
    sold_out: site.items.filter((i) => i.active && isSoldOut(i, nowMs)).map((i) => ({ id: i.id, name_bg: i.name_bg, name_en: i.name_en, sold_out_until: i.sold_out_until as string })),
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

export type AdminSiteActionName = "set_template";
export interface AdminSiteDeps {
  store: Store;
  deployer: Deployer;
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
