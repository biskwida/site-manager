// test/server-deps.test.ts
import { describe, expect, it } from "vitest";
import { makeServerDeps } from "@/src/server/deps";

describe("makeServerDeps (memory mode)", () => {
  it("seeds the demo venue and a demo owner, and never needs secrets", async () => {
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", DEMO_OWNER_CHAT_ID: "777" }, log: (s) => logs.push(s) });
    expect(deps.isMemory).toBe(true);
    const venue = await deps.store.getVenueBySlug("agala");
    expect(venue?.name).toBe("Кафене „Ъгъла“");
    expect((await deps.store.getSite(venue!.id)).items.length).toBe(12);
    expect(await deps.store.findMember(777)).toMatchObject({ role: "owner" });
    expect(logs.join("\n")).toMatch(/admin link: http:\/\/localhost:3000\/admin\/agala\?key=/);
  });
  it("wires the dev secret key and the sync hook in memory mode", async () => {
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory" }, log: (s) => logs.push(s) });
    expect(deps.destinationSecretKey).toHaveLength(32);
    expect(deps.sync?.store).toBeDefined();
    expect(logs.join("\n")).toMatch(/DESTINATION_SECRET_KEY is not set/);
  });
  it("returns the store decorated with the destination sync hook (an apply with a wp_* row records a sync)", async () => {
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory" }, log: () => {} });
    expect(deps.store).not.toBe(deps.sync?.store);
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    // Undecryptable secrets: the push fails at once without any network call, but the sync row must exist.
    await deps.store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: "https://cafe.example" }, secrets: "not-a-blob" });
    const cs = await deps.store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "A" }, after: { value: "B" } }] });
    expect(await deps.store.applyChangeSet(cs.id, new Date().toISOString())).toBe("applied");
    expect(await deps.store.listSyncs({ changeSetId: cs.id })).toHaveLength(1);
  });
});
