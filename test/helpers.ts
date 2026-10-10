// test/helpers.ts
import { seedDemo } from "@/src/seed/demo";
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

/** JSON Schema keywords the Messages API rejects inside a tool's input_schema (HTTP 400), plus zod's "$schema"/"$defs"/"$ref". */
export const FORBIDDEN_TOOL_SCHEMA_KEYS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format", "default", "nullable", "$schema", "$defs", "$ref"] as const;

/** Paths (dot-joined) of every forbidden keyword anywhere in the schema; empty when the schema is safe to send. */
export function forbiddenSchemaKeys(schema: unknown, path: string[] = []): string[] {
  if (Array.isArray(schema)) return schema.flatMap((v, i) => forbiddenSchemaKeys(v, [...path, String(i)]));
  if (!schema || typeof schema !== "object") return [];
  return Object.entries(schema).flatMap(([k, v]) => {
    const here = [...path, k];
    const own = (FORBIDDEN_TOOL_SCHEMA_KEYS as readonly string[]).includes(k) ? [here.join(".")] : [];
    return [...own, ...forbiddenSchemaKeys(v, here)];
  });
}
