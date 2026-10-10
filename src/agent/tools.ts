// src/agent/tools.ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Messenger } from "../bot/messenger";
import { invertChanges, planChanges, type PlanContext } from "../domain/changes";
import { isSoldOut, visibleItems } from "../domain/effective";
import { itemName, tr } from "../domain/format";
import { closingToday, nextOpening, todayStatus } from "../domain/hours";
import { renderPreview } from "../domain/preview";
import type { ChangeOp, ChangeSet, ChangeSource, Lang, Member, SiteState } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime, nowText } from "../time";
import { CancelSchema, ListSchema, ProposeSchema, type ChangeInput } from "./tool-schemas";

export interface AgentDeps {
  store: Store;
  venueId: string;
  chatId: number;
  member: Member;
  messenger: Messenger;
  now: () => Date;
  /** Deployment URL without a trailing slash, for public links. */
  baseUrl: string;
  /** From the ✏️ Change button: the proposal the next propose_changes/schedule_changes replaces. */
  correctionFor?: string | null;
  /** How this turn arrived; recorded on the change set. Default "text". */
  source?: ChangeSource;
}

const STAFF_OPS = new Set<ChangeOp["op"]>(["set_sold_out", "add_item"]);

export function requireRole(member: Member, ops: ChangeOp[]): void {
  if (member.role === "owner") return;
  for (const op of ops) {
    const ok = STAFF_OPS.has(op.op) && (op.op !== "add_item" || op.item.is_special);
    if (!ok) throw new Error(`"${op.op}" is only the owner's decision; staff may mark items sold out and add today's specials. Tell the owner to send this change.`);
  }
}

/** Replaces "next_opening" / "closing_today" with ISO instants from the venue's hours. */
export function resolveTokens(ops: ChangeInput[], site: SiteState, now: Date): ChangeOp[] {
  const { hours, tz } = site.venue;
  const opening = () => {
    const iso = nextOpening(hours, site.holidays, now, tz);
    if (!iso) throw new Error("The venue has no opening in the next 14 days (check get_site hours/holidays); give an explicit ISO datetime for until, or null.");
    return iso;
  };
  const closing = () => {
    const iso = closingToday(hours, site.holidays, now, tz);
    if (!iso) throw new Error("The venue is not open right now, so closing_today has no value; give an explicit ISO datetime with offset for the expiry, or null.");
    return iso;
  };
  return ops.map((op): ChangeOp => {
    if (op.op === "set_sold_out") return { ...op, until: op.until === "next_opening" ? opening() : op.until };
    if (op.op === "add_item") return { ...op, item: { ...op.item, special_expires_at: op.item.special_expires_at === "closing_today" ? closing() : op.item.special_expires_at } };
    if (op.op === "add_announcement") return { ...op, expires_at: op.expires_at === "closing_today" ? closing() : op.expires_at };
    return op as ChangeOp;
  });
}

/** The Telegram message for a proposal: preview, optional schedule line, and the question. */
export function proposalText(preview: string, lang: Lang, applyAt: string | null, tz: string): string {
  const when = applyAt ? `\n\n${tr(lang, "⏰ Ще се приложи на", "⏰ Will be applied on")} ${formatDateTime(applyAt, lang, tz)}` : "";
  return `${preview}${when}\n\n${tr(lang, "Да приложа ли?", "Apply this?")}`;
}

const NEXT_STEP: Record<ChangeSet["status"], string> = {
  proposed: "it is waiting for the owner's decision.",
  scheduled: "it will be applied at apply_at; cancel_change_set stops it.",
  applied: "undo can revert it.",
  rejected: "propose again if the owner wants a different version.",
  expired: "propose it again.",
  cancelled: "propose it again.",
  reverted: "it was undone already.",
};

export function makeTools(d: AgentDeps) {
  // Tools run one at a time per turn, even if the runner calls several at once.
  let queue: Promise<unknown> = Promise.resolve();
  const attempt = (fn: () => Promise<unknown>): Promise<string> => {
    const run = queue.then(async () => {
      try {
        return JSON.stringify(await fn());
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    });
    queue = run;
    return run;
  };

  const lang = d.member.lang;
  const site = () => d.store.getSite(d.venueId);
  const ctx = (): PlanContext => ({ newId: () => crypto.randomUUID(), now: d.now().toISOString() });
  const previews = (s: SiteState, changes: ReturnType<typeof planChanges>) => ({
    preview_bg: renderPreview(s, changes, "bg", s.venue.tz),
    preview_en: renderPreview(s, changes, "en", s.venue.tz),
  });
  const mine = (p: { preview_bg: string; preview_en: string }) => (lang === "bg" ? p.preview_bg : p.preview_en);

  const getSet = async (id: string): Promise<ChangeSet> => {
    try {
      const cs = await d.store.getChangeSet(id);
      if (cs.venue_id !== d.venueId) throw new Error("not this venue");
      return cs;
    } catch {
      throw new Error(`change_set_id "${id}" not found; use an id from list_changes.`);
    }
  };

  /** Cancels a pending proposal (because the owner asked to change it) and edits its message. */
  const cancelPending = async (cs: ChangeSet, mark: string) => {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: d.now().toISOString() });
    if (cs.chat_id !== null && cs.tg_message_id !== null) await d.messenger.edit(cs.chat_id, cs.tg_message_id, `${mine(cs)}\n\n${mark}`);
  };

  /** One proposal per chat: replace it when the owner pressed ✏️, otherwise refuse. */
  const ensureNoPending = async () => {
    const pending = await d.store.findProposed(d.venueId, d.chatId);
    if (!pending) return;
    if (d.correctionFor && pending.id === d.correctionFor) {
      await cancelPending(pending, tr(lang, "✏️ Заменено с ново предложение.", "✏️ Replaced by a new proposal."));
      return;
    }
    throw new Error(`A proposal (${pending.id}: ${lang === "bg" ? pending.summary_bg : pending.summary_en}) is already waiting for a decision. Ask the owner to tap ✅/❌ on it, or call cancel_change_set("${pending.id}") if this message clearly supersedes it.`);
  };

  /** Shared by propose_changes and schedule_changes. */
  const propose = async (input: z.infer<typeof ProposeSchema>, applyAt: string | null) => {
    const s = await site();
    const ops = resolveTokens(input.changes, s, d.now());
    requireRole(d.member, ops);
    const changes = planChanges(s, ops, ctx());
    const p = previews(s, changes);
    const instant = applyAt === null && ops.every((o) => o.op === "set_sold_out");
    if (!instant) await ensureNoPending();
    const cs = await d.store.createChangeSet({
      venue_id: d.venueId, chat_id: d.chatId, summary_bg: input.summary_bg, summary_en: input.summary_en, ...p,
      source: d.source ?? "text", status: "proposed", apply_at: applyAt, changes,
    });
    if (instant) {
      await d.store.applyChangeSet(cs.id, d.now().toISOString());
      await d.messenger.send(d.chatId, `✅ ${mine(p).replace(/^• /gm, "")}`);
      const first = ops[0] as Extract<ChangeOp, { op: "set_sold_out" }>;
      return { change_set_id: cs.id, status: "applied", preview: mine(p), sold_out_until: first.until };
    }
    const messageId = await d.messenger.sendProposal(d.chatId, proposalText(mine(p), lang, applyAt, s.venue.tz), cs.id, lang);
    if (messageId !== null) await d.store.updateChangeSet(cs.id, { tg_message_id: messageId });
    return { change_set_id: cs.id, status: "proposed", preview: mine(p), apply_at: applyAt, next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
  };

  const getSite = betaZodTool({
    name: "get_site",
    description: "The venue's texts, hours, today's status, holidays, announcements, theme, images, the current time with its UTC offset, the member's language and role, and any pending proposal. Call this first when the request touches anything but the menu.",
    inputSchema: z.object({}),
    run: () =>
      attempt(async () => {
        const s = await site();
        const now = d.now();
        const pending = await d.store.findProposed(d.venueId, d.chatId);
        return {
          venue: {
            name: s.venue.name, slug: s.venue.slug, tz: s.venue.tz, default_lang: s.venue.default_lang,
            tagline_bg: s.venue.tagline_bg, tagline_en: s.venue.tagline_en, about_bg: s.venue.about_bg, about_en: s.venue.about_en,
            address: s.venue.address, phone: s.venue.phone, maps_url: s.venue.maps_url, instagram: s.venue.instagram,
            theme: s.venue.theme, has_cover: s.venue.cover_media_id !== null, has_logo: s.venue.logo_media_id !== null,
          },
          texts: Object.fromEntries(s.texts.map((t) => [t.key, { bg: t.text_bg, en: t.text_en }])),
          hours: s.venue.hours,
          today: todayStatus(s.venue.hours, s.holidays, now, s.venue.tz),
          holidays: s.holidays.map((h) => ({ id: h.id, date: h.date, note_bg: h.note_bg, note_en: h.note_en })),
          announcements: s.announcements.map((a) => ({ id: a.id, text_bg: a.text_bg, text_en: a.text_en, expires_at: a.expires_at })),
          gallery_count: s.media.filter((m) => m.is_gallery).length,
          media_ids: s.media.map((m) => m.id),
          now: nowText(now, s.venue.tz),
          now_iso: now.toISOString(),
          owner_lang: lang,
          member_role: d.member.role,
          public_url: `${d.baseUrl}/${s.venue.slug}`,
          pending_proposal: pending ? { id: pending.id, summary: lang === "bg" ? pending.summary_bg : pending.summary_en, apply_at: pending.apply_at } : null,
        };
      }),
  });

  const getMenu = betaZodTool({
    name: "get_menu",
    description: "Categories and active items with ids, names in both languages, prices, sold-out and special state, allergens and whether they have a photo. Use the ids in propose_changes.",
    inputSchema: z.object({}),
    run: () =>
      attempt(async () => {
        const s = await site();
        const nowMs = d.now().getTime();
        const items = s.items.filter((i) => i.active);
        return {
          categories: s.categories.filter((c) => c.active).sort((a, b) => a.position - b.position).map((c) => ({
            id: c.id, name_bg: c.name_bg, name_en: c.name_en,
            items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position).map((i) => ({
              id: i.id, name_bg: i.name_bg, name_en: i.name_en, desc_bg: i.desc_bg, desc_en: i.desc_en, price_eur: i.price_eur,
              allergens: i.allergens, sold_out: isSoldOut(i, nowMs), sold_out_until: i.sold_out_until,
              is_special: i.is_special, special_expires_at: i.special_expires_at, has_image: i.image_media_id !== null,
            })),
          })),
          visible_count: visibleItems(items, nowMs).length,
        };
      }),
  });

  const proposeChanges = betaZodTool({
    name: "propose_changes",
    description: "Validate a list of changes, snapshot before/after, and send the owner a preview with ✅ Apply / ✏️ Change / ❌ Cancel buttons. Sets made only of set_sold_out apply at once (they are undoable). Returns the preview text; do not repeat it.",
    inputSchema: ProposeSchema,
    run: (input) => attempt(() => propose(input, null)),
  });

  const cancelChangeSet = betaZodTool({
    name: "cancel_change_set",
    description: "Cancel a proposed or scheduled change set (for example when the owner's new message supersedes a pending proposal).",
    inputSchema: CancelSchema,
    run: (input) =>
      attempt(async () => {
        const cs = await getSet(input.change_set_id);
        if (cs.status !== "proposed" && cs.status !== "scheduled") throw new Error(`Change set is "${cs.status}"; only proposed or scheduled sets can be cancelled.`);
        await cancelPending(cs, tr(lang, "❌ Отказано.", "❌ Cancelled."));
        return { change_set_id: cs.id, status: "cancelled" };
      }),
  });

  const listChanges = betaZodTool({
    name: "list_changes",
    description: "Recent change sets for this venue, newest first, with status and whether undo can revert them.",
    inputSchema: ListSchema,
    run: (input) =>
      attempt(async () => {
        const sets = await d.store.listChangeSets(d.venueId, { limit: input.limit });
        return {
          change_sets: sets.map((cs) => ({
            id: cs.id, status: cs.status, source: cs.source, summary_bg: cs.summary_bg, summary_en: cs.summary_en,
            created_at: cs.created_at, applied_at: cs.applied_at, apply_at: cs.apply_at, undoable: cs.status === "applied",
            next: NEXT_STEP[cs.status],
          })),
        };
      }),
  });

  // Task 11 appends schedule_changes, propose_bulk_price_change, check_allergens, undo here.
  return [getSite, getMenu, proposeChanges, cancelChangeSet, listChanges, ...extraTools(d, { attempt, site, ctx, previews, mine, propose, getSet, ensureNoPending, lang })];
}

/** Hook for Task 11; returns [] until then. */
export interface ToolKit {
  attempt: (fn: () => Promise<unknown>) => Promise<string>;
  site: () => Promise<SiteState>;
  ctx: () => PlanContext;
  previews: (s: SiteState, changes: ReturnType<typeof planChanges>) => { preview_bg: string; preview_en: string };
  mine: (p: { preview_bg: string; preview_en: string }) => string;
  propose: (input: z.infer<typeof ProposeSchema>, applyAt: string | null) => Promise<unknown>;
  getSet: (id: string) => Promise<ChangeSet>;
  ensureNoPending: () => Promise<void>;
  lang: Lang;
}
function extraTools(_d: AgentDeps, _kit: ToolKit): ReturnType<typeof betaZodTool>[] {
  return [];
}
export { itemName as _itemName, invertChanges as _invertChanges }; // re-exports used by Task 11; remove when extraTools is filled in
