// test/admin-wordpress.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WordPressCard } from "@/app/admin/[slug]/components/WordPressCard";
import { LangProvider } from "@/src/i18n";
import { adminOverview, wordPressOverview } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("wordPressOverview", () => {
  it("is null without a destination and lists the last five pushes newest first without secrets", async () => {
    const { store, venue } = await makeDemo();
    expect(await wordPressOverview(store, venue.id)).toBeNull();
    const dest = await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: "https://cafe.example", site_name: "Smoke Café", connected_at: T0.toISOString() }, secrets: "SECRET-BLOB" });
    for (let i = 0; i < 6; i++) {
      const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: `Промяна ${i}`, summary_en: `Change ${i}`, preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      const s = await store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: T0.toISOString() });
      await store.updateSync(s.id, { status: i === 5 ? "failed" : "done", last_error: i === 5 ? "boom" : null });
    }
    const o = await wordPressOverview(store, venue.id);
    expect(o).toMatchObject({ site_url: "https://cafe.example", site_name: "Smoke Café", status: "connected", connected_at: T0.toISOString() });
    expect(o?.syncs.map((s) => [s.summary_en, s.status])).toEqual([["Change 5", "failed"], ["Change 4", "done"], ["Change 3", "done"], ["Change 2", "done"], ["Change 1", "done"]]);
    expect(JSON.stringify(o)).not.toContain("SECRET");
    const full = await adminOverview(store, venue, T0, "https://site.example");
    expect(full.wordpress?.site_name).toBe("Smoke Café");
    expect(JSON.stringify(full)).not.toContain("SECRET");
  });
});

describe("WordPressCard", () => {
  const render = (lang: "bg" | "en", overview: Parameters<typeof WordPressCard>[0]["overview"]) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><WordPressCard overview={overview} slug="agala" adminKey="k" baseUrl="https://site.example" tz="Europe/Sofia" /></LangProvider>);
  it("explains the three steps with the download and the two settings when not connected", () => {
    const html = render("bg", null);
    expect(html).toContain('href="/wp/site-manager.zip"');
    expect(html).toContain("https://site.example");
    expect(html).toContain(">agala<");
    expect(html).toContain("Генерирай код");
    expect(html).toContain("/connect");
    expect(html).not.toContain("Прекъсни");
    expect(render("en", null)).toContain("Generate code");
  });
  it("shows the connection, the pushes and the Disconnect button when connected", () => {
    const html = render("en", { site_url: "https://cafe.example", site_name: "Smoke Café", status: "connected", connected_at: T0.toISOString(), last_error: null, syncs: [{ id: "s1", change_set_id: "c1", status: "done", summary_bg: "Нов текст", summary_en: "New text", updated_at: T0.toISOString(), last_error: null }, { id: "s2", change_set_id: "c2", status: "pending", summary_bg: "x", summary_en: "Logo", updated_at: T0.toISOString(), last_error: "unreachable" }] });
    expect(html).toContain("Smoke Café");
    expect(html).toContain("Connected");
    expect(html).toContain("New text");
    expect(html).toContain("will retry");
    expect(html).toContain("Disconnect");
    const errored = render("bg", { site_url: "https://cafe.example", site_name: "Smoke Café", status: "error", connected_at: null, last_error: "WordPress unreachable", syncs: [] });
    expect(errored).toContain("Има проблем");
    expect(errored).toContain("WordPress unreachable");
  });
  it("shows known plugin error codes in the owner's language, other errors as their message", () => {
    const overview = { site_url: "https://cafe.example", site_name: "Smoke Café", status: "error" as const, connected_at: null, last_error: "sm_unauthorized: Missing or invalid plugin token.", syncs: [{ id: "s1", change_set_id: "c1", status: "failed" as const, summary_bg: "Снимка", summary_en: "Photo", updated_at: T0.toISOString(), last_error: "sm_upload_failed: could not download" }, { id: "s2", change_set_id: "c2", status: "failed" as const, summary_bg: "Текст", summary_en: "Text", updated_at: T0.toISOString(), last_error: "sm_not_found: No such page." }] };
    const bg = render("bg", overview);
    expect(bg).toContain("връзката с WordPress вече не е валидна; свържете сайта отново с /connect");
    expect(bg).toContain("снимката не можа да се качи");
    expect(bg).toContain("No such page.");
    expect(bg).not.toContain("sm_");
    const en = render("en", overview);
    expect(en).toContain("the WordPress connection is no longer valid; reconnect with /connect");
    expect(en).toContain("the photo could not be uploaded");
  });
});
