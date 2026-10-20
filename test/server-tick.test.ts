// test/server-tick.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import { startDeploy } from "@/src/deploy/run";
import { handleTickRequest } from "@/src/server/tick";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("handleTickRequest", () => {
  it("authorises by header, bearer token or admin key, and scopes by venue for a key", async () => {
    const demo = await makeDemo();
    const other = await demo.store.createVenue({ slug: "other", name: "Other" });
    const a = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const b = await demo.store.createChangeSet({ venue_id: other.id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const deps = { config: { tickSecret: "tick" }, store: demo.store, messenger: new FakeMessenger() };
    expect((await handleTickRequest(new Request("http://x/api/tick"), deps, T0)).status).toBe(401);
    expect((await handleTickRequest(new Request("http://x/api/tick?key=nope"), deps, T0)).status).toBe(401);
    const key = await demo.store.getAdminToken(demo.venue.id);
    const scoped = await handleTickRequest(new Request(`http://x/api/tick?key=${key}`), deps, T0);
    expect(scoped.status).toBe(200);
    expect(await scoped.json()).toMatchObject({ applied: [a.id] });
    const all = await handleTickRequest(new Request("http://x/api/tick", { headers: { authorization: "Bearer tick" } }), deps, T0);
    expect(await all.json()).toMatchObject({ applied: [b.id] });
    const hdr = await handleTickRequest(new Request("http://x/api/tick", { headers: { "x-tick-secret": "tick" } }), deps, T0);
    expect(hdr.status).toBe(200);
  });

  it("accepts the signed-in owner by ?slug= (POST needs a same-host Origin), scoped to that venue", async () => {
    const demo = await makeDemo();
    const other = await demo.store.createVenue({ slug: "other", name: "Other" });
    const mk = (venue_id: string) => demo.store.createChangeSet({ venue_id, chat_ref: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const a = await mk(demo.venue.id);
    await mk(other.id);
    await demo.store.linkVenueUser(demo.venue.id, "u1", "owner");
    await demo.store.linkVenueUser(demo.venue.id, "u2", "staff");
    let who: string | null = "u1";
    const deps = { config: { tickSecret: "tick" }, store: demo.store, messenger: new FakeMessenger(), sessionUser: async () => (who ? { id: who } : null) };
    const post = (q: string, headers: Record<string, string> = { origin: "http://x" }) => handleTickRequest(new Request(`http://x/api/tick?${q}`, { method: "POST", headers }), deps, T0);
    expect((await post("slug=other")).status).toBe(401); // owns another venue
    expect((await post("slug=agala", {})).status).toBe(403); // cookie POST without Origin
    expect((await post("slug=agala", { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("slug=agala&key=wrong")).status).toBe(401); // a bad key is no fallback
    who = "u2";
    expect((await post("slug=agala")).status).toBe(401); // staff
    who = null;
    expect((await post("slug=agala")).status).toBe(401);
    who = "u1";
    const ok = await post("slug=agala");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ applied: [a.id] });
    expect((await handleTickRequest(new Request("http://x/api/tick?slug=agala"), deps, T0)).status).toBe(200); // GET: nothing sensitive, no Origin needed
  });

  it("polls the venue's deployment on an admin-key tick when a deployer is wired", async () => {
    const demo = await makeDemo();
    const other = await demo.store.createVenue({ slug: "other", name: "Other" });
    const deployer = new FakeDeployer();
    const feedUrlFor = (s: string) => `https://sm.example/api/site/${s}`;
    await startDeploy({ store: demo.store, deployer, feedUrlFor, now: () => T0 }, demo.venue.id);
    await startDeploy({ store: demo.store, deployer, feedUrlFor, now: () => T0 }, other.id);
    const deps = { config: { tickSecret: "tick" }, store: demo.store, messenger: new FakeMessenger(), deployer };
    const key = await demo.store.getAdminToken(demo.venue.id);
    expect(await (await handleTickRequest(new Request(`http://x/api/tick?key=${key}`), deps, T0)).json()).toMatchObject({ ok: true, deployed: [], deployFailed: [], cleaned: [] });
    expect(await (await handleTickRequest(new Request(`http://x/api/tick?key=${key}`), deps, T0)).json()).toMatchObject({ deployed: [demo.venue.id] });
    expect((await demo.store.getVenue(demo.venue.id)).deploy).toMatchObject({ status: "ready", url: "https://agala.example.test" });
    expect((await demo.store.getVenue(other.id)).deploy?.status).toBe("building"); // scoped to the key's venue
    const noDeployer = { config: { tickSecret: "tick" }, store: demo.store, messenger: new FakeMessenger() };
    expect(await (await handleTickRequest(new Request("http://x/api/tick", { headers: { "x-tick-secret": "tick" } }), noDeployer, T0)).json()).toMatchObject({ deployed: [], deployFailed: [], cleaned: [] });
    expect((await demo.store.getVenue(other.id)).deploy?.status).toBe("building");
  });
});
