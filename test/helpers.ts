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
  sent: { chatRef: string; text: string; setId?: string; lang?: Lang; messageRef: string }[] = [];
  edits: { chatRef: string; messageRef: string; text: string }[] = [];
  private next = 100;
  async send(chatRef: string, text: string) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, messageRef });
    return messageRef;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    const messageRef = String(this.next++);
    this.sent.push({ chatRef, text, setId, lang, messageRef });
    return messageRef;
  }
  async edit(chatRef: string, messageRef: string, text: string) {
    this.edits.push({ chatRef, messageRef, text });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}
