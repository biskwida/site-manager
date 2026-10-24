// test/visual-restyle.test.ts
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { MOODS, RESTYLE_MAX_GENERATIONS, restylePhoto, restylePrompt, type Mood, type RestyleDeps, type RestyleGenerate } from "@/src/visual/restyle";
import { makeDemo } from "./helpers";

const img = (fmt: "png" | "jpeg") => sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 170, g: 110, b: 60 } } })[fmt]().toBuffer().then((b) => new Uint8Array(b));

async function setup(over: Partial<RestyleDeps> = {}, limits = { monthly: 30, trial: 5 }) {
  const demo = await makeDemo();
  const jpeg = await img("jpeg");
  const generate = vi.fn<RestyleGenerate>(async () => ({ image: jpeg }));
  const deps: RestyleDeps = {
    store: demo.store,
    // The memory store serves its files from memory://; read them back the way production fetches https URLs.
    read: async (url) => demo.store.files.get(url.replace("memory://media/", "")) ?? null,
    generate,
    limits,
    ...over,
  };
  const photo = async (type: "png" | "jpeg" = "png") => demo.store.saveMedia(demo.venue.id, await img(type), `image/${type}`);
  const restyled = async () => (await demo.store.listMediaByPathPrefix(demo.venue.id, "restyle/")).map((m) => m.storage_path);
  return { ...demo, deps, generate, photo, restyled };
}

describe("restylePrompt", () => {
  it("names the item, the default scene and the light", () => {
    const p = restylePrompt("default", "Flat white");
    expect(p).toContain("exact reference for the Flat white");
    expect(p).toContain("a light oak table by a window");
    expect(p).toContain("5500K");
  });

  it("uses a neutral item name when none is known, and each mood's own scene", () => {
    expect(restylePrompt("darker", null)).toContain("the product in the photo");
    expect(restylePrompt("darker", null)).toContain("dark slate counter");
    expect(restylePrompt("brighter", null)).toContain("white marble");
    expect(restylePrompt("minimal", null)).toContain("#d2c8b7");
  });

  it("keeps the LOCK, CAMERA, REALISM and AVOID lines in every mood", () => {
    for (const mood of MOODS) {
      const p = restylePrompt(mood, "x");
      expect(p).toContain("LOCK:");
      expect(p).toContain("vertical 4:5");
      expect(p).toContain("REALISM:");
      expect(p).toContain("hands, people, text, logos");
    }
  });
});

describe("restylePhoto", () => {
  it("saves the result under restyle/<source>/1.jpg and sends the photo's real type and the mood's prompt to generate", async () => {
    const { deps, generate, photo, venue, store } = await setup();
    const src = await photo("png");
    const r = await restylePhoto(deps, { venueId: venue.id, mediaId: src.id, item: "Flat white" });
    expect(r).toMatchObject({ generation: 1, mood: "default" });
    if (!("media_id" in r)) throw new Error("expected a result");
    const saved = await store.getMedia(r.media_id);
    expect(saved?.storage_path).toBe(`${venue.id}/restyle/${src.id}/1.jpg`);
    expect(r.url).toBe(saved?.public_url);
    expect(generate).toHaveBeenCalledTimes(1);
    const input = generate.mock.calls[0][0];
    expect(input.mimeType).toBe("image/png");
    expect(input.prompt).toBe(restylePrompt("default", "Flat white"));
    expect(input.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the mood's prompt on a redo and counts the generations 1, 2, 3, then refuses a fourth without calling generate", async () => {
    const { deps, generate, photo, venue } = await setup();
    const src = await photo();
    const moods: Mood[] = ["default", "darker", "brighter"];
    for (const [i, mood] of moods.entries()) {
      const r = await restylePhoto(deps, { venueId: venue.id, mediaId: src.id, mood });
      expect(r).toMatchObject({ generation: i + 1, mood });
      expect(generate.mock.calls[i][0].prompt).toBe(restylePrompt(mood, null));
    }
    expect(RESTYLE_MAX_GENERATIONS).toBe(3);
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: src.id })).toEqual({ error: "too_many_generations" });
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("refuses a restyled picture as the source", async () => {
    const { deps, generate, photo, venue } = await setup();
    const src = await photo();
    const r = await restylePhoto(deps, { venueId: venue.id, mediaId: src.id });
    if (!("media_id" in r)) throw new Error("expected a result");
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: r.media_id })).toEqual({ error: "source_is_restyle" });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("answers no_photo for an unknown media id, another venue's media, and bytes that cannot be read", async () => {
    const { deps, generate, photo, venue } = await setup();
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: "nope" })).toEqual({ error: "no_photo" });
    const src = await photo();
    expect(await restylePhoto(deps, { venueId: "other-venue", mediaId: src.id })).toEqual({ error: "no_photo" });
    expect(await restylePhoto({ ...deps, read: async () => null }, { venueId: venue.id, mediaId: src.id })).toEqual({ error: "no_photo" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("stops the third distinct photo of the month at the cap without calling generate, but lets a redo through", async () => {
    const { deps, generate, photo, venue } = await setup({}, { monthly: 2, trial: 5 });
    const [a, b, c] = [await photo(), await photo(), await photo()];
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: a.id })).toMatchObject({ generation: 1 });
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: b.id })).toMatchObject({ generation: 1 });
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: c.id })).toEqual({ error: "monthly_limit", used: 2, limit: 2 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: a.id, mood: "darker" })).toMatchObject({ generation: 2 });
  });

  it("counts only the current month: last month's restyles do not use up this month's cap", async () => {
    const { deps, photo, venue, store } = await setup({}, { monthly: 1, trial: 5 });
    const [a, b] = [await photo(), await photo()];
    const real = store.clock;
    store.clock = () => new Date(Date.now() - 62 * 86_400_000).toISOString();
    await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg", { name: `restyle/${a.id}/1.jpg` });
    store.clock = real;
    expect(await restylePhoto(deps, { venueId: venue.id, mediaId: b.id })).toMatchObject({ generation: 1 });
  });

  it("caps a free-trial venue over the whole trial, and does not stop a grandfathered venue", async () => {
    // Grandfathered (billing_status null): the trial limit of 1 does not apply, the monthly one of 30 does.
    const g = await setup({}, { monthly: 30, trial: 1 });
    const [a, b] = [await g.photo(), await g.photo()];
    expect(await restylePhoto(g.deps, { venueId: g.venue.id, mediaId: a.id })).toMatchObject({ generation: 1 });
    expect(await restylePhoto(g.deps, { venueId: g.venue.id, mediaId: b.id })).toMatchObject({ generation: 1 });
    expect(g.generate).toHaveBeenCalledTimes(2);

    const t = await setup({}, { monthly: 30, trial: 1 });
    await t.store.updateVenue(t.venue.id, { billing_status: "trialing", stripe_subscription_id: null });
    const [x, y] = [await t.photo(), await t.photo()];
    expect(await restylePhoto(t.deps, { venueId: t.venue.id, mediaId: x.id })).toMatchObject({ generation: 1 });
    expect(await restylePhoto(t.deps, { venueId: t.venue.id, mediaId: y.id })).toEqual({ error: "trial_limit", used: 1, limit: 1 });
    expect(await restylePhoto(t.deps, { venueId: t.venue.id, mediaId: x.id, mood: "minimal" })).toMatchObject({ generation: 2 });
    expect(t.generate).toHaveBeenCalledTimes(2);
  });

  const fallbacks: [string, RestyleGenerate, string][] = [
    ["a refusal", async () => ({ refused: true }), "refused"],
    ["no image", async () => ({ none: true }), "no_image"],
    ["a timeout", async () => { throw new DOMException("x", "TimeoutError"); }, "timeout"],
    ["an abort", async () => { throw new DOMException("x", "AbortError"); }, "timeout"],
    ["any other error", async () => { throw new Error("boom"); }, "error"],
  ];
  for (const [name, generate, reason] of fallbacks) {
    it(`falls back to the card on ${name} and saves nothing`, async () => {
      const { deps, photo, venue, restyled } = await setup({ generate });
      const src = await photo();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await restylePhoto(deps, { venueId: venue.id, mediaId: src.id })).toEqual({ fallback: "card", reason });
      expect(await restyled()).toEqual([]);
      if (reason === "error") {
        expect(log).toHaveBeenCalledWith("[restyle] generate failed:", "Error");
        expect(JSON.stringify(log.mock.calls)).not.toContain("boom");
      } else expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    });
  }
});
