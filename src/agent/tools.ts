// src/agent/tools.ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Messenger } from "../bot/messenger";
import type { WordPressClient } from "../destinations/wordpress-client";
import { allergenName, allergenWarnings, suggestAllergens } from "../domain/allergens";
import { invertChanges, isIso, planChanges, type PlanContext } from "../domain/changes";
import { isSoldOut, visibleItems } from "../domain/effective";
import { baseLang, categoryName, tr, unkeep } from "../domain/format";
import { closingToday, nextOpening, todayStatus } from "../domain/hours";
import { renderPreview } from "../domain/preview";
import { bulkPrices } from "../domain/pricing";
import type { ChangeOp, ChangeSet, ChangeSource, Lang, Member, SiteState } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime, nowText } from "../time";
import { copy } from "../bot/copy";
import { usageLine } from "../bot/limit";
import { changeUsage } from "../store/usage";
import { countsTowardLimit } from "../domain/limits";
import { BulkSchema, CancelSchema, CheckAllergensSchema, ListSchema, ProposeSchema, ScheduleSchema, UndoSchema, type ChangeInput } from "./tool-schemas";
import { commentTools, isCommentReplySet } from "./comment-tools";
import { socialTools } from "./social-tools";
import { visualTools } from "./visual-tools";
import type { VisualClient } from "../visual/client";
import { wpTools } from "./wp-tools";

export interface AgentDeps {
  store: Store;
  venueId: string;
  chatRef: string;
  member: Member;
  messenger: Messenger;
  now: () => Date;
  /** Deployment URL without a trailing slash, for public links. */
  baseUrl: string;
  /** From the ✏️ Change button: the proposal the next propose_changes/schedule_changes replaces. */
  correctionFor?: string | null;
  /** How this turn arrived; recorded on the change set. Default "text". */
  source?: ChangeSource;
  /** The venue's WordPress site, when connected (Task 6 registers the wp_* tools). */
  wordpress?: WordPressClient | null;
  /** Networks connected for posting (registers social_post when either is true). */
  social?: { facebook: boolean; instagram: boolean } | null;
  /** Outbound HTTP for reading the owner's photo (social_post reads it for Instagram's 4:5..1.91:1 check and to make the 9:16 story picture); default the global fetch. */
  fetch?: typeof fetch;
  /** The picture service (photo → Instagram picture); registers make_visual when present. */
  visual?: VisualClient | null;
  /** Extra lines for this turn's memory (e.g. the media ids of pictures made), so later messages can refer to them. */
  notes?: string[];
  /** Ids of the change sets this turn created (filled by the tools). One owner message may hold several tasks, so its own proposals never block each other. */
  turnSets?: Set<string>;
  /** URLs of the pictures make_visual sent to the owner's chat in this turn, so social_post does not send one again (it sends every other picture of its own proposal and records none). run.ts starts an empty set each turn. */
  sentPhotos?: Set<string>;
}

/** AgentDeps as the tools use them: makeTools gives them the turn's set of sent pictures (an empty one when the caller passes none). */
export type ToolDeps = AgentDeps & { sentPhotos: Set<string> };

/** The store as the tools see it: every change set they create is recorded in `created`. Other methods pass through, bound to the real store. */
function recordingStore(store: Store, created: Set<string>): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "createChangeSet") {
        return async (...args: Parameters<Store["createChangeSet"]>) => {
          const cs = await target.createChangeSet(...args);
          created.add(cs.id);
          return cs;
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const STAFF_OPS = new Set<ChangeOp["op"]>(["set_sold_out", "add_item"]);

export function requireRole(member: Member, ops: ChangeOp[]): void {
  if (member.role === "owner") return;
  for (const op of ops) {
    const ok = STAFF_OPS.has(op.op) && (op.op !== "add_item" || op.item.is_special);
    if (!ok) throw new Error(`"${op.op}" is only the owner's decision; staff may mark items sold out and add today's specials. Tell the owner to send this change.`);
  }
}

/** Model-supplied ISO instant → canonical UTC ("…Z"), so stored values compare as strings; anything invalid stays as-is for validateChange to report. */
function canonical(x: string | null): string | null {
  return x !== null && isIso(x) ? new Date(x).toISOString() : x;
}

/** Replaces "next_opening" / "closing_today" with ISO instants from the venue's hours and normalises explicit instants to UTC. */
export function resolveTokens(ops: ProposeInput["changes"], site: SiteState, now: Date): ChangeOp[] {
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
    if (op.op === "set_sold_out") return { ...op, until: op.until === "next_opening" ? opening() : canonical(op.until) };
    if (op.op === "add_item") return { ...op, item: { ...op.item, special_expires_at: op.item.special_expires_at === "closing_today" ? closing() : canonical(op.item.special_expires_at) } };
    if (op.op === "add_announcement") return { ...op, expires_at: op.expires_at === "closing_today" ? closing() : canonical(op.expires_at) };
    return op as ChangeOp;
  });
}

/**
 * What propose takes: propose_changes' input, plus the set_comment_mode op, which only the set_comment_mode tool (src/agent/comment-tools.ts)
 * sends (it is not in ChangeInputSchema, so propose_changes cannot mix it with menu changes).
 */
export type ProposeInput = Omit<z.infer<typeof ProposeSchema>, "changes"> & { changes: (ChangeInput | Extract<ChangeOp, { op: "set_comment_mode" }>)[] };

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

export function makeTools(deps: AgentDeps) {
  const turnSets = deps.turnSets ?? new Set<string>();
  const d: ToolDeps = { ...deps, turnSets, sentPhotos: deps.sentPhotos ?? new Set<string>(), store: recordingStore(deps.store, turnSets) };
  // Tools run one at a time per turn, even if the runner calls several at once. Results reach the agent without keep markers
  // (previews carry them for the chat): text it copies from a result into site content, a caption or a reply must have none.
  let queue: Promise<unknown> = Promise.resolve();
  const attempt = (fn: () => Promise<unknown>): Promise<string> => {
    const run = queue.then(async () => {
      try {
        return unkeep(JSON.stringify(await fn()));
      } catch (e) {
        return unkeep(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
    });
    queue = run;
    return run;
  };

  // Previews, buttons and fixed texts come in Bulgarian or English; another conversation language starts from English.
  const lang = baseLang(d.member.lang);
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

  /** Cancels a pending proposal (because the owner asked to change it) and concludes its message. */
  const cancelPending = async (cs: ChangeSet, mark: string) => {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: d.now().toISOString() });
    if (cs.chat_ref !== null) await d.messenger.conclude(cs.chat_ref, cs.message_ref, `${mine(cs)}\n\n${mark}`, mark);
  };

  /** Proposals from earlier messages block new ones: the one the owner pressed ✏️ on is replaced, any other refuses. This message's own proposals never block. */
  const ensureNoPending = async () => {
    // Comment proposals (source "comment") never block a menu change and are never blocked by one.
    const earlier = (await d.store.listChangeSets(d.venueId, { status: ["proposed"], limit: 50 })).filter((cs) => cs.chat_ref === d.chatRef && cs.source !== "comment" && !turnSets.has(cs.id));
    const corrected = d.correctionFor ? earlier.find((cs) => cs.id === d.correctionFor) : undefined;
    const pending = earlier.find((cs) => cs !== corrected);
    if (!pending) {
      if (corrected) await cancelPending(corrected, tr(lang, "✏️ Заменено с ново предложение.", "✏️ Replaced by a new proposal."));
      return;
    }
    throw new Error(`A proposal from an earlier message (${pending.id}: ${lang === "bg" ? pending.summary_bg : pending.summary_en}) is already waiting for a decision. Ask the owner to tap ✅/❌ on it, or call cancel_change_set("${pending.id}") if this message clearly supersedes it.`);
  };

  /**
   * Monthly change limit (src/domain/limits.ts): every proposal that would use up a change refuses here once the month's
   * limit is reached, before anything is created. Undo never calls it. The apply-time stop in the store covers the rest.
   */
  const ensureWithinLimit = async () => {
    const venue = await d.store.getVenue(d.venueId);
    if (venue.change_limit === null) return;
    const u = await changeUsage(d.store, venue, d.now());
    if (!u.reached) return;
    const line = copy(lang).limitReached(venue.change_limit, u.used, u.resets_on);
    throw new Error(`Monthly change limit reached (${u.used}/${venue.change_limit} this month): nothing was proposed. Do not retry, split or rephrase this request; reply to the owner with exactly this line: "${line}" Undo still works.`);
  };

  /** Shared by propose_changes and schedule_changes. */
  const propose = async (input: ProposeInput, applyAt: string | null) => {
    // A set made only of set_comment_mode rows never counts toward the limit (countsTowardLimit), so it is never refused here.
    if (countsTowardLimit(d.source ?? "text", input.changes)) await ensureWithinLimit();
    const s = await site();
    const ops = resolveTokens(input.changes, s, d.now());
    requireRole(d.member, ops);
    const changes = planChanges(s, ops, ctx());
    const p = previews(s, changes);
    const instant = applyAt === null && ops.every((o) => o.op === "set_sold_out");
    if (!instant) await ensureNoPending();
    const cs = await d.store.createChangeSet({
      venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: input.summary_bg, summary_en: input.summary_en, ...p,
      source: d.source ?? "text", status: "proposed", apply_at: applyAt, changes,
    });
    if (instant) {
      if ((await d.store.applyChangeSet(cs.id, d.now().toISOString())) === "limited") {
        // Another apply used up the last change since the check above; the store cancelled this set.
        await ensureWithinLimit(); // throws with the owner's line
        throw new Error("Monthly change limit reached: nothing was applied. Do not retry.");
      }
      const usage = await usageLine(d.store, d.venueId, d.now(), lang);
      await d.messenger.send(d.chatRef, `✅ ${mine(p).replace(/^• /gm, "")}${usage ? `\n${usage}` : ""}`);
      const first = ops[0] as Extract<ChangeOp, { op: "set_sold_out" }>;
      return { change_set_id: cs.id, status: "applied", preview: mine(p), sold_out_until: first.until };
    }
    const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(mine(p), lang, applyAt, s.venue.tz), cs.id, lang);
    if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
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
        const pending = await d.store.findProposed(d.venueId, d.chatRef);
        return {
          venue: {
            name: s.venue.name, slug: s.venue.slug, tz: s.venue.tz, default_lang: s.venue.default_lang,
            tagline_bg: s.venue.tagline_bg, tagline_en: s.venue.tagline_en, about_bg: s.venue.about_bg, about_en: s.venue.about_en,
            address: s.venue.address, phone: s.venue.phone, maps_url: s.venue.maps_url, instagram: s.venue.instagram,
            theme: { ...s.venue.theme, background: s.venue.theme.background ?? null }, has_cover: s.venue.cover_media_id !== null, has_logo: s.venue.logo_media_id !== null,
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
        // A comment proposal went to every owner and holds comment rows: only ❌ on it (or Ignore in the dashboard) concludes all of them.
        if (isCommentReplySet(cs)) {
          const say = tr(lang, "„Натиснете ❌ на предложението в чата или „Пропусни“ в картата „Коментари“ в таблото.“", "“Tap ❌ on the proposal in the chat, or Ignore in the dashboard's Comments card.”");
          throw new Error(`Change set ${cs.id} is a comment reply proposal; cancel_change_set does not cancel those, and no tool ignores a comment. Tell the owner in one short sentence: ${say}`);
        }
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
  const kit: ToolKit = { attempt, site, ctx, previews, mine, propose, getSet, ensureNoPending, ensureWithinLimit, lang };
  return [getSite, getMenu, proposeChanges, cancelChangeSet, listChanges, ...extraTools(d, kit), ...wpTools(d, kit), ...socialTools(d, kit), ...commentTools(d, kit), ...visualTools(d, kit)];
}

/** What the shared helpers of makeTools expose to the second group of tools. */
export interface ToolKit {
  attempt: (fn: () => Promise<unknown>) => Promise<string>;
  site: () => Promise<SiteState>;
  ctx: () => PlanContext;
  previews: (s: SiteState, changes: ReturnType<typeof planChanges>) => { preview_bg: string; preview_en: string };
  mine: (p: { preview_bg: string; preview_en: string }) => string;
  propose: (input: ProposeInput, applyAt: string | null) => Promise<unknown>;
  getSet: (id: string) => Promise<ChangeSet>;
  ensureNoPending: () => Promise<void>;
  /** Throws the owner's limit line when the venue's monthly change limit is reached; call before creating any non-undo set. */
  ensureWithinLimit: () => Promise<void>;
  lang: Lang;
}
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

function extraTools(d: AgentDeps, k: ToolKit) {
  const scheduleChanges = betaZodTool({
    name: "schedule_changes",
    description: "Like propose_changes, but the set is applied at apply_at (ISO 8601 with offset, in the future) after the owner approves. The owner gets a reminder 24 h before. Use for holidays, seasonal prices, announcements that start later.",
    inputSchema: ScheduleSchema,
    run: (input) =>
      k.attempt(async () => {
        if (!ISO_WITH_OFFSET.test(input.apply_at) || Number.isNaN(Date.parse(input.apply_at))) throw new Error("apply_at must be an ISO 8601 datetime with offset, e.g. 2026-12-24T08:00:00+02:00.");
        const applyAt = new Date(input.apply_at).toISOString();
        if (Date.parse(applyAt) <= d.now().getTime()) throw new Error("apply_at must be in the future; for an immediate change use propose_changes.");
        return k.propose(input, applyAt);
      }),
  });

  const bulk = betaZodTool({
    name: "propose_bulk_price_change",
    description: "Change many prices at once by a percentage or a fixed amount, with rounding. The tool does the arithmetic and sends the owner a table preview. Filter by category_id and/or name_contains; no filter = every active item.",
    inputSchema: BulkSchema,
    run: (input) =>
      k.attempt(async () => {
        const s = await k.site();
        const needle = input.name_contains?.toLowerCase();
        const cat = input.category_id ? s.categories.find((c) => c.id === input.category_id) : undefined;
        if (input.category_id && !cat) throw new Error(`category_id "${input.category_id}" not found; use an id from get_menu.`);
        const targets = s.items.filter((i) => i.active && !i.is_special && (!cat || i.category_id === cat.id) && (!needle || i.name_bg.toLowerCase().includes(needle) || i.name_en.toLowerCase().includes(needle)));
        if (targets.length === 0) throw new Error("No active items match that filter; check get_menu.");
        const rows = bulkPrices(targets, { percent: input.percent, delta_eur: input.delta_eur, rounding: input.rounding });
        const changed = rows.filter((r) => r.new_eur !== r.old_eur);
        if (changed.length === 0) throw new Error("Every price would stay the same after rounding; choose a finer rounding or a bigger change.");
        const amount = input.percent !== undefined ? `${input.percent > 0 ? "+" : ""}${input.percent} %` : `${(input.delta_eur as number) > 0 ? "+" : ""}${(input.delta_eur as number).toFixed(2)} €`;
        const scope = cat ? { bg: ` (${categoryName(cat, "bg")})`, en: ` (${categoryName(cat, "en")})` } : needle ? { bg: ` („${input.name_contains}“)`, en: ` (“${input.name_contains}”)` } : { bg: "", en: "" };
        const round = input.rounding === "none" ? { bg: "", en: "" } : { bg: `, закръглени до ${input.rounding} €`, en: `, rounded to €${input.rounding}` };
        const summary_bg = input.summary_bg ?? `Цени ${amount}${scope.bg}${round.bg}`;
        const summary_en = input.summary_en ?? `Prices ${amount}${scope.en}${round.en}`;
        const result = (await k.propose({ summary_bg, summary_en, changes: changed.map((r) => ({ op: "set_price" as const, item_id: r.item_id, price_eur: r.new_eur })) }, null)) as Record<string, unknown>;
        // Only the rows that became changes: the model has nothing to say about prices that stay the same.
        return { ...result, rows: changed };
      }),
  });

  const checkAllergens = betaZodTool({
    name: "check_allergens",
    description: "Keyword check of a dish name/description against the 14 EU allergens. Returns suggested codes and warnings for suggested-but-undeclared ones. Call it before add_item or a rename; mention warnings in your reply.",
    inputSchema: CheckAllergensSchema,
    run: (input) =>
      k.attempt(async () => {
        const text = `${input.name} ${input.desc ?? ""}`;
        const warnings = allergenWarnings(input.declared, text).map((w) => ({ ...w, name_bg: allergenName(w.code, "bg"), name_en: allergenName(w.code, "en") }));
        return { suggested: suggestAllergens(text), warnings, ok: warnings.length === 0, note: "Keyword-based and advisory: mention the warnings in the preview and let the owner decide." };
      }),
  });

  const undo = betaZodTool({
    name: "undo",
    description: 'Propose reverting an applied change set ("last" = the most recent applied one that was not automatic). The owner approves with the buttons; the inverse is applied as a new set.',
    inputSchema: UndoSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("undo is only the owner's decision; tell the owner.");
        let target: ChangeSet | undefined;
        if (input.change_set_id === "last") {
          // listChangeSets orders by created_at; a scheduled set lands long after its creation, so rank by when it was applied.
          const appliedAt = (cs: ChangeSet) => cs.applied_at ?? cs.created_at;
          target = (await d.store.listChangeSets(d.venueId, { status: ["applied"], limit: 50 }))
            .filter((cs) => cs.source !== "auto")
            .sort((a, b) => appliedAt(b).localeCompare(appliedAt(a)))[0];
          if (!target) throw new Error("Nothing to undo: no applied change set yet.");
        } else {
          target = await k.getSet(input.change_set_id);
          if (target.status !== "applied") throw new Error(`Change set is "${target.status}"; only applied sets can be undone. ${NEXT_STEP[target.status]}`);
        }
        await k.ensureNoPending();
        const s = await k.site();
        // Preview against the current state, so a reverted price reads "3,20 € → 2,90 €".
        const changes = invertChanges(target.changes);
        const p = k.previews(s, changes);
        const cs = await d.store.createChangeSet({
          venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: `Отмяна: ${target.summary_bg}`, summary_en: `Undo: ${target.summary_en}`, ...p,
          source: "undo", status: "proposed", undoes_id: target.id, changes,
        });
        const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
        if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
        return { change_set_id: cs.id, status: "proposed", undoes: target.id, preview: k.mine(p), next: "The owner decides with the buttons." };
      }),
  });

  return [scheduleChanges, bulk, checkAllergens, undo];
}
