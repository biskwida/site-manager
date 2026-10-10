// test/helpers.ts
import { seedDemo } from "@/src/seed/demo";
import { InMemoryStore } from "@/src/store/memory";
import type { Category, Item, Venue } from "@/src/domain/types";

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
