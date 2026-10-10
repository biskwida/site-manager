// test/server-deps.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { makeServerDeps } from "@/src/server/deps";
import { BOT_INFO, captureApi, textUpdate } from "./tg";

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

  it("uses the fake deployer in memory mode (even with a Vercel token) and deploys a live venue on demand", async () => {
    const jobs: Promise<void>[] = [];
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory", VERCEL_TOKEN: "never-used" }, log: (s) => logs.push(s) });
    expect(deps.deployer.provider).toBe("fake");
    expect(logs.join("\n")).toContain("[deploy] fake deployer (memory store)");
    expect(logs.join("\n")).not.toContain("never-used");
    const venue = await deps.store.getVenueBySlug("agala");
    deps.startDeploy(venue!.id);
    await Promise.all(jobs);
    expect((await deps.store.getVenue(venue!.id)).deploy).toMatchObject({ provider: "fake", status: "building", template: "classic" });
    expect((await deps.store.getVenue(venue!.id)).deploy?.project_id).toMatch(/^fake-prj-/);
    expect(deps.bot).toBeDefined();
  });

  it("wires onOwnerJoined to startDeploy so an owner redeem publishes the site, and the per-webhook tick polls it", async () => {
    const jobs: Promise<void>[] = [];
    // The agent turn inside handleRun gets a stub client that ends immediately; only the tick matters here.
    const client = { beta: { messages: { toolRunner: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }) } } } as unknown as Anthropic;
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory" }, log: () => {}, client });
    deps.bot.botInfo = BOT_INFO;
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const code = await deps.store.createInvite(venue.id, "owner", "2099-01-01T00:00:00.000Z"); // the bot uses the real clock here
    const api = captureApi(deps.bot);
    await deps.bot.handleUpdate(textUpdate(4001, `/start ${code}`, "bg"));
    await Promise.all(jobs);
    expect(api.texts().at(-1)).toMatch(/^Сайтът ви се публикува/);
    expect((await deps.store.getVenue(venue.id)).deploy).toMatchObject({ provider: "fake", status: "building" });
    // handleRun runs the venue tick with the deployer: the fake is ready on its second status() call
    const member = (await deps.store.findMember(4001))!;
    const run = { venueId: venue.id, chatId: 4001, member, text: "", source: "text" as const };
    await deps.handleRun(run);
    await deps.handleRun(run);
    expect((await deps.store.getVenue(venue.id)).deploy).toMatchObject({ status: "ready", url: "https://agala.example.test" });
    expect(api.texts().filter((t) => t.includes("https://agala.example.test"))).toHaveLength(1);
  });
});
