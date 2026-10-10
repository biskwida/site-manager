// src/server/admin.ts
import type { Messenger } from "../bot/messenger";
import { invertChanges } from "../domain/changes";
import { isSoldOut } from "../domain/effective";
import { renderPreview } from "../domain/preview";
import type { ChangeSet, Venue } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";

export interface AdminOverview {
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
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

async function concludeOnChannel(d: AdminDeps, cs: ChangeSet, mark: { bg: string; en: string }) {
  if (cs.chat_ref === null) return;
  const member = await d.store.findMember(cs.chat_ref);
  const lang = member?.lang ?? "bg";
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
  const now = d.now();
  const nowIso = now.toISOString();
  if (action === "undo") {
    if (cs.status !== "applied") return { ok: false, error: `Change set is "${cs.status}".` };
    const site = await d.store.getSite(venue.id);
    const changes = invertChanges(cs.changes);
    const undo = await d.store.createChangeSet({
      venue_id: venue.id, chat_ref: cs.chat_ref, summary_bg: `Отмяна: ${cs.summary_bg}`, summary_en: `Undo: ${cs.summary_en}`,
      preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
      source: "undo", status: "proposed", undoes_id: cs.id, changes,
    });
    await d.store.applyChangeSet(undo.id, nowIso);
    if (cs.chat_ref !== null) await d.messenger.send(cs.chat_ref, (await d.store.findMember(cs.chat_ref))?.lang === "en" ? `↩️ Reverted from the dashboard: ${cs.summary_en}` : `↩️ Отменено от таблото: ${cs.summary_bg}`, { proactive: true });
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
  if (r === "skipped") return { ok: false, error: `Change set is "${(await d.store.getChangeSet(cs.id)).status}".` };
  await concludeOnChannel(d, cs, { bg: "✅ Приложено от таблото.", en: "✅ Applied from the dashboard." });
  return { ok: true, status: "applied", change_set_id: cs.id };
}
