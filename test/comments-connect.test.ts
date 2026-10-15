// test/comments-connect.test.ts — the comment scopes and the capability flag a connection stores; the dashboard's reconnect line follows it.
import { describe, expect, it } from "vitest";
import { CONNECTION_CODES } from "@/src/destinations/sync";
import { commentsOverview } from "@/src/server/admin-comments";
import { COMMENTS_CAPABILITY, FB_SCOPES, IG_PUBLISH_SCOPES } from "@/src/server/social-connect";
import { connectedVenue, T0 } from "./comments-helpers";

describe("comment scopes", () => {
  it("ask Meta for reading and replying to comments on both networks", () => {
    expect(FB_SCOPES.split(",")).toEqual(expect.arrayContaining(["pages_read_user_content", "pages_manage_engagement"]));
    expect(IG_PUBLISH_SCOPES.split(",")).toContain("instagram_business_manage_comments");
    expect(COMMENTS_CAPABILITY).toBe("comments");
  });
  it("a connection made before the comment scopes shows the reconnect line until it is connected again", async () => {
    const v = await connectedVenue();
    const ig = (await v.store.getDestination(v.venue.id, "instagram"))!;
    const { comments: _c, ...older } = ig.config;
    void _c;
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "instagram", config: older, secrets: ig.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: false, instagram: true });
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "instagram", config: { ...older, [COMMENTS_CAPABILITY]: true }, secrets: ig.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: false, instagram: false });
  });
  it("the same for a Facebook Page connected before the comment scopes", async () => {
    const v = await connectedVenue();
    const fb = (await v.store.getDestination(v.venue.id, "facebook"))!;
    const { comments: _c, ...older } = fb.config;
    void _c;
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "facebook", config: older, secrets: fb.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: true, instagram: false });
    await v.store.upsertDestination({ venue_id: v.venue.id, kind: "facebook", config: { ...older, [COMMENTS_CAPABILITY]: true }, secrets: fb.secrets });
    expect((await commentsOverview(v.store, await v.store.getVenue(v.venue.id), T0)).needs_reconnect).toEqual({ facebook: false, instagram: false });
  });
});

describe("connection errors", () => {
  it("one set of reconnect codes, shared by the push and the comment poller", () => {
    expect([...CONNECTION_CODES].sort()).toEqual(["sm_meta_permission", "sm_meta_token"]);
  });
});
