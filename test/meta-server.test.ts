// test/meta-server.test.ts
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { BotDeps, RunRequest } from "@/src/bot/bot";
import { handleMetaRequest, resetDedupe, verifySignature } from "@/src/server/meta";
import { FakeMessenger, makeDemo } from "./helpers";

const SECRET = "app-secret";
const sign = (body: string) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
const text = (mid: string, body: string, sender = "500") => JSON.stringify({ object: "page", entry: [{ id: "P", time: 1, messaging: [{ sender: { id: sender }, recipient: { id: "P" }, timestamp: 1, message: { mid, text: body } }] }] });

async function setup() {
  const demo = await makeDemo();
  await demo.store.upsertMember({ venue_id: demo.venue.id, chat_ref: "fb:500", role: "owner", lang: "bg" });
  const runs: RunRequest[] = []; const deferred: Promise<void>[] = [];
  const messenger = new FakeMessenger();
  const botDeps: BotDeps = { token: "t", store: demo.store, messenger, baseUrl: "http://x", now: () => new Date("2026-10-09T09:00:00.000Z"), startRun: () => { throw new Error("meta path must not use startRun"); }, transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  const deps = { config: { metaAppSecret: SECRET, metaVerifyToken: "verify-me" }, botDeps, handleRun: async (r: RunRequest) => { runs.push(r); }, defer: (fn: () => Promise<void>) => { deferred.push(fn()); }, waDownload: async () => ({ bytes: new Uint8Array(), contentType: "" }), fetchUrl: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
  const post = (body: string, sig: string | null = sign(body)) => handleMetaRequest(new Request("http://localhost/api/meta", { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-hub-signature-256": sig } : {}) }, body }), deps);
  return { ...demo, runs, deferred, messenger, deps, post };
}

beforeEach(() => resetDedupe());

describe("handleMetaRequest", () => {
  it("answers the verification handshake only with the right token", async () => {
    const { deps } = await setup();
    const ok = await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"), deps);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("12345");
    expect((await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"), deps)).status).toBe(403);
    expect((await handleMetaRequest(new Request("http://x/api/meta?hub.mode=subscribe&hub.verify_token=&hub.challenge=1"), { ...deps, config: { metaAppSecret: SECRET, metaVerifyToken: null } })).status).toBe(403);
  });
  it("rejects bad signatures, processes good ones after responding, and dedupes redeliveries (Review Focus 5)", async () => {
    const { post, runs, deferred } = await setup();
    const body = text("m1", "Капучиното става 3,20");
    expect((await post(body, null)).status).toBe(401);
    expect((await post(body, "sha256=deadbeef")).status).toBe(401);
    const ok = await post(body);
    expect(ok.status).toBe(200); expect(await ok.text()).toBe("EVENT_RECEIVED");
    await Promise.all(deferred);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ chatRef: "fb:500", text: "Капучиното става 3,20", source: "text" });
    await post(body); await Promise.all(deferred);
    expect(runs).toHaveLength(1);
    await post(text("m2", "второ")); await Promise.all(deferred);
    expect(runs).toHaveLength(2);
  });
  it("returns 400 on a non-JSON body and 401 when no secret is configured", async () => {
    const { deps } = await setup();
    const bad = new Request("http://x/api/meta", { method: "POST", headers: { "x-hub-signature-256": sign("nope") }, body: "nope" });
    expect((await handleMetaRequest(bad, deps)).status).toBe(400);
    const noSecret = new Request("http://x/api/meta", { method: "POST", headers: { "x-hub-signature-256": sign("{}") }, body: "{}" });
    expect((await handleMetaRequest(noSecret, { ...deps, config: { metaAppSecret: null, metaVerifyToken: "v" } })).status).toBe(401);
  });
  it("verifySignature is constant-time safe on length mismatch", () => {
    expect(verifySignature("abc", "sha256=00", SECRET)).toBe(false);
    expect(verifySignature("abc", null, SECRET)).toBe(false);
    expect(verifySignature("abc", sign("abc"), SECRET)).toBe(true);
  });
});
