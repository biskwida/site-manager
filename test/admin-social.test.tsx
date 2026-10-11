// test/admin-social.test.tsx — the dashboard's "Facebook and Instagram" card, its overview, and the done page's pointer to it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SocialCard } from "@/app/admin/[slug]/components/SocialCard";
import { DoneStatus } from "@/app/new/[id]/done/DoneStatus";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview, socialOverview, type SocialOverview } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-11T09:00:00.000Z");
const BOTH = { facebook: true, instagram: true };

describe("socialOverview", () => {
  it("shows each network's account and the last five posts with links, never secrets", async () => {
    const { store, venue } = await makeDemo();
    expect(await socialOverview(store, venue.id, BOTH)).toEqual({ available: BOTH, facebook: null, instagram: null, posts: [] });
    const fb = await store.upsertDestination({ venue_id: venue.id, kind: "facebook", config: { page_id: "111", page_name: "Кафе Агала", connected_at: T0.toISOString() }, secrets: "SECRET-FB" });
    await store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: "222", username: "agala.cafe", connected_at: T0.toISOString() }, secrets: "SECRET-IG" });
    await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: "https://cafe.example" }, secrets: "SECRET-WP" });
    for (let i = 0; i < 6; i++) {
      const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: null, summary_bg: `Публикация ${i}`, summary_en: `Post ${i}`, preview_bg: "", preview_en: "", source: "photo", status: "proposed", changes: [] });
      const s = await store.createSync({ venue_id: venue.id, destination_id: fb.id, change_set_id: cs.id, payload: { kind: "facebook" }, next_at: T0.toISOString() });
      await store.updateSync(s.id, { status: i === 5 ? "failed" : "done", last_error: i === 5 ? "sm_meta_token: The access token is no longer valid." : null, result: { published: [{ target: "facebook_post", media_id: "m", id: `p${i}`, permalink: `https://www.facebook.com/111/posts/${i}` }] } });
    }
    const o = await socialOverview(store, venue.id, BOTH);
    expect(o.facebook).toMatchObject({ status: "connected", name: "Кафе Агала", connected_at: T0.toISOString(), last_error: null });
    expect(o.instagram).toMatchObject({ status: "connected", name: "@agala.cafe" });
    expect(o.posts.map((p) => [p.summary_en, p.kind, p.status])).toEqual([["Post 5", "facebook", "failed"], ["Post 4", "facebook", "done"], ["Post 3", "facebook", "done"], ["Post 2", "facebook", "done"], ["Post 1", "facebook", "done"]]);
    expect(o.posts[1].links).toEqual(["https://www.facebook.com/111/posts/4"]);
    expect(JSON.stringify(o)).not.toContain("SECRET");
    const full = await adminOverview(store, venue, T0, "https://site.example", { social: BOTH });
    expect(full.social?.facebook?.name).toBe("Кафе Агала");
    expect(JSON.stringify(full)).not.toContain("SECRET");
    expect((await adminOverview(store, venue, T0, "https://site.example")).social?.available).toEqual({ facebook: false, instagram: false });
  });
});

describe("SocialCard", () => {
  const empty: SocialOverview = { available: BOTH, facebook: null, instagram: null, posts: [] };
  const render = (lang: "bg" | "en", overview: SocialOverview) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><SocialCard overview={overview} slug="agala" adminKey="k 1" tz="Europe/Sofia" /></LangProvider>);

  it("offers both Connect buttons with the prerequisites, in Bulgarian first", () => {
    const html = render("bg", empty);
    expect(html).toContain('id="social"');
    expect(html).toContain("Facebook и Instagram");
    expect(html).toContain('href="/api/admin/agala/social/facebook/start?key=k%201"');
    expect(html).toContain('href="/api/admin/agala/social/instagram/start?key=k%201"');
    expect(html).toContain("Свържи Facebook");
    expect(html).toContain("Свържи Instagram");
    expect(html).toContain(DICTS.bg["admin.social.prereqInstagram"]);
    expect(html).toContain(DICTS.bg["admin.social.prereqFacebook"]);
    expect(html).toContain(DICTS.bg["admin.social.prereqPublic"]);
    expect(html).not.toContain("Прекъсни");
    const en = render("en", empty);
    expect(en).toContain("Connect Facebook");
    expect(en).toContain(DICTS.en["admin.social.prereqInstagram"]);
  });

  it("writes the prerequisites exactly as agreed", () => {
    expect(DICTS.en["admin.social.prereqInstagram"]).toBe("Instagram: a professional account (Business or Creator) — Settings → Account type and tools → Switch to professional account; while the app is in development, the account must be added as Instagram Tester and accept the invite.");
    expect(DICTS.en["admin.social.prereqFacebook"]).toBe("Facebook: a Facebook Page for the venue where you are an admin (or have full control); you sign in with your personal Facebook profile that manages the Page.");
    expect(DICTS.en["admin.social.prereqPublic"]).toBe("Posts are public on your profile/Page; undo deletes Facebook posts, Instagram posts must be deleted by hand.");
  });

  it("hides a Connect button this server cannot serve", () => {
    const html = render("en", { ...empty, available: { facebook: false, instagram: true } });
    expect(html).not.toContain("/social/facebook/start");
    expect(html).toContain("/social/instagram/start");
    expect(html).toContain(DICTS.en["admin.social.unavailable"]);
  });

  it("shows connected accounts, errors in the owner's language, the last posts with links and Disconnect", () => {
    const html = render("en", {
      available: BOTH,
      facebook: { status: "error", name: "Кафе Агала", connected_at: T0.toISOString(), last_error: "sm_meta_token: The access token is no longer valid." },
      instagram: { status: "connected", name: "@agala.cafe", connected_at: T0.toISOString(), last_error: null },
      posts: [
        { id: "s1", change_set_id: "c1", kind: "instagram", status: "done", summary_bg: "Публикация", summary_en: "Today's special", updated_at: T0.toISOString(), last_error: null, links: ["https://www.instagram.com/p/C1/"] },
        { id: "s2", change_set_id: "c2", kind: "facebook", status: "failed", summary_bg: "x", summary_en: "Soup", updated_at: T0.toISOString(), last_error: "sm_meta_token: x", links: [] },
      ],
    });
    expect(html).toContain("Кафе Агала");
    expect(html).toContain("@agala.cafe");
    expect(html).toContain("the connection is no longer valid; reconnect from the dashboard");
    expect(html).not.toContain("sm_meta_token");
    expect(html).toContain('href="https://www.instagram.com/p/C1/"');
    expect(html).toContain("Today&#x27;s special");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Connect again"); // the errored Facebook connection can be renewed
  });
});

describe("done page pointer", () => {
  const initial = { status: "live" as const, deploy: null, site_url: null, owner_joined: true, hosted: true };
  const render = (lang: "bg" | "en", social: boolean | undefined) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><DoneStatus id="v1" slug="bar" code={null} links={[]} apps={["telegram"]} adminKey="k1" baseUrl="https://site.example" initial={initial} social={social} /></LangProvider>);
  it("points to the dashboard's social card when posting is available", () => {
    const html = render("bg", true);
    expect(html).toContain("Свържете Facebook и Instagram");
    expect(html).toContain(DICTS.bg["done.social.text"]);
    expect(html).toContain('href="/admin/bar?key=k1#social"');
    expect(render("en", true)).toContain("Connect Facebook and Instagram");
    expect(render("bg", false)).not.toContain("Свържете Facebook");
    expect(render("bg", undefined)).not.toContain("Свържете Facebook");
  });
});
