// test/helpers.ts
import { seedDemo } from "@/src/seed/demo";
import { oklchToHex } from "@/src/templates/shared/color";
import { InMemoryStore } from "@/src/store/memory";
import type { Category, Item, Lang, Venue } from "@/src/domain/types";
import type { Messenger } from "@/src/bot/messenger";

export interface Demo {
  store: InMemoryStore;
  venue: Venue;
  categories: Record<string, Category>; // by name_en
  items: Record<string, Item>; // by name_en
}

/** A memory store with the demo venue and an owner (chat 1001, bg) and a staff member (chat 1002, en). */
export async function makeDemo(): Promise<Demo> {
  const store = new InMemoryStore();
  const seeded = await seedDemo(store);
  await store.upsertMember({ venue_id: seeded.venue.id, tg_chat_id: 1001, role: "owner", lang: "bg" });
  await store.upsertMember({ venue_id: seeded.venue.id, tg_chat_id: 1002, role: "staff", lang: "en" });
  return {
    store,
    venue: seeded.venue,
    categories: Object.fromEntries(seeded.categories.map((c) => [c.name_en, c])),
    items: Object.fromEntries(seeded.items.map((i) => [i.name_en, i])),
  };
}

export class FakeMessenger implements Messenger {
  sent: { chatId: number; text: string; setId?: string; lang?: Lang; messageId: number }[] = [];
  edits: { chatId: number; messageId: number; text: string }[] = [];
  private next = 100;
  async send(chatId: number, text: string) {
    const messageId = this.next++;
    this.sent.push({ chatId, text, messageId });
    return messageId;
  }
  async sendProposal(chatId: number, text: string, setId: string, lang: Lang) {
    const messageId = this.next++;
    this.sent.push({ chatId, text, setId, lang, messageId });
    return messageId;
  }
  async edit(chatId: number, messageId: number, text: string) {
    this.edits.push({ chatId, messageId, text });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}

/** The only keywords a strict tool input_schema may use; the Messages API rejects constraints such as minimum or minLength. */
export const TOOL_SCHEMA_KEYWORDS = ["type", "properties", "required", "additionalProperties", "enum", "description", "items"] as const;

/**
 * Schema-aware walk (descends through properties.* values and items only, so property names are never read as keywords).
 * Returns one line per violation — a keyword outside the allow-list, or a non-string "type" — empty when the schema is safe to send.
 */
export function toolSchemaViolations(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [`${path}: not a schema object`];
  const node = schema as Record<string, unknown>;
  const out: string[] = [];
  for (const k of Object.keys(node)) {
    if (!(TOOL_SCHEMA_KEYWORDS as readonly string[]).includes(k)) out.push(`${path}.${k}: keyword not allowed`);
  }
  if (typeof node.type !== "string") out.push(`${path}.type: must be a string`);
  if ("properties" in node) {
    const props = node.properties;
    if (!props || typeof props !== "object" || Array.isArray(props)) out.push(`${path}.properties: must be an object`);
    else for (const [name, sub] of Object.entries(props)) out.push(...toolSchemaViolations(sub, `${path}.properties[${JSON.stringify(name)}]`));
  }
  if ("items" in node) out.push(...toolSchemaViolations(node.items, `${path}.items`));
  return out;
}

/** Owner picks outside every template's comfortable range: a very light butter and a near-black violet. */
export const EXTREME_ACCENTS = ["#f4e7a1", "#1a0b3d"];

/** Re-exported so template tests and the Look step share one list. */
export { LOOK_ACCENT_PRESETS } from "@/src/wizard/schema";

/**
 * Owner accents spread over the whole colour space for contrast sweeps: 64 evenly spaced OKLCH hues × L {0.45, 0.65, 0.85} ×
 * C {0.05, 0.15, 0.25}, converted to #rrggbb (out-of-gamut ones lose chroma, as a colour picker would give them).
 */
export function sweepAccents(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 64; i++) for (const l of [0.45, 0.65, 0.85]) for (const c of [0.05, 0.15, 0.25]) out.push(oklchToHex({ l, c, h: (i * 360) / 64 }));
  return out;
}
