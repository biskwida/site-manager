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
