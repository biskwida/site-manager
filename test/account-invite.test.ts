// test/account-invite.test.ts — npm run account:invite: store the pending invite, mail the sign-in link, never print it.
import { describe, expect, it, vi } from "vitest";
import { accountInviteEmail, accountInviteLines, inviteAccount, type InviteAccountDeps } from "@/src/server/account-invite";
import { InMemoryStore } from "@/src/store/memory";

const LINK_TOKEN = "hashed-token-123";
const APP = "https://getclaudia.app";

async function setup(over: Partial<InviteAccountDeps> = {}) {
  const store = new InMemoryStore();
  const venue = await store.createVenue({ slug: "coffique", name: "Coffique & Co" });
  const generateLink = vi.fn(async (email: string, redirectTo: string) => (void [email, redirectTo], { hashedToken: LINK_TOKEN, actionLink: "https://x.supabase.co/auth/v1/verify?token=SECRET" }));
  const send = vi.fn(async (m: { to: string; subject: string; html: string; text: string }) => (void m, { status: "sent" as const, id: "em_1" }));
  const deps: InviteAccountDeps = { store, appUrl: APP, emailEnabled: true, generateLink, send, ...over };
  return { store, venue, generateLink, send, deps };
}

describe("inviteAccount", () => {
  it("stores the invite, makes a magic link and emails it", async () => {
    const { store, venue, generateLink, send, deps } = await setup();
    const r = await inviteAccount(deps, { slug: "coffique", email: "  Owner@Example.com " });
    expect(r).toEqual({ status: "emailed", venueName: "Coffique & Co", email: "owner@example.com" });
    expect(generateLink).toHaveBeenCalledWith("owner@example.com", `${APP}/auth/callback?next=%2Fdashboard`);
    expect(send).toHaveBeenCalledTimes(1);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("owner@example.com");
    // The mail carries the link (to the app's callback, with the token hash), in Bulgarian and English.
    expect(mail.text).toContain(`${APP}/auth/callback?token_hash=${LINK_TOKEN}&type=magiclink&next=%2Fdashboard`);
    expect(mail.html).toContain(`token_hash=${LINK_TOKEN}`);
    expect(mail.subject).toMatch(/Claudia/);
    expect(mail.text).toMatch(/Здравейте/);
    expect(mail.text).toMatch(/Hello/);
    expect(mail.html).toContain("Coffique &amp; Co");
    // The invite is claimed by the first sign-in with that email.
    expect(await store.claimAccountInvites("22222222-2222-4222-8222-222222222222", "OWNER@example.com")).toEqual([venue.id]);
  });

  it("without an email key it stores the invite and sends nothing", async () => {
    const { store, venue, generateLink, send, deps } = await setup({ emailEnabled: false });
    const r = await inviteAccount(deps, { slug: "coffique", email: "owner@example.com" });
    expect(r.status).toBe("stored");
    expect(generateLink).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await store.claimAccountInvites("22222222-2222-4222-8222-222222222222", "owner@example.com")).toEqual([venue.id]);
  });

  it("keeps the invite when the mail fails, and says so", async () => {
    const { store, venue, deps } = await setup({ send: vi.fn(async () => ({ status: "failed" as const, error: "Resend 422: Invalid `to` field" })) });
    const r = await inviteAccount(deps, { slug: "coffique", email: "owner@example.com" });
    expect(r).toMatchObject({ status: "email_failed", error: "Resend 422: Invalid `to` field" });
    expect(await store.claimAccountInvites("22222222-2222-4222-8222-222222222222", "owner@example.com")).toEqual([venue.id]);
  });

  it("keeps the invite when the link cannot be made", async () => {
    const { deps, send } = await setup({ generateLink: vi.fn(async () => { throw new Error("admin api down"); }) });
    const r = await inviteAccount(deps, { slug: "coffique", email: "owner@example.com" });
    expect(r).toMatchObject({ status: "email_failed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses an unknown venue or a bad email before storing anything", async () => {
    const { store, deps } = await setup();
    const spy = vi.spyOn(store, "createPendingAccountInvite");
    expect(await inviteAccount(deps, { slug: "nope", email: "owner@example.com" })).toEqual({ status: "unknown_venue", slug: "nope" });
    expect(await inviteAccount(deps, { slug: "coffique", email: "not-an-email" })).toEqual({ status: "bad_email" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("accountInviteLines (what the script prints)", () => {
  const SECRETS = [LINK_TOKEN, "SECRET", "re_key", "token_hash"];
  it.each([
    [{ status: "emailed", venueName: "Coffique", email: "o@example.com" } as const, /o@example\.com/],
    [{ status: "stored", venueName: "Coffique", email: "o@example.com" } as const, /\/login/],
    [{ status: "email_failed", venueName: "Coffique", email: "o@example.com", error: "Resend 422: Invalid `to` field" } as const, /Resend 422/],
  ])("prints no link or key (%o)", (outcome, expected) => {
    const lines = accountInviteLines(outcome, APP).join("\n");
    expect(lines).toMatch(expected);
    for (const s of SECRETS) expect(lines).not.toContain(s);
    expect(lines).not.toMatch(/https:\/\/[^\s]*(token|verify)/);
  });

  it("tells the owner to sign in at /login with that email when nothing was mailed", () => {
    const lines = accountInviteLines({ status: "stored", venueName: "Coffique", email: "o@example.com" }, APP).join("\n");
    expect(lines).toContain(`${APP}/login`);
    expect(lines).toContain("RESEND_API_KEY");
  });
});

describe("accountInviteEmail", () => {
  it("has a BG and an EN part, escapes the venue name and keeps the link out of the subject", () => {
    const m = accountInviteEmail({ venueName: "<b>X</b>", link: "https://getclaudia.app/auth/callback?token_hash=t&type=magiclink&next=%2Fdashboard", loginUrl: "https://getclaudia.app/login" });
    expect(m.html).not.toContain("<b>X</b>");
    expect(m.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(m.html).toContain("href=\"https://getclaudia.app/auth/callback?token_hash=t&amp;type=magiclink&amp;next=%2Fdashboard\"");
    expect(m.subject).not.toContain("token_hash");
    expect(m.text).toContain("Hello");
    expect(m.text).toContain("Здравейте");
  });
});
