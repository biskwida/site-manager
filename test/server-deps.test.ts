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
});
