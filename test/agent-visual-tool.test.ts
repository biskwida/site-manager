// test/agent-visual-tool.test.ts
import { describe, expect, it } from "vitest";
import { colourWord, MakeMenuPhotoSchema } from "@/src/agent/visual-tools";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { SYSTEM_PROMPT } from "@/src/agent/prompt";
import type { Messenger } from "@/src/bot/messenger";
import type { VisualClient } from "@/src/visual/client";
import type { MenuPhotoRequest, MenuPhotoResult, VisualRequest } from "@/src/visual/service";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-14T09:00:00.000Z");

async function setup(over: Partial<AgentDeps> = {}, fail?: string) {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember("tg:1001"))!;
  const photo = await demo.store.saveMedia(demo.venue.id, new Uint8Array([0xff, 0xd8]), "image/jpeg");
  const requests: VisualRequest[] = [];
  const visual: VisualClient = async (req) => {
    requests.push(req);
    if (fail) throw new Error(fail);
    return {
      kind: "cutout",
      backdrop: req.colour || "teal",
      pictures: req.formats.map((format, i) => ({ format, media_id: `vis-${format}-${requests.length}-${i}`, url: `https://media.example/${format}.jpg` })),
    };
  };
  const notes: string[] = [];
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example", social: { facebook: false, instagram: true }, visual, notes, ...over };
  return { ...demo, messenger, deps, photo, requests, notes, tools: makeTools(deps) };
}

describe("make_visual", () => {
  it("is offered only when the picture service is configured", async () => {
    expect((await setup()).tools.map((t) => t.name)).toContain("make_visual");
    expect((await setup({ visual: null })).tools.map((t) => t.name)).not.toContain("make_visual");
  });

  it("makes the pictures, sends them to the chat, remembers their ids and asks for the posting proposal next", async () => {
    const { tools, photo, messenger, requests, notes, venue } = await setup();
    const r = await call(tools, "make_visual", { media_id: photo.id, dish: "Флат уайт", price: "4,30 €", line: "Със сърце", colour: "peach", formats: ["post", "story"] });
    expect(requests).toEqual([{ venueId: venue.id, mediaId: photo.id, dish: "Флат уайт", price: "4,30 €", line: "Със сърце", colour: "peach", formats: ["post", "story"] }]);
    expect(messenger.photos.map((p) => p.url)).toEqual(["https://media.example/post.jpg", "https://media.example/story.jpg"]);
    expect(r).toMatchObject({ pictures: [{ format: "post", media_id: "vis-post-1-0" }, { format: "story", media_id: "vis-story-1-1" }], backdrop: "peach" });
    expect(String(r.next)).toMatch(/social_post/);
    expect(notes.join(" ")).toContain(`from photo ${photo.id}`);
    expect(notes.join(" ")).toContain("post vis-post-1-0");
    expect(notes.join(" ")).toContain("story vis-story-1-1");
  });

  it("labels each picture with its format in the owner's language", async () => {
    const bg = await setup();
    await call(bg.tools, "make_visual", { media_id: bg.photo.id, dish: "Флат уайт", formats: ["post", "story"] });
    expect(bg.messenger.photos.map((p) => [p.url, p.caption])).toEqual([["https://media.example/post.jpg", "Пост"], ["https://media.example/story.jpg", "История"]]);
    const en = await setup();
    const english = makeTools({ ...en.deps, member: { ...en.deps.member, lang: "en" } });
    await call(english, "make_visual", { media_id: en.photo.id, dish: "Flat white", formats: ["post", "story"] });
    expect(en.messenger.photos.map((p) => [p.url, p.caption])).toEqual([["https://media.example/post.jpg", "Post"], ["https://media.example/story.jpg", "Story"]]);
  });

  it("records every picture it sends in sentPhotos", async () => {
    const sentPhotos = new Set<string>();
    const { tools, photo } = await setup({ sentPhotos });
    await call(tools, "make_visual", { media_id: photo.id, dish: "Флат уайт", formats: ["post", "story"] });
    expect([...sentPhotos]).toEqual(["https://media.example/post.jpg", "https://media.example/story.jpg"]);
    // A picture that did not reach the chat is not recorded, so social_post sends it with its label.
    const failing = await setup({ sentPhotos: new Set() });
    (failing.messenger as Messenger).sendPhoto = async (_chatRef, url) => (url.endsWith("/story.jpg") ? null : "1");
    await call(failing.tools, "make_visual", { media_id: failing.photo.id, dish: "Флат уайт", formats: ["post", "story"] });
    expect([...failing.deps.sentPhotos!]).toEqual(["https://media.example/post.jpg"]);
  });

  it("without Instagram or Facebook still makes the picture and says how to connect", async () => {
    const { tools, photo, messenger } = await setup({ social: { facebook: false, instagram: false } });
    const r = await call(tools, "make_visual", { media_id: photo.id, dish: "Flat white", formats: ["post"] });
    expect(messenger.photos).toHaveLength(1);
    expect(String(r.next)).toMatch(/not connected/i);
  });

  it("refuses staff, a long name, and reports the service's error", async () => {
    const base = await setup();
    const staff = (await base.store.findMember("tg:1002"))!;
    const asStaff = makeTools({ ...base.deps, chatRef: "tg:1002", member: staff });
    expect((await call(asStaff, "make_visual", { media_id: base.photo.id, dish: "x", formats: ["post"] })).error).toMatch(/owner/);
    expect((await call(base.tools, "make_visual", { media_id: base.photo.id, dish: "x".repeat(41), formats: ["post"] })).error).toMatch(/40 characters/);
    const failing = await setup({}, "Could not read the photo; try again in a moment.");
    expect((await call(failing.tools, "make_visual", { media_id: failing.photo.id, dish: "x", formats: ["post"] })).error).toMatch(/Could not read the photo/);
    expect(failing.messenger.photos).toHaveLength(0);
  });

  it("the prompt tells the agent when to make a picture and to put the posting buttons under it", () => {
    expect(SYSTEM_PROMPT).toMatch(/make_visual/);
    expect(SYSTEM_PROMPT).toMatch(/направи пост/);
    expect(SYSTEM_PROMPT).toMatch(/праскова/);
  });

  it("asks for the caption in the owner's language, not the venue's, once the picture is in the chat", async () => {
    const { tools, photo } = await setup();
    const r = await call(tools, "make_visual", { media_id: photo.id, dish: "Флат уайт", formats: ["post"] });
    expect(String(r.next)).toMatch(/Caption in the owner's current language \(the Owner language line\)/);
    expect(String(r.next)).not.toMatch(/venue's language/);
  });
});

describe("make_visual price from the menu", () => {
  /** A menu item at exactly 4 €, so the price on the card cannot be a guess. */
  async function withItem(lang: "bg" | "en") {
    const s = await setup();
    const item = await s.store.insertItem({ venue_id: s.venue.id, category_id: s.categories["Coffee"]?.id ?? Object.values(s.categories)[0].id, name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], position: 99 });
    const tools = lang === "bg" ? s.tools : makeTools({ ...s.deps, member: { ...s.deps.member, lang: "en" } });
    return { ...s, item, tools };
  }

  it("prints the menu price for a menu item, in the owner's format", async () => {
    const { tools, photo, item, requests } = await withItem("bg");
    await call(tools, "make_visual", { media_id: photo.id, dish: "Капучино", item_id: item.id, price: "3,20 €", formats: ["post"] });
    expect(requests[0].price).toBe("4,00 €");
  });

  it("an English owner gets €4.00", async () => {
    const { tools, photo, item, requests } = await withItem("en");
    await call(tools, "make_visual", { media_id: photo.id, dish: "Cappuccino", item_id: item.id, price: "3,20 €", formats: ["post"] });
    expect(requests[0].price).toBe("€4.00");
  });

  it("without item_id the model's price is used as before", async () => {
    const { tools, photo, requests } = await withItem("bg");
    await call(tools, "make_visual", { media_id: photo.id, dish: "Капучино", price: "3,20 €", formats: ["post"] });
    expect(requests[0].price).toBe("3,20 €");
  });

  it("an unknown item_id is an error and nothing is made", async () => {
    const { tools, photo, requests, messenger } = await withItem("bg");
    expect((await call(tools, "make_visual", { media_id: photo.id, dish: "Капучино", item_id: "nope", formats: ["post"] })).error).toBe("item_id not found; use an id from get_menu.");
    expect(requests).toHaveLength(0);
    expect(messenger.photos).toHaveLength(0);
  });
});

const NO_OBJECT = "Could not separate the object from this photo; ask the owner for a photo of the item alone on a plain surface, taken straight on.";

async function setupMenu(result: MenuPhotoResult | Error = { media_id: "menu-1", url: "https://media.example/menu.jpg", style: "white" }, over: Partial<AgentDeps> = {}) {
  const base = await setup(over);
  const menuRequests: MenuPhotoRequest[] = [];
  const visual: VisualClient = Object.assign(base.deps.visual as VisualClient, {
    menuPhoto: async (req: MenuPhotoRequest) => {
      menuRequests.push(req);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const deps: AgentDeps = { ...base.deps, visual, ...over };
  return { ...base, deps, menuRequests, tools: makeTools(deps), item: base.items["Cappuccino"] ?? Object.values(base.items)[0] };
}

describe("make_menu_photo", () => {
  it("is offered only with a menuPhoto service and only to the owner", async () => {
    expect((await setup()).tools.map((t) => t.name)).not.toContain("make_menu_photo");
    expect((await setup({ visual: null })).tools.map((t) => t.name)).not.toContain("make_menu_photo");
    const m = await setupMenu();
    expect(m.tools.map((t) => t.name)).toContain("make_menu_photo");
    const staff = (await m.store.findMember("tg:1002"))!;
    const asStaff = makeTools({ ...m.deps, chatRef: "tg:1002", member: staff });
    expect((await call(asStaff, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id })).error).toMatch(/owner/);
    expect(m.menuRequests).toHaveLength(0);
  });

  it("makes the menu photo, sends it with its caption, records it and tells the agent to propose set_item_image", async () => {
    const sentPhotos = new Set<string>();
    const m = await setupMenu(undefined, { sentPhotos });
    const r = await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id });
    expect(m.menuRequests).toEqual([{ venueId: m.venue.id, mediaId: m.photo.id, itemId: m.item.id, style: "white" }]);
    expect(m.messenger.photos.map((p) => [p.url, p.caption])).toEqual([["https://media.example/menu.jpg", "Снимка за менюто"]]);
    expect([...sentPhotos]).toEqual(["https://media.example/menu.jpg"]);
    expect(r.media_id).toBe("menu-1");
    expect(String(r.next)).toContain(`Propose set_item_image for item ${m.item.id} with this media_id now (propose_changes). Say nothing else about the picture.`);
    expect(r.note).toBeUndefined();
    expect(m.notes.join(" ")).toContain(`menu photo from photo ${m.photo.id}: menu-1`);
  });

  it("captions the photo in English for an English owner", async () => {
    const m = await setupMenu();
    const english = makeTools({ ...m.deps, member: { ...m.deps.member, lang: "en" } });
    await call(english, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id });
    expect(m.messenger.photos[0].caption).toBe("Menu photo");
  });

  it("passes the style through; white when it is omitted", async () => {
    const m = await setupMenu({ media_id: "menu-1", url: "https://media.example/menu.jpg", style: { background: "#f3eadb", matched: 3, of: 4 } });
    await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id, style: "match" });
    await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id });
    expect(m.menuRequests.map((q) => q.style)).toEqual(["match", "white"]);
    expect(m.menuRequests.every((q) => q.itemId === m.item.id)).toBe(true);
  });

  it("describes when to use each style", async () => {
    const text = MakeMenuPhotoSchema.shape.style.description!;
    expect(text).toMatch(/като другите/);
    expect(text).toMatch(/бял фон/);
  });

  const notes: [string, MenuPhotoResult, RegExp | null][] = [
    ["matched", { media_id: "m", url: "https://media.example/m.jpg", style: { background: "#f4efe6", matched: 3, of: 4 } }, /^Used the cream backdrop that 3 of your 4 menu photos share\.$/],
    ["no_photos", { media_id: "m", url: "https://media.example/m.jpg", style: "white", reason: "no_photos" }, /^Your other items have no photos, so I used white\.$/],
    ["too_few", { media_id: "m", url: "https://media.example/m.jpg", style: "white", reason: "too_few" }, /^Only one other item has a photo, so I used white\.$/],
    ["unreadable", { media_id: "m", url: "https://media.example/m.jpg", style: "white", reason: "unreadable" }, /^I couldn't read your other menu photos, so I used white\.$/],
    ["mixed", { media_id: "m", url: "https://media.example/m.jpg", style: "white", reason: "mixed" }, /^Your menu photos have different backdrops, so I used white\.$/],
    ["plain white", { media_id: "m", url: "https://media.example/m.jpg", style: "white" }, null],
  ];
  for (const [name, result, expected] of notes) {
    it(`tells the agent what was used: ${name}`, async () => {
      const m = await setupMenu(result);
      const r = await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id, style: "match" });
      if (expected) expect(String(r.note)).toMatch(expected);
      else expect(r.note).toBeUndefined();
    });
  }

  it("names the backdrop with the nearest plain colour word, decided in code", () => {
    expect(colourWord("#f4efe6")).toBe("cream");
    expect(colourWord("#ffffff")).toBe("white");
    expect(colourWord("#e9e9e9")).toBe("light grey");
    expect(colourWord("#e8dcc4")).toBe("beige");
    expect(colourWord("#f6d0d4")).toBe("pink");
    expect(colourWord("#cfe1f5")).toBe("light blue");
    expect(colourWord("#222222")).toBe("dark");
    expect(colourWord("#8f8f8c")).toBe("grey");
  });

  it("never puts the hex in the matched note", async () => {
    const m = await setupMenu({ media_id: "m", url: "https://media.example/m.jpg", style: { background: "#f4efe6", matched: 3, of: 4 } });
    const r = await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id, style: "match" });
    expect(String(r.note)).not.toMatch(/#/);
  });

  it("refuses an unknown item before asking the service", async () => {
    const m = await setupMenu();
    const r = await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: "nope" });
    expect(r.error).toBe("item_id not found; use an id from get_menu.");
    expect(m.menuRequests).toHaveLength(0);
    expect(m.messenger.photos).toHaveLength(0);
  });

  it("passes on the no-object refusal and sends nothing", async () => {
    const m = await setupMenu({ error: "no_object" });
    const r = await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id });
    expect(r.error).toBe(NO_OBJECT);
    expect(m.messenger.photos).toHaveLength(0);
  });

  it("reports the service's error", async () => {
    const m = await setupMenu(new Error("Could not read the photo; try again in a moment."));
    expect((await call(m.tools, "make_menu_photo", { media_id: m.photo.id, item_id: m.item.id })).error).toMatch(/Could not read the photo/);
  });
});
