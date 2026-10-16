// test/agent-visual-tool.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { SYSTEM_PROMPT } from "@/src/agent/prompt";
import type { Messenger } from "@/src/bot/messenger";
import type { VisualClient } from "@/src/visual/client";
import type { VisualRequest } from "@/src/visual/service";
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
});
