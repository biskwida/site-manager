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
    expect(await deps.store.findMember("tg:777")).toMatchObject({ role: "owner" });
    expect(logs.join("\n")).toMatch(/admin link: http:\/\/localhost:3000\/admin\/agala\?key=/);
  });
  it("routes Meta refs to console adapters in memory mode (no tokens)", async () => {
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", DEMO_OWNER_CHAT_REF: "fb:4242" }, log: (s) => logs.push(s) });
    expect(await deps.store.findMember("fb:4242")).toMatchObject({ role: "owner" });
    expect(await deps.messenger.send("fb:4242", "hi")).toBe("c1");
    expect(logs).toContain("→ [fb:4242] hi");
    expect(deps.botDeps.messenger).toBe(deps.messenger);
    expect(typeof deps.waDownload).toBe("function");
    expect(typeof deps.fetchUrl).toBe("function");
  });
});
