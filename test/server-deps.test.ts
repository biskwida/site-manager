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
    expect(await deps.store.findMember("tg:777")).toMatchObject({ role: "owner" });
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
    const sleeps: number[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory", VERCEL_TOKEN: "never-used" }, log: (s) => logs.push(s), sleep: async (ms) => void sleeps.push(ms) });
    expect(deps.deployer?.provider).toBe("fake");
    expect(logs.join("\n")).toContain("[deploy] fake deployer (memory store)");
    expect(logs.join("\n")).not.toContain("never-used");
    const venue = await deps.store.getVenueBySlug("agala");
    deps.startDeploy(venue!.id);
    await Promise.all(jobs);
    // the background watch after the start polls until the fake is ready (second status call): no open tab needed
    expect(sleeps).toEqual([10_000, 10_000]);
    expect((await deps.store.getVenue(venue!.id)).deploy).toMatchObject({ provider: "fake", status: "ready", template: "classic" });
    expect((await deps.store.getVenue(venue!.id)).deploy?.project_id).toMatch(/^fake-prj-/);
    expect(deps.bot).toBeDefined();
  });

  it("wires onOwnerJoined to startDeploy so an owner redeem publishes the site and the background watch finishes it", async () => {
    const jobs: Promise<void>[] = [];
    // The agent turn inside handleRun gets a stub client that ends immediately; only the tick matters here.
    const client = { beta: { messages: { toolRunner: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }) } } } as unknown as Anthropic;
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory" }, log: () => {}, client, sleep: async () => {} });
    expect(deps.anthropic).toBe(client);
    deps.bot.botInfo = BOT_INFO;
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const code = await deps.store.createInvite(venue.id, "owner", "2099-01-01T00:00:00.000Z"); // the bot uses the real clock here
    const api = captureApi(deps.bot);
    await deps.bot.handleUpdate(textUpdate(4001, `/start ${code}`, "bg"));
    await Promise.all(jobs);
    expect(api.texts()[1]).toMatch(/^Сайтът ви се публикува/);
    expect((await deps.store.getVenue(venue.id)).deploy).toMatchObject({ provider: "fake", status: "ready", url: "https://agala.example.test" });
    expect(api.texts().filter((t) => t.includes("https://agala.example.test"))).toHaveLength(1);
    // a later per-webhook tick (handleRun) finds nothing in flight and sends nothing more
    const member = (await deps.store.findMember("tg:4001"))!;
    await deps.handleRun({ venueId: venue.id, chatRef: "tg:4001", member, text: "", source: "text" as const });
    expect(api.texts().filter((t) => t.includes("https://agala.example.test"))).toHaveLength(1);
  });

  it("watchDeploy polls an in-flight template switch in the background", async () => {
    const jobs: Promise<void>[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void jobs.push(fn()), env: { SITE_MANAGER_STORE: "memory" }, log: () => {}, sleep: async () => {} });
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    const created = await deps.deployer!.createSite({ slug: "agala", templateId: "lumen", feedUrl: "x" });
    await deps.store.setDeploy(venue.id, { provider: "fake", project_id: created.projectId, deployment_id: created.deploymentId, url: "https://agala.example.test", status: "building", error: null, template: "lumen", updated_at: new Date().toISOString() });
    deps.watchDeploy(venue.id);
    await Promise.all(jobs);
    expect((await deps.store.getVenue(venue.id)).deploy?.status).toBe("ready");
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
    const cs = await deps.store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "A" }, after: { value: "B" } }] });
    expect(await deps.store.applyChangeSet(cs.id, new Date().toISOString())).toBe("applied");
    expect(await deps.store.listSyncs({ changeSetId: cs.id })).toHaveLength(1);
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
