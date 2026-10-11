// test/helpers.ts
import { seedDemo } from "@/src/seed/demo";
import { InMemoryStore } from "@/src/store/memory";
import type { Category, Item, Lang, Venue } from "@/src/domain/types";
import type { Messenger, SendOpts } from "@/src/bot/messenger";

export interface Demo {
  store: InMemoryStore;
  venue: Venue;
  categories: Record<string, Category>; // by name_en
  items: Record<string, Item>; // by name_en
}

/** A memory store with the demo venue and an owner (chat tg:1001, bg) and a staff member (chat tg:1002, en). */
export async function makeDemo(): Promise<Demo> {
  const store = new InMemoryStore();
  const seeded = await seedDemo(store);
  await store.upsertMember({ venue_id: seeded.venue.id, chat_ref: "tg:1001", role: "owner", lang: "bg" });
  await store.upsertMember({ venue_id: seeded.venue.id, chat_ref: "tg:1002", role: "staff", lang: "en" });
  return {
    store,
    venue: seeded.venue,
    categories: Object.fromEntries(seeded.categories.map((c) => [c.name_en, c])),
    items: Object.fromEntries(seeded.items.map((i) => [i.name_en, i])),
  };
}

export class FakeMessenger implements Messenger {
  sent: { chatRef: string; text: string; setId?: string; lang?: Lang; messageRef: string; proactive?: boolean }[] = [];
  concluded: { chatRef: string; messageRef: string | null; full: string; short: string; proactive?: boolean }[] = [];
  typed: string[] = [];
  private next = 100;
  async send(chatRef: string, text: string, opts?: SendOpts) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, messageRef, proactive: opts?.proactive });
    return messageRef;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, setId, lang, messageRef });
    return messageRef;
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts) {
    this.concluded.push({ chatRef, messageRef, full, short, proactive: opts?.proactive });
  }
  async typing(chatRef: string) {
    this.typed.push(chatRef);
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
