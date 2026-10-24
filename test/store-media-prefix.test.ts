import { describe, expect, it } from "vitest";
import { makeDemo } from "./helpers";

describe("listMediaByPathPrefix", () => {
  it("returns only media under the prefix, oldest first, and filters by created_at range", async () => {
    const { store, venue } = await makeDemo();
    await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg", { name: "restyle/a/1.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg", { name: "restyle/a/2.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([3]), "image/jpeg", { name: "restyle/b/1.jpg" });
    await store.saveMedia(venue.id, new Uint8Array([4]), "image/jpeg"); // plain photo
    const all = await store.listMediaByPathPrefix(venue.id, "restyle/");
    expect(all.map((m) => m.storage_path.split("/").slice(1).join("/"))).toEqual(["restyle/a/1.jpg", "restyle/a/2.jpg", "restyle/b/1.jpg"]);
    expect(await store.listMediaByPathPrefix(venue.id, "restyle/a/")).toHaveLength(2);
    const future = { from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" };
    expect(await store.listMediaByPathPrefix(venue.id, "restyle/", future)).toEqual([]);
  });
  it("ai_label defaults to false and can be set", async () => {
    const { store, venue } = await makeDemo();
    expect(venue.ai_label).toBe(false);
    expect((await store.updateVenue(venue.id, { ai_label: true })).ai_label).toBe(true);
  });
});
