// test/google-live-check.test.ts: the owner's live-check script against FakeGoogle and the memory store.
import { describe, expect, it } from "vitest";
import { runGoogleLiveCheck } from "../scripts/google-live-check.mts";
import { connectedGoogle, KEY, T0 } from "./google-helpers";

async function setup(opts: Parameters<typeof connectedGoogle>[0] = {}) {
  const g = await connectedGoogle(opts);
  const out: string[] = [];
  const run = (o: { push?: boolean; reply?: { review: string; text: string } } = {}, slug = g.venue.slug) =>
    runGoogleLiveCheck(
      { store: g.store, secretKey: KEY, google: { clientId: g.fake.clientId, clientSecret: g.fake.clientSecret }, fetch: g.fake.fetch, now: T0, out: (l) => void out.push(l) },
      { slug, ...o },
    );
  return { ...g, out, run, text: () => out.join("\n") };
}

describe("google live check", () => {
  it("default run: one validateOnly PATCH, location unchanged, no secrets or review text printed", async () => {
    const s = await setup();
    s.fake.addReview(s.loc.v4, { text: "Secret review words", name: "Reviewer Zed", stars: 4 });
    const before = s.fake.location(s.loc.name);
    expect(await s.run()).toBe(0);
    const patches = s.fake.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].query.validateOnly).toBe("true");
    expect(s.fake.location(s.loc.name)).toEqual(before);
    expect(s.text()).toContain("validateOnly: OK");
    expect(s.text()).toMatch(/4 \d{4}-\d{2}-\d{2} unanswered/);
    const issued = s.fake.calls.filter((c) => c.host === "oauth2.googleapis.com");
    expect(issued.length).toBe(1);
    for (const secret of [s.account.refresh_token, s.fake.clientSecret, "Secret review words", "Reviewer Zed", "Authorization", "Bearer"]) expect(s.text()).not.toContain(secret);
    expect(s.text()).not.toMatch(/\bat-[0-9a-f]{24}/);
  });

  it("no google destination: exit 1", async () => {
    const s = await setup({ destination: false });
    expect(await s.run()).toBe(1);
    expect(s.text()).toContain(`Google is not connected for ${s.venue.slug}`);
    expect(s.fake.calls).toHaveLength(0);
  });

  it("revoked token: exit 1 with the code", async () => {
    const s = await setup();
    s.fake.revoke(s.account.refresh_token);
    expect(await s.run()).toBe(1);
    expect(s.text()).toContain("sm_google_revoked");
    expect(s.text()).not.toContain(s.account.refresh_token);
  });

  it("--push: a second PATCH without validateOnly, then the read-back", async () => {
    const s = await setup();
    expect(await s.run({ push: true })).toBe(0);
    const patches = s.fake.calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0].query.validateOnly).toBe("true");
    expect(patches[1].query.validateOnly).toBeUndefined();
    expect(s.text()).toContain("reviewing: no");
    expect(s.fake.location(s.loc.name).regularHours?.periods?.length).toBeGreaterThan(0);
  });

  it("--reply: one PUT with the given text, review name must belong to the location", async () => {
    const s = await setup();
    const r = s.fake.addReview(s.loc.v4, { text: "x" });
    expect(await s.run({ reply: { review: r.name, text: "Thank you!" } })).toBe(0);
    const puts = s.fake.calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ comment: "Thank you!" });
    s.fake.calls.length = 0;
    expect(await s.run({ reply: { review: "accounts/1/locations/2/reviews/zzz", text: "no" } })).toBe(1);
    expect(s.fake.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});
