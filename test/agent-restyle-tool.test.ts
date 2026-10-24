// test/agent-restyle-tool.test.ts: the restyle_photo tool (src/agent/visual-tools.ts) with a fake VisualClient.
import { describe, expect, it, vi } from "vitest";
import { copy } from "@/src/bot/copy";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { RestylePhotoSchema } from "@/src/agent/visual-tools";
import type { VisualClient } from "@/src/visual/client";
import type { RestyleRequest, RestyleResult } from "@/src/visual/restyle";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-24T09:00:00.000Z");
const URL1 = "https://media.example/storage/restyle/1.jpg";
const ok = (generation = 1, mood: "default" | "darker" | "brighter" | "minimal" = "default"): RestyleResult => ({ media_id: "m-new", url: URL1, generation, mood });

async function setup(opts: { restyle?: RestyleResult | ((req: RestyleRequest) => Promise<RestyleResult>); chatRef?: string; lang?: "bg" | "en"; withRestyle?: boolean } = {}) {
  const demo = await makeDemo();
  const chatRef = opts.chatRef ?? "tg:1001";
  if (opts.lang) await demo.store.setMemberLang(demo.venue.id, chatRef, opts.lang);
  const member = (await demo.store.findMember(chatRef))!;
  const restyle = vi.fn(async (req: RestyleRequest) => (typeof opts.restyle === "function" ? opts.restyle(req) : (opts.restyle ?? ok())));
  const visual: VisualClient = Object.assign(async () => { throw new Error("make_visual is not used here"); }, opts.withRestyle === false ? {} : { restyle }) as VisualClient;
  const messenger = new FakeMessenger();
  const sentPhotos = new Set<string>();
  const notes: string[] = [];
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef, member, messenger, now: () => T0, baseUrl: "https://site.example", visual, sentPhotos, notes };
  const tools = makeTools(deps);
  return { ...demo, restyle, messenger, sentPhotos, notes, deps, tools };
}

describe("restyle_photo availability", () => {
  it("is registered only when the visual client has restyle", async () => {
    expect((await setup()).tools.map((t) => t.name)).toContain("restyle_photo");
    const without = await setup({ withRestyle: false });
    expect(without.tools.map((t) => t.name)).not.toContain("restyle_photo");
    expect(without.tools.map((t) => t.name)).toContain("make_visual");
  });
  it("the schema takes a media_id, a mood from the service's moods and an optional item_id", () => {
    expect(RestylePhotoSchema.safeParse({ media_id: "a" }).success).toBe(true);
    expect(RestylePhotoSchema.safeParse({ media_id: "a", mood: "darker", item_id: "i" }).success).toBe(true);
    expect(RestylePhotoSchema.safeParse({ media_id: "a", mood: "neon" }).success).toBe(false);
  });
});

describe("restyle_photo", () => {
  it("refuses staff", async () => {
    const s = await setup({ chatRef: "tg:1002" });
    const r = await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(r.error).toMatch(/owner/);
    expect(s.restyle).not.toHaveBeenCalled();
  });

  it("calls the service with the venue, photo, default mood and the item's name in the owner's language", async () => {
    const s = await setup();
    const item = s.items["Cappuccino"];
    await call(s.tools, "restyle_photo", { media_id: "p1", item_id: item.id });
    expect(s.restyle).toHaveBeenCalledWith({ venueId: s.venue.id, mediaId: "p1", mood: "default", item: item.name_bg });
    const en = await setup({ lang: "en" });
    await call(en.tools, "restyle_photo", { media_id: "p1", mood: "darker", item_id: en.items["Cappuccino"].id });
    expect(en.restyle).toHaveBeenCalledWith({ venueId: en.venue.id, mediaId: "p1", mood: "darker", item: en.items["Cappuccino"].name_en });
  });

  it("passes item null without an item_id, and refuses an unknown item_id before calling the service", async () => {
    const s = await setup();
    await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(s.restyle).toHaveBeenCalledWith({ venueId: s.venue.id, mediaId: "p1", mood: "default", item: null });
    s.restyle.mockClear();
    const r = await call(s.tools, "restyle_photo", { media_id: "p1", item_id: "nope" });
    expect(r.error).toMatch(/item_id not found/);
    expect(s.restyle).not.toHaveBeenCalled();
  });

  it("sends the restyled photo once with the caption, records it, and tells the agent what to ask (generation 1 names the redo words)", async () => {
    const s = await setup();
    const r = await call(s.tools, "restyle_photo", { media_id: "p1", item_id: s.items["Cappuccino"].id });
    expect(s.messenger.photos).toHaveLength(1);
    expect(s.messenger.photos[0]).toMatchObject({ chatRef: "tg:1001", url: URL1, caption: "Разкрасена" });
    expect(s.sentPhotos.has(URL1)).toBe(true);
    expect(s.notes.join("\n")).toContain("restyle from photo p1: m-new (default, generation 1)");
    expect(r).toMatchObject({ media_id: "m-new", generation: 1, mood: "default" });
    expect(r).not.toHaveProperty("url");
    const next = String(r.next);
    expect(next).toContain("social_post");
    expect(next).toContain("set_item_image");
    expect(next).toContain(s.items["Cappuccino"].name_bg);
    for (const w of ["darker", "brighter", "more minimal", "по-тъмна", "по-светла", "по-минималистична"]) expect(next).toContain(w);
  });

  it("uses the English caption for an English owner, and asks which item when none was given", async () => {
    const s = await setup({ lang: "en" });
    const r = await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(s.messenger.photos[0].caption).toBe("Restyled");
    expect(String(r.next)).toMatch(/which item/i);
    expect(String(r.next)).toContain("get_menu");
  });

  it("generation 2 and 3 ask the same question without the redo words", async () => {
    for (const g of [2, 3]) {
      const s = await setup({ restyle: ok(g, "darker") });
      const r = await call(s.tools, "restyle_photo", { media_id: "p1", mood: "darker" });
      expect(r).toMatchObject({ generation: g, mood: "darker" });
      expect(String(r.next)).toContain("social_post");
      expect(String(r.next)).toContain("set_item_image");
      for (const w of ["darker", "brighter", "more minimal", "по-тъмна", "по-светла", "по-минималистична"]) expect(String(r.next)).not.toContain(w);
    }
  });

  it("a fallback sends no photo and its next points to make_visual (post) and make_menu_photo (website)", async () => {
    const s = await setup({ restyle: { fallback: "card", reason: "refused" } });
    const r = await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(r).toMatchObject({ fallback: "card", reason: "refused" });
    expect(String(r.next)).toMatch(/make_visual/);
    expect(String(r.next)).toMatch(/make_menu_photo/);
    expect(String(r.next)).toMatch(/people|faces/);
    expect(s.messenger.photos).toHaveLength(0);
    expect(s.sentPhotos.size).toBe(0);
    const other = await setup({ restyle: { fallback: "card", reason: "timeout" } });
    const o = await call(other.tools, "restyle_photo", { media_id: "p1" });
    expect(String(o.next)).not.toMatch(/people|faces/);
  });

  it("refusals are the owner's line in her language, with the number from the limit", async () => {
    const lines = async (restyle: RestyleResult, lang: "bg" | "en") => String((await call((await setup({ restyle, lang })).tools, "restyle_photo", { media_id: "p1" })).error);
    expect(await lines({ error: "monthly_limit", used: 30, limit: 30 }, "en")).toContain("That's the 30 restyles for this month; from the 1st again.");
    expect(await lines({ error: "monthly_limit", used: 30, limit: 30 }, "bg")).toContain("Това бяха 30-те разкрасявания за този месец; от 1-во число отново.");
    expect(await lines({ error: "monthly_limit", used: 12, limit: 12 }, "en")).toContain("12");
    expect(await lines({ error: "trial_limit", used: 5, limit: 5 }, "en")).toContain("The trial includes 5 restyled photos; the plan has 30 a month.");
    expect(await lines({ error: "trial_limit", used: 5, limit: 5 }, "bg")).toContain("Пробният период включва 5 разкрасени снимки; планът има 30 на месец.");
    expect(await lines({ error: "too_many_generations" }, "en")).toContain("Three versions is the most for one photo; send it again as a new photo if you want more.");
    expect(await lines({ error: "too_many_generations" }, "bg")).toContain("Три варианта са максимумът за една снимка; изпрати я пак като нова, ако искаш още.");
    expect(await lines({ error: "source_is_restyle" }, "en")).toContain("Send the original photo; restyling always starts from it.");
    expect(await lines({ error: "source_is_restyle" }, "bg")).toContain("Изпрати оригиналната снимка; разкрасяването винаги тръгва от нея.");
    expect(await lines({ error: "no_photo" }, "en")).toContain("I can't find that photo; send it again.");
    expect(await lines({ error: "no_photo" }, "bg")).toContain("Не намирам тази снимка; изпрати я пак.");
  });

  it("a refusal sends no photo", async () => {
    const s = await setup({ restyle: { error: "monthly_limit", used: 30, limit: 30 } });
    await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(s.messenger.photos).toHaveLength(0);
  });
});

describe("restyle_photo and the plan", () => {
  const BILLING = { billingEnabled: true, trialChangeLimit: 20, trialRequiresCard: false, publicBaseUrl: "https://site.example" };
  it("an Admin plan with billing on gets the not-in-plan line and the service is not called", async () => {
    const s = await setup();
    s.store.billingConfig = BILLING;
    await s.store.updateVenue(s.venue.id, { plan: "admin", billing_status: "active" });
    const r = await call(s.tools, "restyle_photo", { media_id: "p1" });
    expect(r.error).toContain("(not_in_plan)");
    expect(r.error).toContain(copy("bg").notInPlanRefusal("social", "Admin", `https://site.example/billing/${s.venue.slug}`));
    expect(s.restyle).not.toHaveBeenCalled();
    expect(s.messenger.photos).toHaveLength(0);
  });
  it("a Social plan passes", async () => {
    const s = await setup();
    s.store.billingConfig = BILLING;
    await s.store.updateVenue(s.venue.id, { plan: "social", billing_status: "active" });
    expect((await call(s.tools, "restyle_photo", { media_id: "p1" })).generation).toBe(1);
  });
  it("with billing off a venue with no plan is allowed", async () => {
    const s = await setup();
    expect((await call(s.tools, "restyle_photo", { media_id: "p1" })).generation).toBe(1);
  });
});
