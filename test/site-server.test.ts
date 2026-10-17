// test/site-server.test.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { newDraftToken, sha256Hex } from "@/src/server/hash";
import { loadSite, ownSiteRedirect, publicSiteState } from "@/src/server/site";
import { templatePageProps } from "@/app/[slug]/props";
import { makeDemo } from "./helpers";

describe("loadSite", () => {
  it("returns the live state, null for an unknown slug, and ignores draft without a valid key", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: "2026-10-09T09:00:00.000Z" }) });
    expect(await loadSite(store, "nope")).toBeNull();
    const live = await loadSite(store, "agala");
    expect(live?.draft).toBeNull();
    expect(live?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    const noKey = await loadSite(store, "agala", { draftId: cs.id, key: "wrong" });
    expect(noKey?.draft).toBeNull();
    const key = await store.getAdminToken(venue.id);
    const draft = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(draft?.draft).toMatchObject({ id: cs.id, status: "proposed", summary_en: "Cappuccino €3.20" });
    expect(draft?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    await store.applyChangeSet(cs.id, "2026-10-09T09:00:00.000Z");
    const applied = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(applied?.draft).toMatchObject({ status: "applied" }); // banner says it is live now; state is not re-applied
    expect(applied?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
  });

  it("hides a draft venue unless the draft token matches, and passes the key into the draft info", async () => {
    const { store, venue } = await makeDemo();
    const draft = await store.createVenue({ slug: "mydraft", name: "Draft", status: "draft" });
    const token = newDraftToken();
    await store.setDraftToken(draft.id, sha256Hex(token));
    expect(await loadSite(store, "mydraft")).toBeNull();
    expect(await loadSite(store, "mydraft", { draftToken: "wrong" })).toBeNull();
    const ok = await loadSite(store, "mydraft", { draftToken: token });
    expect(ok?.state.venue.id).toBe(draft.id);
    expect(ok?.draft).toBeNull();
    // the token of one draft does not open another
    const other = await store.createVenue({ slug: "otherdraft", name: "Other", status: "draft" });
    expect(await loadSite(store, "otherdraft", { draftToken: token })).toBeNull();
    expect(other.status).toBe("draft");
    // a live venue ignores draftToken
    expect((await loadSite(store, "agala", { draftToken: "anything" }))?.state.venue.id).toBe(venue.id);
    // DraftInfo carries the key
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const key = await store.getAdminToken(venue.id);
    expect((await loadSite(store, "agala", { draftId: cs.id, key }))?.draft).toMatchObject({ id: cs.id, key });
  });
});

describe("loadSite and keep markers", () => {
  it("the draft banner never shows a keep marker: the draft's summaries and previews come without them", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "Отмяна: ⟦Капучино⟧ отново в наличност", summary_en: "Undo: ⟦Cappuccino⟧ back in stock", preview_bg: "• ⟦Капучино⟧: 2,90 € → 3,20 €", preview_en: "• ⟦Cappuccino⟧: €2.90 → €3.20", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: "2026-10-09T09:00:00.000Z" }) });
    const draft = (await loadSite(store, "agala", { draftId: cs.id, key: await store.getAdminToken(venue.id) }))?.draft;
    expect(draft).toMatchObject({ summary_bg: "Отмяна: Капучино отново в наличност", summary_en: "Undo: Cappuccino back in stock", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20" });
  });
});

describe("publicSiteState", () => {
  it("strips the deploy record and the wizard draft from the public feed, keeping everything templates read", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, { provider: "vercel", project_id: "prj_secret", deployment_id: "dpl_1", url: "https://x.vercel.app", status: "error", error: "Build failed at /vercel/path0", template: "classic", updated_at: "2026-10-10T09:00:00.000Z" });
    await store.updateVenue(venue.id, { instagram_import: { fetched_at: "2026-10-10T09:00:00.000Z", username: "agala", items: [{ id: "1", url: "https://scontent.cdninstagram.com/secret.jpg", thumb: "https://scontent.cdninstagram.com/secret.jpg", caption: "", permalink: "", taken_at: "" }] } });
    await store.updateVenue(venue.id, { site_url: "https://own.example" });
    const state = await store.getSite(venue.id);
    const pub = publicSiteState(state);
    expect("site_url" in pub.venue).toBe(false); // the feed keeps its shape: the own-site URL is a dashboard/bot field
    expect("deploy" in pub.venue).toBe(false);
    expect("wizard_draft" in pub.venue).toBe(false);
    expect("instagram_import" in pub.venue).toBe(false);
    expect("change_limit" in pub.venue).toBe(false);
    expect("comment_mode" in pub.venue).toBe(false);
    expect("comment_limit" in pub.venue).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("prj_secret");
    expect(JSON.stringify(pub)).not.toContain("cdninstagram");
    const { deploy: _d, wizard_draft: _w, instagram_import: _i, site_url: _s, change_limit: _l, comment_mode: _cm, comment_digest_hour: _ch, comment_limit: _cl, last_comment_digest_at: _cd, ...rest } = state.venue;
    void _d;
    void _w;
    void _i;
    void _s;
    void _l;
    void _cm;
    void _ch;
    void _cl;
    void _cd;
    expect(pub).toEqual({ ...state, venue: { ...rest, theme: { ...rest.theme, background: null } } }); // background always present
    expect(state.venue.deploy).not.toBeNull(); // the input is not mutated
  });
});

describe("hosted page props", () => {
  it("hand the client template the public state only: no deploy record, wizard draft or Instagram import in the page payload", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, { provider: "vercel", project_id: "prj_secret", deployment_id: "dpl_1", url: "https://x.vercel.app", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" });
    const site = await loadSite(store, venue.slug);
    expect(site?.state.venue.deploy).not.toBeNull();
    for (const page of ["home", "menu"] as const) {
      const props = templatePageProps(site!, venue.slug, page, 0);
      expect(props).toMatchObject({ slug: venue.slug, page, live: true, draft: null, feedUrl: `/api/site/${venue.slug}` });
      // The RSC payload of /[slug] serializes exactly these props.
      const payload = JSON.stringify(props);
      expect(payload).not.toContain('"deploy"');
      expect(payload).not.toContain('"wizard_draft"');
      expect(payload).not.toContain('"instagram_import"');
      expect(payload).not.toContain("prj_secret");
      expect(payload).toContain(venue.name);
    }
  });
});


describe("ownSiteRedirect", () => {
  it("sends visitors of an own-site venue to its site, but keeps draft previews on the hosted page", async () => {
    const { store, venue } = await makeDemo();
    const hosted = await loadSite(store, venue.slug);
    expect(ownSiteRedirect(hosted!)).toBeNull();
    await store.updateVenue(venue.id, { site_url: "https://coffique.example" });
    const own = await loadSite(store, venue.slug);
    expect(ownSiteRedirect(own!)).toBe("https://coffique.example");
    expect(ownSiteRedirect({ ...own!, draft: { id: "d1", summary_bg: "", summary_en: "", apply_at: null } as never })).toBeNull();
  });
});
