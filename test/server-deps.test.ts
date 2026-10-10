// test/server-deps.test.ts
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { makeServerDeps } from "@/src/server/deps";
import { InMemoryStore } from "@/src/store/memory";
import { seedDemo } from "@/src/seed/demo";
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
    expect(deps.anthropic).toBeNull(); // no ANTHROPIC_API_KEY: the wizard AI routes answer 503
  });

  it("builds one Anthropic client from ANTHROPIC_API_KEY, or uses the injected client (R17)", async () => {
    const keyed = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", ANTHROPIC_API_KEY: "sk-test-not-used" }, log: () => {} });
    expect(keyed.anthropic).toBeInstanceOf(Anthropic);
    const client = { beta: { messages: {} } } as unknown as Anthropic;
    const injected = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", ANTHROPIC_API_KEY: "sk-test-not-used" }, log: () => {}, client });
    expect(injected.anthropic).toBe(client);
  });

  it("uses the fake deployer in memory mode (even with a Vercel token) and deploys a live venue on demand", async () => {
    const jobs: Promise<void>[] = [];
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory", VERCEL_TOKEN: "never-used" }, log: (s) => logs.push(s) });
    expect(deps.deployer?.provider).toBe("fake");
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
    expect(deps.anthropic).toBe(client);
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

/** Production-shaped env (no SITE_MANAGER_STORE, so the config is strict); values are placeholders, never used for network calls here. */
const PROD_ENV = {
  ANTHROPIC_API_KEY: "sk-test-not-used",
  TELEGRAM_BOT_TOKEN: "123:not-used",
  TELEGRAM_WEBHOOK_SECRET: "whs",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  PUBLIC_BASE_URL: "https://sm.example",
  TICK_SECRET: "tick",
};

describe("makeServerDeps (Supabase mode)", () => {
  it("has no deployer without VERCEL_TOKEN: sites are served from the hosted /<slug>, never a fake deployment", async () => {
    const logs: string[] = [];
    const store = new InMemoryStore();
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: PROD_ENV, store, log: (s) => logs.push(s) });
    expect(deps.isMemory).toBe(false);
    expect(deps.deployer).toBeNull();
    expect(logs.join("\n")).toContain("[deploy] no VERCEL_TOKEN");
    expect(logs.join("\n")).not.toContain("fake deployer");
  });

  it("uses the Vercel deployer when VERCEL_TOKEN is set", async () => {
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { ...PROD_ENV, VERCEL_TOKEN: "vt-not-used" }, store: new InMemoryStore(), log: () => {} });
    expect(deps.deployer?.provider).toBe("vercel");
  });

  it("an owner redeem without a deployer gets the normal welcome only: no publishing line, no deploy", async () => {
    const jobs: Promise<void>[] = [];
    const store = new InMemoryStore();
    const { venue } = await seedDemo(store);
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: PROD_ENV, store, log: () => {} });
    deps.bot.botInfo = BOT_INFO;
    const code = await store.createInvite(venue.id, "owner", "2099-01-01T00:00:00.000Z");
    const api = captureApi(deps.bot);
    await deps.bot.handleUpdate(textUpdate(4101, `/start ${code}`, "bg"));
    await Promise.all(jobs);
    expect(api.texts()).toHaveLength(1);
    expect(api.texts()[0]).toMatch(/^Свързахте се като собственик/);
    expect((await store.getVenue(venue.id)).deploy).toBeNull();
    deps.startDeploy(venue.id); // a no-op without a deployer
    await Promise.all(jobs);
    expect((await store.getVenue(venue.id)).deploy).toBeNull();
  });
});
