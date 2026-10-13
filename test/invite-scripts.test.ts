// test/invite-scripts.test.ts — the helpers behind `npm run venue:create` and `npm run invite:create`.
import { describe, expect, it } from "vitest";
import { inviteLines, parseArgs, parseSiteUrl, prepareInvite } from "../scripts/invite-lines.mts";
import { INVITE_TTL_MS } from "@/src/bot/links";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-13T09:00:00.000Z");
const cfg = { telegramBotUsername: "site_bot", messengerPageHandle: "sitemanager", instagramUsername: "", whatsappNumber: "" };

describe("parseArgs", () => {
  it("reads --key value pairs", () => {
    expect(Object.fromEntries(parseArgs(["node", "x", "--slug", "coffique", "--site-url", "https://coffique.vercel.app"]))).toEqual({ slug: "coffique", "site-url": "https://coffique.vercel.app" });
  });
});

describe("parseSiteUrl", () => {
  it("accepts an https site and drops a trailing slash", () => {
    expect(parseSiteUrl("https://coffique.vercel.app")).toBe("https://coffique.vercel.app");
    expect(parseSiteUrl(" https://Coffique.vercel.app/ ")).toBe("https://coffique.vercel.app");
    expect(parseSiteUrl("https://cafe.example.bg/bg")).toBe("https://cafe.example.bg/bg");
  });
  it("refuses anything that is not a plain https URL", () => {
    for (const bad of ["", "coffique.vercel.app", "http://coffique.vercel.app", "ftp://x.example", "javascript:alert(1)", "https://user:pw@x.example", "https://x.example/?a=1", "https://x.example/#top", "https://localhost", "https://"]) {
      expect(parseSiteUrl(bad), bad).toBeNull();
    }
  });
});

describe("inviteLines", () => {
  it("prints the /start line, a link per enabled channel, the bare-code note and the warning", () => {
    const lines = inviteLines(cfg, [{ role: "owner", code: "ABCD2345", note: "valid 7 days, one use" }]);
    expect(lines).toEqual([
      "owner code:  /start ABCD2345   (valid 7 days, one use)",
      "owner link (telegram): https://t.me/site_bot?start=ABCD2345",
      "owner link (messenger): https://m.me/sitemanager?ref=ABCD2345",
      "On Messenger, Instagram and WhatsApp the owner can also just send the bare code as a message: ABCD2345.",
    ]);
  });
  it("lists every code first, then every link, and names the others in the bare-code note (venue:create)", () => {
    const lines = inviteLines(cfg, [{ role: "owner", code: "OWNER234", note: "valid 7 days, one use" }, { role: "staff", code: "STAFF234", note: "valid 7 days, one use" }]);
    expect(lines[0]).toBe("owner code:  /start OWNER234   (valid 7 days, one use)");
    expect(lines[1]).toBe("staff code:  /start STAFF234   (valid 7 days, one use)");
    expect(lines.at(-1)).toBe("On Messenger, Instagram and WhatsApp the owner can also just send the bare code as a message: OWNER234 (staff: STAFF234).");
  });
});

describe("prepareInvite (invite:create)", () => {
  it("sets the own site first, then creates an invite that lasts INVITE_TTL_MS", async () => {
    const { store, venue } = await makeDemo();
    const r = await prepareInvite(store, { slug: venue.slug, role: "owner", siteUrl: "https://coffique.vercel.app", now: T0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reused).toBe(false);
    expect(r.venue.site_url).toBe("https://coffique.vercel.app");
    expect((await store.getVenue(venue.id)).site_url).toBe("https://coffique.vercel.app");
    expect(await store.findOpenInvite(venue.id, "owner", new Date(T0.getTime() + INVITE_TTL_MS - 1000).toISOString())).toBe(r.code);
    expect(await store.findOpenInvite(venue.id, "owner", new Date(T0.getTime() + INVITE_TTL_MS + 1000).toISOString())).toBeNull();
  });
  it("reuses the open invite for that role, and keeps roles apart", async () => {
    const { store, venue } = await makeDemo();
    const open = await store.createInvite(venue.id, "owner", "2026-10-15T00:00:00.000Z");
    const owner = await prepareInvite(store, { slug: venue.slug, role: "owner", now: T0 });
    expect(owner).toMatchObject({ ok: true, code: open, reused: true });
    const staff = await prepareInvite(store, { slug: venue.slug, role: "staff", now: T0 });
    expect(staff).toMatchObject({ ok: true, reused: false });
    expect(staff.ok && staff.code).not.toBe(open);
    expect((await store.getVenue(venue.id)).site_url).toBeNull(); // no --site-url: the venue is left as it is
  });
  it("refuses an unknown slug without creating anything", async () => {
    const { store } = await makeDemo();
    expect(await prepareInvite(store, { slug: "nope", role: "owner", now: T0 })).toEqual({ ok: false, error: 'no venue with slug "nope"' });
  });
});
