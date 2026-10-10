// test/server-tick.test.ts
import { describe, expect, it } from "vitest";
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
});
