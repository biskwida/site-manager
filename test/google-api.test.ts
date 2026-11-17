import { describe, expect, it } from "vitest";
import { FakeGoogle } from "./fake-google";
import { GoogleApiError, GoogleClient, GOOGLE_INFO, deleteReviewReply, exchangeGoogleCode, getLocation, googleAccessToken, listLocations, listReviews, patchLocation, putReviewReply, type GooglePeriod } from "../src/destinations/google-api";

const REDIRECT = "https://app.example.test/api/google/callback";
function setup() {
  const fake = new FakeGoogle();
  const creds = { clientId: fake.clientId, clientSecret: fake.clientSecret };
  return { fake, creds };
}
async function connected() {
  const s = setup();
  const acc = s.fake.addAccount("Owner");
  const loc = s.fake.addLocation(acc.name, { regularHours: [{ openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 17 } }] });
  const token = await googleAccessToken(s.fake.fetch, s.creds, acc.refresh_token);
  return { ...s, acc, loc, token, client: new GoogleClient(token, s.fake.fetch) };
}
async function rejection(p: Promise<unknown>): Promise<GoogleApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(GoogleApiError);
    return e as GoogleApiError;
  }
  throw new Error("expected a rejection");
}
const week = (h: number): GooglePeriod[] => [{ openDay: "TUESDAY", openTime: { hours: 8 }, closeDay: "TUESDAY", closeTime: { hours: h } }];

describe("token endpoint", () => {
  it("refreshes to an access token the fake accepts, and reports a revoked grant", async () => {
    const { fake, creds, acc, client } = await connected();
    expect((await client.get<{ accounts: unknown[] }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts")).accounts).toHaveLength(1);
    fake.revoke(acc.refresh_token);
    const e = await rejection(googleAccessToken(fake.fetch, creds, acc.refresh_token));
    expect(e.code).toBe("sm_google_revoked");
    expect(e.retryable).toBe(false);
  });

  it("exchanges a code once, as a form body with the redirect_uri verbatim", async () => {
    const { fake, creds } = setup();
    const acc = fake.addAccount();
    const r = await exchangeGoogleCode(fake.fetch, creds, acc.code, REDIRECT);
    expect(r.refresh_token).toBe(acc.refresh_token);
    const call = fake.calls[0];
    expect(call.query).toEqual({});
    expect(call.body).toMatchObject({ grant_type: "authorization_code", redirect_uri: REDIRECT, code: acc.code });
    await expect(exchangeGoogleCode(fake.fetch, creds, acc.code, REDIRECT)).rejects.toBeInstanceOf(GoogleApiError);
  });

  it("throws sm_google_invalid when Google sends no refresh token", async () => {
    const { creds } = setup();
    const f: typeof fetch = async () => Response.json({ access_token: "a" });
    expect((await rejection(exchangeGoogleCode(f, creds, "c", REDIRECT))).code).toBe("sm_google_invalid");
  });
});

describe("error mapping", () => {
  const cases: [string, { status: number; reason?: string; message?: string }, string, boolean][] = [
    ["401", { status: 401 }, "sm_google_revoked", false],
    ["403 scope", { status: 403, reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }, "sm_google_scope", false],
    ["403 plain", { status: 403 }, "sm_google_permission", false],
    ["403 service disabled", { status: 403, reason: "SERVICE_DISABLED" }, "sm_google_api_disabled", false],
    ["404", { status: 404 }, "sm_google_not_found", false],
    ["400", { status: 400, message: "x".repeat(500) }, "sm_google_invalid", false],
    ["429", { status: 429 }, "sm_google_rate", true],
    ["503", { status: 503 }, "http_503", true],
  ];
  for (const [label, failure, code, retry] of cases) {
    it(`${label} -> ${code}`, async () => {
      const { fake, client, loc } = await connected();
      fake.failNext({ ...failure, match: (c) => c.host.startsWith("mybusinessbusinessinformation") });
      const e = await rejection(getLocation(client, loc.name, "name"));
      expect(e.code).toBe(code);
      expect(e.retryable).toBe(retry);
      expect(e.notFound).toBe(failure.status === 404);
      if (failure.status === 400) expect(e.message).toBe("x".repeat(200));
    });
  }

  it("a fetch that throws -> sm_google_unreachable, retryable", async () => {
    const c = new GoogleClient("tok", async () => { throw new TypeError("boom"); });
    const e = await rejection(c.get("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews"));
    expect(e.code).toBe("sm_google_unreachable");
    expect(e.retryable).toBe(true);
  });

  it("refuses a URL on another host without calling it", async () => {
    const { fake, client } = await connected();
    const n = fake.calls.length;
    await rejection(client.get("https://evil.example/steal"));
    expect(fake.calls.length).toBe(n);
  });

  it("never leaks a token or the client secret in an error", async () => {
    const { fake, creds, acc, token, client, loc } = await connected();
    const secrets = [token, acc.refresh_token, creds.clientSecret];
    const errors: GoogleApiError[] = [];
    for (const status of [400, 401, 403, 404, 429, 503]) {
      fake.failNext({ status });
      errors.push(await rejection(getLocation(client, loc.name, "name")));
    }
    fake.revoke(acc.refresh_token);
    errors.push(await rejection(googleAccessToken(fake.fetch, creds, acc.refresh_token)));
    errors.push(await rejection(exchangeGoogleCode(fake.fetch, creds, "used-up", REDIRECT)));
    const down = new GoogleClient(token, async () => { throw new Error(`failed with ${token}`); });
    errors.push(await rejection(down.get(`${GOOGLE_INFO}/${loc.name}`)));
    for (const e of errors) for (const s of secrets) {
      expect(String(e)).not.toContain(s);
      expect(e.message).not.toContain(s);
    }
  });
});

describe("locations", () => {
  it("validateOnly changes nothing and is recorded; a real patch replaces only the masked field", async () => {
    const { fake, client, loc } = await connected();
    const special = [{ startDate: { year: 2027, month: 1, day: 1 }, closed: true }];
    const before = fake.location(loc.name);
    await patchLocation(client, loc.name, "regularHours", { regularHours: { periods: week(12) } }, { validateOnly: true });
    expect(fake.location(loc.name)).toEqual(before);
    expect(fake.calls.at(-1)?.query.validateOnly).toBe("true");
    expect(fake.calls.at(-1)?.query.updateMask).toBe("regularHours");

    await patchLocation(client, loc.name, "specialHours", { specialHours: { specialHourPeriods: special } });
    const after = fake.location(loc.name);
    expect(after.specialHours?.specialHourPeriods).toEqual(special);
    expect(after.regularHours).toEqual(before.regularHours);
    expect(fake.calls.at(-1)?.query.validateOnly).toBeUndefined();

    await patchLocation(client, loc.name, "regularHours", { regularHours: { periods: week(12) } });
    expect(fake.location(loc.name).regularHours?.periods).toEqual(week(12));
    expect(fake.location(loc.name).specialHours?.specialHourPeriods).toEqual(special);
  });

  it("answers 400 sm_google_invalid for a period of 24 h or more, or hours > 24", async () => {
    const { client, loc } = await connected();
    const long: GooglePeriod[] = [{ openDay: "TUESDAY", openTime: { hours: 8 }, closeDay: "WEDNESDAY", closeTime: { hours: 9 } }];
    expect((await rejection(patchLocation(client, loc.name, "regularHours", { regularHours: { periods: long } }))).code).toBe("sm_google_invalid");
    expect((await rejection(patchLocation(client, loc.name, "regularHours", { regularHours: { periods: week(25) } }))).code).toBe("sm_google_invalid");
  });

  it("lists the locations of two accounts with their account", async () => {
    const { fake, client } = await connected();
    const second = fake.addAccount("Second");
    const l2 = fake.addLocation(second.name, { title: "Other" });
    const rows = await listLocations(client);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.location.name === l2.name)).toMatchObject({ account_name: second.name, account_label: "Second", location: { title: "Other" } });
    expect(rows.find((r) => r.account_name === second.name)?.location.regularHours).toBeUndefined();
  });
});

describe("reviews", () => {
  it("lists newest update first", async () => {
    const { fake, client, loc } = await connected();
    const old = fake.addReview(loc.v4, { text: "old", updated: new Date("2026-11-01T10:00:00Z") });
    const fresh = fake.addReview(loc.v4, { text: "fresh", updated: new Date("2026-11-10T10:00:00Z") });
    expect((await listReviews(client, loc.v4)).map((r) => r.name)).toEqual([fresh.name, old.name]);
  });

  it("puts and deletes a reply; an unknown review is notFound", async () => {
    const { fake, client, loc } = await connected();
    const r = fake.addReview(loc.v4, {});
    await putReviewReply(client, r.name, "Thank you!");
    expect(fake.review(r.name).reviewReply?.comment).toBe("Thank you!");
    await deleteReviewReply(client, r.name);
    expect(fake.review(r.name).reviewReply).toBeUndefined();
    const ghost = `${loc.v4}/reviews/nope`;
    expect((await rejection(putReviewReply(client, ghost, "x"))).notFound).toBe(true);
    expect((await rejection(deleteReviewReply(client, ghost))).notFound).toBe(true);
  });
});
