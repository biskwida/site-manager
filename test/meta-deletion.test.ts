// test/meta-deletion.test.ts — Meta's Deauthorize and Data Deletion Request callbacks: signed_request verification (either app
// secret), removing exactly the matching venue's connection, the confirmation payload and the status lookup.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST as dataDeletionRoute } from "@/app/api/meta/data-deletion/route";
import { POST as deauthorizeRoute } from "@/app/api/meta/deauthorize/route";
import { makeServerDeps, type ServerDeps } from "@/src/server/deps";
import { deletionStatus, handleMetaDataDeletion, handleMetaDeauthorize, verifySignedRequest, type MetaDeletionDeps } from "@/src/server/meta-deletion";
import { InMemoryStore } from "@/src/store/memory";

const FB_SECRET = "fb-secret-1";
const IG_SECRET = "ig-secret-1";
const BASE = "https://site.example";
const T0 = new Date("2026-10-14T09:00:00.000Z");
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Meta's format: base64url(HMAC-SHA256(encoded payload, secret)) "." base64url(JSON payload). */
function signedRequest(payload: Record<string, unknown>, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${b64url(createHmac("sha256", secret).update(body).digest())}.${body}`;
}
const okPayload = (user_id: string) => ({ algorithm: "HMAC-SHA256", issued_at: 1_791_000_000, user_id });
const form = (sr: string) => new URLSearchParams({ signed_request: sr });
const post = (path: string, body: URLSearchParams | string) =>
  new Request(`${BASE}${path}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });

async function setup(config: Partial<MetaDeletionDeps["config"]> = {}) {
  const store = new InMemoryStore();
  const a = await store.createVenue({ slug: "cafe-a", name: "A" });
  const b = await store.createVenue({ slug: "cafe-b", name: "B" });
  await store.upsertDestination({ venue_id: a.id, kind: "facebook", config: { page_id: "111", app_user_id: "9001" }, secrets: "SECRET-A-FB" });
  await store.upsertDestination({ venue_id: a.id, kind: "instagram", config: { ig_user_id: "1784", app_user_id: "5501" }, secrets: "SECRET-A-IG" });
  await store.upsertDestination({ venue_id: a.id, kind: "wordpress", config: { site_url: "https://a.example" }, secrets: "SECRET-A-WP" });
  await store.upsertDestination({ venue_id: b.id, kind: "facebook", config: { page_id: "222", app_user_id: "9002" }, secrets: "SECRET-B-FB" });
  await store.upsertDestination({ venue_id: b.id, kind: "instagram", config: { ig_user_id: "1785", app_user_id: "5502" }, secrets: "SECRET-B-IG" });
  const d: MetaDeletionDeps = { store, config: { publicBaseUrl: BASE, metaAppSecret: FB_SECRET, instagramAppSecret: IG_SECRET, ...config }, now: () => T0 };
  const kinds = async (venueId: string) => (await store.listDestinations(venueId)).map((x) => x.kind).sort();
  return { store, a, b, d, kinds };
}

describe("verifySignedRequest", () => {
  const config = { metaAppSecret: FB_SECRET, instagramAppSecret: IG_SECRET };

  it("accepts Meta's format signed with either secret, and says which app signed it", () => {
    expect(verifySignedRequest(signedRequest(okPayload("9001"), FB_SECRET), config)).toEqual({ userId: "9001", providers: ["facebook"] });
    expect(verifySignedRequest(signedRequest(okPayload("5501"), IG_SECRET), config)).toEqual({ userId: "5501", providers: ["instagram"] });
    // One app for both logins: the same secret covers both.
    expect(verifySignedRequest(signedRequest(okPayload("1"), FB_SECRET), { metaAppSecret: FB_SECRET, instagramAppSecret: FB_SECRET })).toEqual({ userId: "1", providers: ["facebook", "instagram"] });
    // Standard base64 with padding decodes too; a numeric user_id that is a safe integer is read as its digits.
    expect(verifySignedRequest(signedRequest({ algorithm: "hmac-sha256", user_id: 42 }, FB_SECRET), config)).toEqual({ userId: "42", providers: ["facebook"] });
  });

  it("refuses a bad signature, a wrong algorithm, a missing user id and junk", () => {
    const good = signedRequest(okPayload("9001"), FB_SECRET);
    const [sig, body] = good.split(".");
    expect(verifySignedRequest(signedRequest(okPayload("9001"), "other-secret"), config)).toBeNull();
    expect(verifySignedRequest(`${sig}.${b64url(JSON.stringify(okPayload("9002")))}`, config)).toBeNull(); // payload swapped
    expect(verifySignedRequest(`${sig.slice(0, -2)}.${body}`, config)).toBeNull(); // truncated signature
    expect(verifySignedRequest(signedRequest({ ...okPayload("9001"), algorithm: "HMAC-SHA1" }, FB_SECRET), config)).toBeNull();
    expect(verifySignedRequest(signedRequest({ algorithm: "HMAC-SHA256" }, FB_SECRET), config)).toBeNull();
    expect(verifySignedRequest(signedRequest({ algorithm: "HMAC-SHA256", user_id: 2 ** 60 }, FB_SECRET), config)).toBeNull(); // lost precision
    const notJson = b64url("not json");
    expect(verifySignedRequest(`${b64url(createHmac("sha256", FB_SECRET).update(notJson).digest())}.${notJson}`, config)).toBeNull();
    for (const junk of [null, "", ".", "abc", `${sig}.`, `.${body}`, "x".repeat(10_000)]) expect(verifySignedRequest(junk, config)).toBeNull();
    expect(verifySignedRequest(good, { metaAppSecret: null, instagramAppSecret: null })).toBeNull();
  });
});

describe("deauthorize callback", () => {
  it("removes only the matching venue's Facebook connection (secrets with it)", async () => {
    const { store, a, b, d, kinds } = await setup();
    const res = await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("9001"), FB_SECRET))), d);
    expect(res.status).toBe(200);
    expect(await kinds(a.id)).toEqual(["instagram", "wordpress"]);
    expect(await kinds(b.id)).toEqual(["facebook", "instagram"]);
    expect(await store.getDestination(a.id, "facebook")).toBeNull();
  });

  it("an Instagram removal matches the app-scoped id or the professional user_id, Instagram rows only", async () => {
    const { a, b, d, kinds } = await setup();
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("5502"), IG_SECRET))), d)).status).toBe(200);
    expect(await kinds(b.id)).toEqual(["facebook"]);
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("1784"), IG_SECRET))), d)).status).toBe(200);
    expect(await kinds(a.id)).toEqual(["facebook", "wordpress"]);
    // A Facebook-signed request never touches Instagram rows, even with a matching number.
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("1785"), FB_SECRET))), d)).status).toBe(200);
    expect(await kinds(b.id)).toEqual(["facebook"]);
  });

  it("answers 400 to a bad signature and changes nothing; 200 for an unknown user", async () => {
    const { a, b, d, kinds } = await setup();
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("9001"), "wrong"))), d)).status).toBe(400);
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", "nothing=here"), d)).status).toBe(400);
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("777"), FB_SECRET))), d)).status).toBe(200);
    expect(await kinds(a.id)).toEqual(["facebook", "instagram", "wordpress"]);
    expect(await kinds(b.id)).toEqual(["facebook", "instagram"]);
  });

  it("answers 503 when no app secret is configured", async () => {
    const { d } = await setup({ metaAppSecret: null, instagramAppSecret: null });
    expect((await handleMetaDeauthorize(post("/api/meta/deauthorize", form(signedRequest(okPayload("9001"), FB_SECRET))), d)).status).toBe(503);
  });
});

describe("data deletion callback", () => {
  it("removes the connection, records a completed request and answers Meta's { url, confirmation_code }", async () => {
    const { store, a, b, d, kinds } = await setup();
    const res = await handleMetaDataDeletion(post("/api/meta/data-deletion", form(signedRequest(okPayload("9002"), FB_SECRET))), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = (await res.json()) as { url: string; confirmation_code: string };
    expect(Object.keys(body).sort()).toEqual(["confirmation_code", "url"]);
    expect(body.confirmation_code).toMatch(/^[A-Z2-9]{12}$/);
    expect(body.url).toBe(`${BASE}/data-deletion?code=${body.confirmation_code}`);
    expect(await kinds(b.id)).toEqual(["instagram"]);
    expect(await kinds(a.id)).toEqual(["facebook", "instagram", "wordpress"]);
    expect(await store.getDeletionRequest(body.confirmation_code)).toMatchObject({ provider: "facebook", subject_id: "9002", status: "completed", created_at: T0.toISOString(), completed_at: T0.toISOString() });
    const status = await deletionStatus(store, body.confirmation_code);
    expect(status).toEqual({ status: "completed", provider: "facebook", created_at: T0.toISOString(), completed_at: T0.toISOString() });
    expect(JSON.stringify(status)).not.toContain("9002"); // the status page never shows the user id
  });

  it("still answers success with a code when nothing matches", async () => {
    const { store, d } = await setup();
    const res = await handleMetaDataDeletion(post("/api/meta/data-deletion", form(signedRequest(okPayload("5599"), IG_SECRET))), d);
    expect(res.status).toBe(200);
    const { confirmation_code } = (await res.json()) as { confirmation_code: string };
    expect((await store.getDeletionRequest(confirmation_code))!).toMatchObject({ provider: "instagram", status: "completed" });
  });

  it("a removal that fails leaves the request pending (still 200 with the code)", async () => {
    const { store, d } = await setup();
    store.deleteDestination = async () => {
      throw new Error("db down");
    };
    const res = await handleMetaDataDeletion(post("/api/meta/data-deletion", form(signedRequest(okPayload("9001"), FB_SECRET))), d);
    expect(res.status).toBe(200);
    const { confirmation_code } = (await res.json()) as { confirmation_code: string };
    expect((await deletionStatus(store, confirmation_code))!.status).toBe("pending");
  });

  it("refuses a bad signature without recording anything; status lookup refuses malformed codes", async () => {
    const { store, d } = await setup();
    expect((await handleMetaDataDeletion(post("/api/meta/data-deletion", form(signedRequest({ ...okPayload("9001"), algorithm: "none" }, FB_SECRET))), d)).status).toBe(400);
    expect(store.deletionRequests.size).toBe(0);
    expect(await deletionStatus(store, "lower-case-x")).toBeNull();
    expect(await deletionStatus(store, "ABCDEFGHJKLM")).toBeNull();
    expect(await deletionStatus(store, null)).toBeNull();
  });
});

describe("routes", () => {
  const g = globalThis as { __siteManagerDeps?: Promise<ServerDeps> | null };
  afterEach(() => {
    g.__siteManagerDeps = undefined;
  });

  it("POST /api/meta/deauthorize and /api/meta/data-deletion run through the server deps", async () => {
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", PUBLIC_BASE_URL: BASE, META_APP_SECRET: FB_SECRET, INSTAGRAM_APP_SECRET: IG_SECRET }, log: () => {} });
    g.__siteManagerDeps = Promise.resolve(deps);
    const venue = (await deps.store.getVenueBySlug("agala"))!;
    await deps.store.upsertDestination({ venue_id: venue.id, kind: "facebook", config: { page_id: "1", app_user_id: "9001" }, secrets: "x" });
    await deps.store.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: "2", app_user_id: "5501" }, secrets: "y" });
    expect((await deauthorizeRoute(post("/api/meta/deauthorize", form(signedRequest(okPayload("9001"), FB_SECRET))))).status).toBe(200);
    expect((await deps.store.listDestinations(venue.id)).map((x) => x.kind)).toEqual(["instagram"]);
    const res = await dataDeletionRoute(post("/api/meta/data-deletion", form(signedRequest(okPayload("5501"), IG_SECRET))));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { url: string }).url).toMatch(new RegExp(`^${BASE}/data-deletion\\?code=[A-Z2-9]{12}$`));
    expect(await deps.store.listDestinations(venue.id)).toEqual([]);
  });
});
