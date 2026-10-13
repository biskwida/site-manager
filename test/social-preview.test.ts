// test/social-preview.test.ts
import { describe, expect, it } from "vitest";
import { applyChange, invertChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import { socialPreviewLines } from "@/src/domain/social-preview";
import { isExternalEntity, isWpEntity, SOCIAL_TARGETS, type Change } from "@/src/domain/types";
import { SupabaseStore } from "@/src/store/supabase";
import { state, TZ } from "./fixtures";
import { makeDemo } from "./helpers";

const post: Change = {
  position: 0, op: "social_post", entity: "social_post", entity_id: "m-1",
  before: null,
  after: { media_id: "m-1", image_url: "https://cdn.example/m-1.jpg", caption: "Днешното предложение: тиквена супа 🎃\n#кафе", targets: ["facebook_post", "facebook_story", "instagram_post"] },
};

describe("social_post in the change engine", () => {
  it("is an external entity (not a WordPress one) and applies as a no-op", () => {
    expect(isExternalEntity("social_post")).toBe(true);
    expect(isExternalEntity("wp_page")).toBe(true);
    expect(isExternalEntity("item")).toBe(false);
    expect(isWpEntity("social_post")).toBe(false);
    expect(SOCIAL_TARGETS).toEqual(["facebook_post", "facebook_story", "instagram_post", "instagram_story"]);
    const s = state();
    expect(applyChange(s, post)).toEqual(s);
    const [inv] = invertChanges([post]);
    expect(applyChange(s, inv)).toEqual(s);
    expect(inv).toMatchObject({ op: "social_post", before: post.after, after: null });
  });

  it("is a no-op in the memory store and keeps the row", async () => {
    const { store, venue } = await makeDemo();
    const before = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "photo", status: "proposed", changes: [post] });
    expect(await store.applyChangeSet(cs.id, "2026-10-11T09:00:00.000Z")).toBe("applied");
    expect(await store.getSite(venue.id)).toEqual(before);
    expect((await store.getChangeSet(cs.id)).changes[0]).toMatchObject({ entity: "social_post", op: "social_post", after: { targets: post.after!.targets } });
  });

  it("is a no-op in the Supabase store (no entity table is written)", async () => {
    const tables: string[] = [];
    const row = { id: "cs1", venue_id: "v1", chat_ref: "tg:10", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "photo", status: "applied", apply_at: null, reminded_at: null, decided_at: null, applied_at: "2026-10-11T10:00:00.000Z", reverted_by: null, undoes_id: null, message_ref: null, created_at: "2026-10-11T09:00:00.000Z", changes: [{ id: "x0", ...post }] };
    const from = (table: string) => {
      tables.push(table);
      const steps: string[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "update", "upsert", "delete", "maybeSingle", "single", "order"]) q[m] = () => (steps.push(m), q);
      q.then = (ok: (r: unknown) => unknown) => Promise.resolve(table === "change_sets" && steps.includes("maybeSingle") ? { data: { status: "proposed", source: "photo", venue_id: "v1" }, error: null } : table === "venues" ? { data: { id: "v1", slug: "s", name: "n", change_limit: null, created_at: "2026-10-11T09:00:00.000Z" }, error: null } : table === "change_sets" && steps.includes("in") ? { data: [row], error: null } : { data: [{ id: "cs1" }], error: null }).then(ok);
      return q;
    };
    const store = new SupabaseStore("http://localhost:54321", "test-key");
    (store as unknown as { db: unknown }).db = { from };
    expect(await store.applyChangeSet("cs1", "2026-10-11T10:00:00.000Z")).toBe("applied");
    // venues is read (not written) once: the monthly change limit check before the apply.
    expect(tables.filter((t) => t !== "change_sets" && t !== "changes" && t !== "venues")).toEqual([]);
  });
});

describe("socialPreviewLines", () => {
  it("lists the networks with their formats and quotes the caption on the next lines", () => {
    expect(socialPreviewLines(post, "bg")).toEqual([
      "• Публикация: Facebook (пост, история), Instagram (пост)",
      "  „Днешното предложение: тиквена супа 🎃",
      "  #кафе“",
    ]);
    expect(socialPreviewLines(post, "en")).toEqual([
      "• Post: Facebook (post, story), Instagram (post)",
      "  “Днешното предложение: тиквена супа 🎃",
      "  #кафе”",
    ]);
  });
  it("shows a story-only row as a story: no word \"post\", and no caption line even when one was written (stories show none)", () => {
    const story: Change = { ...post, after: { ...post.after!, caption: "", targets: ["instagram_story"] } };
    expect(socialPreviewLines(story, "bg")).toEqual(["• Публикуване: Instagram (история)"]);
    expect(socialPreviewLines(story, "en")).toEqual(["• Publish: Instagram (story)"]);
    const captioned: Change = { ...post, after: { ...post.after!, targets: ["instagram_story", "facebook_story"] } };
    expect(socialPreviewLines(captioned, "bg")).toEqual(["• Публикуване: Facebook (история), Instagram (история)"]);
    expect(socialPreviewLines(captioned, "en").join("\n")).not.toMatch(/post/i);
  });
  it("renders the inverted row as a removal", () => {
    const [inv] = invertChanges([post]);
    expect(socialPreviewLines(inv, "bg")).toEqual(["• Премахва публикацията: Facebook (пост, история), Instagram (пост)"]);
    expect(socialPreviewLines(inv, "en")).toEqual(["• Removes the post: Facebook (post, story), Instagram (post)"]);
  });
  it("is wired into renderPreview", () => {
    expect(renderPreview(state(), [post], "bg", TZ).split("\n")[0]).toBe("• Публикация: Facebook (пост, история), Instagram (пост)");
  });
});

describe("schema and destination kinds", () => {
  it("the integrations SQL allows the facebook/instagram destinations and the social_post entity, idempotently", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/schema-integrations.sql", "utf8");
    expect(sql).toMatch(/drop constraint if exists venue_destinations_kind_check;\s*alter table public\.venue_destinations add constraint venue_destinations_kind_check\s*check \(kind in \('wordpress', 'google', 'github', 'facebook', 'instagram'\)\);/);
    const entity = sql.match(/add constraint changes_entity_check\s*check \(entity in \(([^)]*)\)\);/g) ?? [];
    expect(entity.at(-1)).toContain("'social_post'");
    expect(entity.at(-1)).toContain("'wp_product'");
  });
  it("the memory store keeps facebook and instagram destinations apart", async () => {
    const { store, venue } = await makeDemo();
    await store.upsertDestination({ venue_id: venue.id, kind: "facebook", config: { page_id: "p1" }, secrets: "enc-fb" });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: "u1" }, secrets: "enc-ig" });
    expect((await store.listDestinations(venue.id)).map((d) => d.kind).sort()).toEqual(["facebook", "instagram"]);
    expect(await store.getDestination(venue.id, "instagram")).toMatchObject({ secrets: "enc-ig", config: { ig_user_id: "u1" } });
  });
});
