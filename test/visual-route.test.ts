// test/visual-route.test.ts
import { describe, expect, it } from "vitest";
import { handleVisualRequest } from "@/src/server/visual";
import { httpVisualClient } from "@/src/visual/client";
import type { VisualDeps } from "@/src/visual/service";
import { makeDemo } from "./helpers";

async function setup() {
  const demo = await makeDemo();
  const photo = await demo.store.saveMedia(demo.venue.id, new Uint8Array([0xff, 0xd8, 1, 2]), "image/jpeg");
  const visual: VisualDeps = {
    store: demo.store,
    read: async (url) => demo.store.files.get(url.replace("memory://media/", "")) ?? null,
    cutout: async (b) => b,
    render: async () => new Uint8Array([0xff, 0xd8, 9]),
    average: async () => ({ r: 170, g: 110, b: 60 }),
  };
  const handler = (req: Request) => handleVisualRequest(req, { secret: "S3CRET", visual });
  return { ...demo, photo, handler, visual };
}
const post = (body: unknown, auth = "Bearer S3CRET") => new Request("https://x/api/visual", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("/api/visual", () => {
  it("refuses without the secret and rejects a bad body", async () => {
    const { handler, venue, photo } = await setup();
    expect((await handler(post({ venueId: venue.id, mediaId: photo.id, dish: "x", formats: ["post"] }, "Bearer nope"))).status).toBe(401);
    const bad = await handler(post({ venueId: venue.id, mediaId: photo.id, dish: "x".repeat(41), formats: ["reel"] }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/dish|formats/);
  });
  it("makes the pictures and answers 422 for a photo it cannot use", async () => {
    const { handler, venue, photo } = await setup();
    const ok = await handler(post({ venueId: venue.id, mediaId: photo.id, dish: "Флат уайт", price: "4,30 €", formats: ["post", "story", "post"] }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).pictures.map((p: { format: string }) => p.format)).toEqual(["post", "story"]);
    expect((await handler(post({ venueId: venue.id, mediaId: "nope", dish: "x", formats: ["post"] }))).status).toBe(422);
  });
  it("is reached by the HTTP client with the secret, and the client surfaces the service's error", async () => {
    const { handler, venue, photo } = await setup();
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://app.example/api/visual");
      return handler(new Request(String(url), init));
    }) as typeof fetch;
    const client = httpVisualClient({ baseUrl: "https://app.example", secret: "S3CRET", fetch: f });
    expect((await client({ venueId: venue.id, mediaId: photo.id, dish: "x", formats: ["story"] })).pictures).toHaveLength(1);
    await expect(client({ venueId: venue.id, mediaId: "nope", dish: "x", formats: ["post"] })).rejects.toThrow(/not found for this venue/);
  });
});

describe("/api/visual kind menu", () => {
  const redBox = async () => new Uint8Array(await (await import("sharp")).default({ create: { width: 60, height: 40, channels: 4, background: { r: 200, g: 20, b: 20, alpha: 1 } } }).png().toBuffer());
  async function menuSetup() {
    const s = await setup();
    const cut = await redBox();
    const visual: VisualDeps = { ...s.visual, cutout: async () => cut };
    return { ...s, handler: (req: Request) => handleVisualRequest(req, { secret: "S3CRET", visual }) };
  }
  it("serves kind menu with the same secret check", async () => {
    const { handler, venue, photo } = await menuSetup();
    expect((await handler(post({ kind: "menu", venueId: venue.id, mediaId: photo.id }, "Bearer nope"))).status).toBe(401);
    expect((await handler(post({ kind: "menu", venueId: venue.id }))).status).toBe(400);
    const ok = await handler(post({ kind: "menu", venueId: venue.id, mediaId: photo.id }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.url).toMatch(/\.jpg$/);
    expect((await handler(post({ kind: "menu", venueId: venue.id, mediaId: "nope" }))).status).toBe(422);
  });
  it("answers no_object with 200 when nothing can be cut out", async () => {
    const s = await setup();
    const handler = (req: Request) => handleVisualRequest(req, { secret: "S3CRET", visual: { ...s.visual, cutout: async () => null } });
    const res = await handler(post({ kind: "menu", venueId: s.venue.id, mediaId: s.photo.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ error: "no_object" });
  });
  it("is reached by the HTTP client's menuPhoto with the secret", async () => {
    const { handler, venue, photo } = await menuSetup();
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://app.example/api/visual");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer S3CRET");
      return handler(new Request(String(url), init));
    }) as typeof fetch;
    const client = httpVisualClient({ baseUrl: "https://app.example", secret: "S3CRET", fetch: f });
    const r = await client.menuPhoto!({ venueId: venue.id, mediaId: photo.id });
    expect("error" in r).toBe(false);
    await expect(client.menuPhoto!({ venueId: venue.id, mediaId: "nope" })).rejects.toThrow(/not found for this venue/);
  });
});
