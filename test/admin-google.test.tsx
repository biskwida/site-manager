// test/admin-google.test.tsx — the dashboard's "Google listing" card and its overview.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoogleCard } from "@/app/admin/[slug]/components/GoogleCard";
import { LangProvider } from "@/src/i18n";
import { DICTS } from "@/src/i18n/dicts";
import { adminOverview, googleOverview, type GoogleOverview } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-11-13T09:00:00.000Z");
const CONFIG = {
  account_name: "accounts/123", location_name: "locations/456", location_v4: "accounts/123/locations/456",
  title: "Coffique", address: "ul. Shipka 1, Sofia", connected_at: T0.toISOString(), google_account_name: "Tanya",
  last_hours_push_at: "2026-11-13T10:00:00.000Z", last_review_poll_at: "2026-11-13T10:15:00.000Z", hours_conflict: true,
  google_hours: [{ openDay: "MONDAY", openTime: { hours: 8 }, closeDay: "MONDAY", closeTime: { hours: 18 } }],
};

describe("googleOverview", () => {
  it("is null without a destination, and shows the display fields of a connected one, never the token", async () => {
    const { store, venue } = await makeDemo();
    expect(await googleOverview(store, venue.id, true)).toEqual({ available: true, account: null });
    await store.upsertDestination({ venue_id: venue.id, kind: "google", config: CONFIG, secrets: "ENCRYPTED-BLOB-refresh_token" });
    const o = await googleOverview(store, venue.id, true);
    expect(o).toEqual({
      available: true,
      account: { status: "connected", title: "Coffique", address: "ul. Shipka 1, Sofia", connected_at: T0.toISOString(), last_hours_push_at: "2026-11-13T10:00:00.000Z", last_review_poll_at: "2026-11-13T10:15:00.000Z", last_error: null, hours_conflict: true },
    });
    const json = JSON.stringify(o);
    expect(json).not.toContain("refresh_token");
    expect(json).not.toContain("ENCRYPTED-BLOB");
    expect(json).not.toContain("accounts/123");
    const full = await adminOverview(store, venue, T0, "https://site.example", { google: true });
    expect(full.google?.account?.title).toBe("Coffique");
    expect(JSON.stringify(full)).not.toContain("ENCRYPTED-BLOB");
    expect((await adminOverview(store, venue, T0, "https://site.example")).google?.available).toBe(false);
  });
});

describe("GoogleCard", () => {
  const connected: GoogleOverview = {
    available: true,
    account: { status: "connected", title: "Coffique", address: "ul. Shipka 1, Sofia", connected_at: T0.toISOString(), last_hours_push_at: "2026-11-13T10:00:00.000Z", last_review_poll_at: "2026-11-13T10:15:00.000Z", last_error: null, hours_conflict: false },
  };
  const render = (lang: "bg" | "en", overview: GoogleOverview | null) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><GoogleCard overview={overview} slug="agala" adminKey="k 1" tz="Europe/Sofia" /></LangProvider>);

  it("offers Connect Google when it is available and nothing is connected, in Bulgarian first", () => {
    const html = render("bg", { available: true, account: null });
    expect(html).toContain('id="google"');
    expect(html).toContain("Google профил");
    expect(html).toContain(DICTS.bg["admin.google.intro"]);
    expect(html).toMatch(/href="[^"]*\/social\/google\/start\?key=k%201"/);
    expect(html).toContain('href="/api/admin/agala/social/google/start?key=k%201"');
    expect(html).toContain("Свържи Google");
    expect(html).not.toContain(DICTS.bg["admin.social.disconnect"]);
    const en = render("en", { available: true, account: null });
    expect(en).toContain("Google listing");
    expect(en).toContain("Connect Google");
    expect(en).toContain(DICTS.en["admin.social.notConnected"]);
  });

  it("without the Google keys on this server: the unavailable line and no link", () => {
    const html = render("en", { available: false, account: null });
    expect(html).toContain(DICTS.en["admin.google.unavailable"]);
    expect(html).not.toContain("/social/google/start");
    expect(render("bg", null)).toContain(DICTS.bg["admin.google.unavailable"]);
  });

  it("connected: title, address, since, last sync and review check, Disconnect, no Connect link", () => {
    const html = render("en", connected);
    expect(html).toContain("Coffique");
    expect(html).toContain("ul. Shipka 1, Sofia");
    expect(html).toContain(DICTS.en["admin.social.connected"]);
    expect(html).toContain("since ");
    expect(html).toContain("Last hours sync: ");
    expect(html).toContain("Reviews last checked: ");
    expect(html).toContain(DICTS.en["admin.social.disconnect"]);
    expect(html).not.toContain("/social/google/start");
    expect(html).not.toContain("hours differ");
    const never = render("bg", { available: true, account: { ...connected.account!, last_hours_push_at: null, last_review_poll_at: null } });
    expect(never).toContain(DICTS.bg["admin.google.neverSynced"]);
    expect(never).not.toContain("Отзивите са проверени последно");
  });

  it("a revoked connection: the reconnect text in the owner's language and a Connect again link", () => {
    const html = render("en", { available: true, account: { ...connected.account!, status: "error", last_error: "sm_google_revoked: invalid_grant" } });
    expect(html).toContain("the connection is no longer valid; connect Google again from the dashboard");
    expect(html).not.toContain("sm_google_revoked");
    expect(html).not.toContain("invalid_grant");
    expect(html).toContain(DICTS.en["admin.social.error"]);
    expect(html).toContain('href="/api/admin/agala/social/google/start?key=k%201"');
    expect(html).toContain(DICTS.en["admin.social.reconnect"]);
    expect(html).toContain(DICTS.en["admin.social.disconnect"]);
  });

  it("says when Google's hours differ from the website's", () => {
    for (const lang of ["bg", "en"] as const) {
      expect(render(lang, { available: true, account: { ...connected.account!, hours_conflict: true } })).toContain(DICTS[lang]["admin.google.hoursConflict"].replaceAll("'", "&#x27;"));
    }
  });

  it("uses the agreed copy", () => {
    expect(DICTS.en["admin.google.title"]).toBe("Google listing");
    expect(DICTS.bg["admin.google.title"]).toBe("Google профил");
    expect(DICTS.en["admin.google.disconnectConfirm"]).toBe("Disconnect Google? Hours will no longer go to your listing and reviews will stop coming to the chat.");
    expect(DICTS.en["admin.social.result.google_no_locations"]).toBe("Your Google account manages no verified business profile; ask the profile owner to add you as a Manager.");
    expect(DICTS.bg["admin.social.result.google_connected"]).toBe("Google е свързан. Работното време и почивните дни от чата вече отиват и в профила ви.");
  });
});
