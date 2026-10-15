import { isAllergenCode } from "./allergens";
import { bestInkContrast, isReadableBackground, READABLE_BACKGROUND_MIN } from "./color";
import { isValidHours } from "./hours";
import { PRICE_MAX, PRICE_MIN, round2 } from "./pricing";
import {
  COMMENT_MODES, isExternalEntity, MONO_TEXT_KEYS, SITE_TEXT_KEYS, VENUE_TEXT_KEYS,
  type Announcement, type Change, type ChangeOp, type Entity, type Holiday, type Item, type Row, type SiteState, type SiteText, type TextKey,
} from "./types";

export interface PlanContext {
  newId: () => string;
  /** ISO instant used for created_at and "in the future" checks. */
  now: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

export function isIso(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
}

function priceError(p: unknown): string | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return "price_eur must be a number.";
  if (round2(p) !== p) return "price_eur must have at most two decimals.";
  if (p < PRICE_MIN || p > PRICE_MAX) return `price_eur must be between ${PRICE_MIN.toFixed(2)} and ${PRICE_MAX.toFixed(2)}.`;
  return null;
}

function allergensError(a: unknown): string | null {
  if (!Array.isArray(a) || !a.every(isAllergenCode)) return "allergens must be allergen codes 1–14.";
  if (new Set(a).size !== a.length) return "allergens must not repeat.";
  return null;
}

function nonEmpty(v: unknown, field: string): string | null {
  return typeof v === "string" && v.trim().length > 0 ? null : `${field} must be a non-empty string.`;
}

const findItem = (s: SiteState, id: string) => s.items.find((i) => i.id === id);
const findMedia = (s: SiteState, id: string) => s.media.find((m) => m.id === id);

function mediaError(s: SiteState, id: unknown): string | null {
  if (typeof id !== "string" || !findMedia(s, id)) return `media_id "${String(id)}" not found for this venue; use an id from a photo you received.`;
  return null;
}

/** A caller-chosen id must be short and unused, or the insert would overwrite a row and its undo would delete it. */
function newIdError(id: string | undefined, list: { id: string }[]): string | null {
  if (id === undefined) return null;
  if (!UUIDISH.test(id)) return "id must be a short identifier.";
  return list.some((x) => x.id === id) ? `id "${id}" already exists.` : null;
}

/** English error for the model, or null when the op can be planned against this state. */
export function validateChange(s: SiteState, op: ChangeOp, ctx: PlanContext): string | null {
  switch (op.op) {
    case "set_price": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      return priceError(op.price_eur);
    }
    case "set_sold_out": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      if (op.until === null) return null;
      if (!isIso(op.until)) return 'until must be null, "next_opening" (resolved by the tool) or an ISO 8601 datetime with offset.';
      if (Date.parse(op.until) <= Date.parse(ctx.now)) return "until must be in the future (or null to put the item back on sale).";
      return null;
    }
    case "add_item": {
      const it = op.item;
      if (!s.categories.some((c) => c.id === it.category_id && c.active)) return `category_id "${it.category_id}" not found; use an id from get_menu.`;
      return (
        nonEmpty(it.name_bg, "name_bg") ?? nonEmpty(it.name_en, "name_en") ?? priceError(it.price_eur) ?? allergensError(it.allergens) ??
        (typeof it.desc_bg !== "string" || typeof it.desc_en !== "string" ? "desc_bg and desc_en must be strings (may be empty)." : null) ??
        (it.is_special && it.special_expires_at !== null && !isIso(it.special_expires_at) ? 'special_expires_at must be null, "closing_today" (resolved by the tool) or ISO 8601.' : null) ??
        (it.image_media_id ? mediaError(s, it.image_media_id) : null) ??
        newIdError(op.id, s.items)
      );
    }
    case "update_item": {
      const item = findItem(s, op.item_id);
      if (!item) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      const keys = Object.keys(op.patch) as (keyof typeof op.patch)[];
      if (keys.length === 0) return "patch is empty.";
      for (const k of keys) {
        const v = op.patch[k];
        if (k === "price_eur") { const e = priceError(v); if (e) return e; }
        else if (k === "allergens") { const e = allergensError(v); if (e) return e; }
        else if (k === "category_id") { if (!s.categories.some((c) => c.id === v && c.active)) return `category_id "${String(v)}" not found.`; }
        else if (k === "position") { if (!Number.isInteger(v)) return "position must be an integer."; }
        else if (k === "name_bg" || k === "name_en") { const e = nonEmpty(v, k); if (e) return e; }
        else if (k === "desc_bg" || k === "desc_en") { if (typeof v !== "string") return `${k} must be a string.`; }
        else return `patch key "${String(k)}" is not editable here.`;
      }
      return null;
    }
    case "remove_item": {
      const item = findItem(s, op.item_id);
      if (!item) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      if (!item.active) return `item_id "${op.item_id}" is already removed.`;
      return null;
    }
    case "set_item_image": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      return op.media_id === null ? null : mediaError(s, op.media_id);
    }
    case "set_cover_image":
    case "set_logo_image":
      return op.media_id === null ? null : mediaError(s, op.media_id);
    case "add_gallery_image": {
      const e = mediaError(s, op.media_id);
      if (e) return e;
      return findMedia(s, op.media_id)!.is_gallery ? `media_id "${op.media_id}" is already in the gallery.` : null;
    }
    case "remove_gallery_image": {
      const e = mediaError(s, op.media_id);
      if (e) return e;
      return findMedia(s, op.media_id)!.is_gallery ? null : `media_id "${op.media_id}" is not in the gallery.`;
    }
    case "set_hours":
      return isValidHours(op.hours) ? null : "hours must have mon..sun, each null or {open, close} as HH:MM with open < close.";
    case "add_holiday": {
      if (!DATE.test(op.date) || Number.isNaN(Date.parse(op.date))) return "date must be YYYY-MM-DD.";
      if (s.holidays.some((h) => h.date === op.date)) return `A holiday on ${op.date} already exists.`;
      return nonEmpty(op.note_bg, "note_bg") ?? nonEmpty(op.note_en, "note_en") ?? newIdError(op.id, s.holidays);
    }
    case "remove_holiday":
      return s.holidays.some((h) => h.id === op.holiday_id) ? null : `holiday_id "${op.holiday_id}" not found; use an id from get_site.`;
    case "add_announcement": {
      if (op.expires_at !== null && !isIso(op.expires_at)) return "expires_at must be null or ISO 8601 with offset.";
      return nonEmpty(op.text_bg, "text_bg") ?? nonEmpty(op.text_en, "text_en") ?? newIdError(op.id, s.announcements);
    }
    case "remove_announcement":
      return s.announcements.some((a) => a.id === op.announcement_id) ? null : `announcement_id "${op.announcement_id}" not found; use an id from get_site.`;
    case "set_text": {
      const keys: readonly string[] = [...SITE_TEXT_KEYS, ...VENUE_TEXT_KEYS];
      if (!keys.includes(op.key)) return `key must be one of ${keys.join(", ")}.`;
      if (typeof op.text_bg !== "string" || typeof op.text_en !== "string") return "text_bg and text_en must be strings.";
      return null;
    }
    case "set_theme": {
      if (op.accent === undefined && op.background === undefined) return "set_theme needs accent, background or both.";
      if (op.accent !== undefined && !(typeof op.accent === "string" && HEX.test(op.accent))) return "accent must be a hex colour like #rrggbb.";
      if (op.background === undefined || op.background === null) return null;
      if (!(typeof op.background === "string" && HEX.test(op.background))) return "background must be a hex colour like #rrggbb, or null for the design's default.";
      if (!isReadableBackground(op.background)) {
        return `background ${op.background} is a mid-tone: neither dark nor light text reads well on it (best ${bestInkContrast(op.background).toFixed(1)}:1, needs ${READABLE_BACKGROUND_MIN}:1). Propose a clearly darker or lighter shade and tell the owner why.`;
      }
      return null;
    }
    case "set_comment_mode": {
      if (!(COMMENT_MODES as readonly string[]).includes(op.mode)) return `mode must be one of ${COMMENT_MODES.join(", ")}.`;
      if (op.digest_hour !== undefined && !(Number.isInteger(op.digest_hour) && op.digest_hour >= 0 && op.digest_hour <= 23)) return "digest_hour must be a whole hour 0–23 in the venue's time zone.";
      return null;
    }
    default:
      return `unknown op "${(op as { op: string }).op}".`;
  }
}

function patchOf<T extends Row>(row: T, after: Row): { before: Row; after: Row } {
  const before: Row = {};
  for (const k of Object.keys(after)) before[k] = row[k] ?? null;
  return { before, after };
}

function change(position: number, op: ChangeOp, entity: Entity, entity_id: string, before: Row | null, after: Row | null): Change {
  return { position, op: op.op, entity, entity_id, before, after };
}

/** Turns an op into one entity write against `s`. Throws the validation error. */
export function planChange(s: SiteState, op: ChangeOp, ctx: PlanContext, position = 0): Change {
  const err = validateChange(s, op, ctx);
  if (err) throw new Error(err);
  const v = s.venue;
  switch (op.op) {
    case "set_price": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { price_eur: it.price_eur }, { price_eur: op.price_eur });
    }
    case "set_sold_out": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { sold_out_until: it.sold_out_until }, { sold_out_until: op.until });
    }
    case "add_item": {
      const id = op.id ?? ctx.newId();
      const inCat = s.items.filter((i) => i.category_id === op.item.category_id);
      const row: Item = {
        id, venue_id: v.id, category_id: op.item.category_id,
        name_bg: op.item.name_bg.trim(), name_en: op.item.name_en.trim(), desc_bg: op.item.desc_bg.trim(), desc_en: op.item.desc_en.trim(),
        price_eur: op.item.price_eur, allergens: [...op.item.allergens].sort((a, b) => a - b),
        image_media_id: op.item.image_media_id ?? null, sold_out_until: null,
        is_special: op.item.is_special, special_expires_at: op.item.is_special ? op.item.special_expires_at : null,
        position: inCat.length ? Math.max(...inCat.map((i) => i.position)) + 1 : 0,
        active: true, created_at: ctx.now, updated_at: ctx.now,
      };
      return change(position, op, "item", id, null, { ...row });
    }
    case "update_item": {
      const it = findItem(s, op.item_id)!;
      const after: Row = { ...op.patch };
      if (Array.isArray(after.allergens)) after.allergens = [...(after.allergens as number[])].sort((a, b) => a - b);
      const p = patchOf(it as unknown as Row, after);
      return change(position, op, "item", it.id, p.before, p.after);
    }
    case "remove_item":
      return change(position, op, "item", op.item_id, { active: true }, { active: false });
    case "set_item_image": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { image_media_id: it.image_media_id }, { image_media_id: op.media_id });
    }
    case "set_cover_image":
      return change(position, op, "venue", v.id, { cover_media_id: v.cover_media_id }, { cover_media_id: op.media_id });
    case "set_logo_image":
      return change(position, op, "venue", v.id, { logo_media_id: v.logo_media_id }, { logo_media_id: op.media_id });
    case "add_gallery_image": {
      const m = findMedia(s, op.media_id)!;
      const gallery = s.media.filter((x) => x.is_gallery);
      const next = gallery.length ? Math.max(...gallery.map((x) => x.position)) + 1 : 0;
      return change(position, op, "media", m.id, { is_gallery: false, position: m.position }, { is_gallery: true, position: next });
    }
    case "remove_gallery_image": {
      const m = findMedia(s, op.media_id)!;
      return change(position, op, "media", m.id, { is_gallery: true, position: m.position }, { is_gallery: false, position: m.position });
    }
    case "set_hours":
      return change(position, op, "venue", v.id, { hours: v.hours }, { hours: op.hours });
    case "add_holiday": {
      const id = op.id ?? ctx.newId();
      const row: Holiday = { id, venue_id: v.id, date: op.date, note_bg: op.note_bg.trim(), note_en: op.note_en.trim() };
      return change(position, op, "holiday", id, null, { ...row });
    }
    case "remove_holiday": {
      const h = s.holidays.find((x) => x.id === op.holiday_id)!;
      return change(position, op, "holiday", h.id, { ...h }, null);
    }
    case "add_announcement": {
      const id = op.id ?? ctx.newId();
      const row: Announcement = { id, venue_id: v.id, text_bg: op.text_bg.trim(), text_en: op.text_en.trim(), expires_at: op.expires_at, created_at: ctx.now };
      return change(position, op, "announcement", id, null, { ...row });
    }
    case "remove_announcement": {
      const a = s.announcements.find((x) => x.id === op.announcement_id)!;
      return change(position, op, "announcement", a.id, { ...a }, null);
    }
    case "set_text": {
      const key = op.key as TextKey;
      if ((SITE_TEXT_KEYS as readonly string[]).includes(key)) {
        const existing = s.texts.find((t) => t.key === key);
        const after = { text_bg: op.text_bg, text_en: op.text_en };
        if (!existing) {
          const row: SiteText = { venue_id: v.id, key: key as SiteText["key"], ...after };
          return change(position, op, "site_text", key, null, { ...row });
        }
        return change(position, op, "site_text", key, { text_bg: existing.text_bg, text_en: existing.text_en }, after);
      }
      const after: Row = MONO_TEXT_KEYS.includes(key) ? { [key]: op.text_bg } : { [`${key}_bg`]: op.text_bg, [`${key}_en`]: op.text_en };
      const p = patchOf(v as unknown as Row, after);
      return change(position, op, "venue", v.id, p.before, p.after);
    }
    case "set_theme": {
      // The theme is one venue column, so the change stores the whole object: undo puts back exactly what was there.
      const theme = { ...v.theme };
      if (op.accent !== undefined) theme.accent = op.accent.toLowerCase();
      if (op.background !== undefined) theme.background = op.background === null ? null : op.background.toLowerCase();
      return change(position, op, "venue", v.id, { theme: clone(v.theme) }, { theme });
    }
    case "set_comment_mode": {
      const after: Row = { comment_mode: op.mode, comment_digest_hour: op.digest_hour ?? v.comment_digest_hour };
      return change(position, op, "venue", v.id, { comment_mode: v.comment_mode, comment_digest_hour: v.comment_digest_hour }, after);
    }
  }
}

/** Plans ops in order against a working copy, so a later op may reference an entity an earlier one adds. */
export function planChanges(s: SiteState, ops: ChangeOp[], ctx: PlanContext): Change[] {
  const out: Change[] = [];
  let work = s;
  ops.forEach((op, i) => {
    const c = planChange(work, op, ctx, i);
    out.push(c);
    work = applyChange(work, c);
  });
  return out;
}

const clone = <T>(v: T): T => structuredClone(v);

function writeList<T extends { id: string }>(list: T[], id: string, before: Row | null, after: Row | null, what: string): T[] {
  if (after === null) return list.filter((x) => x.id !== id);
  if (before === null) {
    const row = after as unknown as T;
    return list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? clone(row) : x)) : [...list, clone(row)];
  }
  if (!list.some((x) => x.id === id)) throw new Error(`${what} ${id} not found`);
  return list.map((x) => (x.id === id ? { ...x, ...clone(after) } : x));
}

/** Pure entity write. Inserts are idempotent by id; updates merge the patch; deletes remove by id. */
export function applyChange(s: SiteState, c: Change): SiteState {
  if (isExternalEntity(c.entity)) return s; // lives on the owner's WordPress site or social accounts; the destination push writes it
  switch (c.entity) {
    case "venue":
      if (c.after === null || c.before === null) throw new Error("venue rows are only updated");
      return { ...s, venue: { ...s.venue, ...clone(c.after) } };
    case "item":
      return { ...s, items: writeList(s.items, c.entity_id, c.before, c.after, "item") };
    case "category":
      return { ...s, categories: writeList(s.categories, c.entity_id, c.before, c.after, "category") };
    case "holiday":
      return { ...s, holidays: writeList(s.holidays, c.entity_id, c.before, c.after, "holiday") };
    case "announcement":
      return { ...s, announcements: writeList(s.announcements, c.entity_id, c.before, c.after, "announcement") };
    case "media":
      return { ...s, media: writeList(s.media, c.entity_id, c.before, c.after, "media") };
    case "site_text": {
      const key = c.entity_id;
      if (c.after === null) return { ...s, texts: s.texts.filter((t) => t.key !== key) };
      if (c.before === null) {
        const row = c.after as unknown as SiteText;
        return { ...s, texts: [...s.texts.filter((t) => t.key !== key), clone(row)] };
      }
      return { ...s, texts: s.texts.map((t) => (t.key === key ? { ...t, ...clone(c.after) } : t)) };
    }
  }
}

export function applyChanges(s: SiteState, changes: Change[]): SiteState {
  return [...changes].sort((a, b) => a.position - b.position).reduce(applyChange, s);
}

function invertChange(c: Change): Change {
  return { ...c, before: clone(c.after), after: clone(c.before) };
}

/** Reverse order, swapped before/after, renumbered from 0. */
export function invertChanges(changes: Change[]): Change[] {
  return [...changes]
    .sort((a, b) => b.position - a.position)
    .map((c, i) => ({ ...invertChange(c), position: i }));
}
