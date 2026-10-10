// src/wizard/demo-state.ts
// The chooser shows the demo café in every template. Seeded once per server process into a throwaway memory store.
import type { SiteState } from "../domain/types";
import { seedDemo } from "../seed/demo";
import { InMemoryStore } from "../store/memory";

let cached: Promise<SiteState> | null = null;
export function demoSiteState(): Promise<SiteState> {
  cached ??= (async () => {
    const store = new InMemoryStore();
    const { venue } = await seedDemo(store);
    return store.getSite(venue.id);
  })();
  return cached;
}
