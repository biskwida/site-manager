// test/admin-auth.test.ts — authorizeAdmin: a legacy key for this slug, or a signed-in account that owns the venue. Never by email.
import { describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser() }));

import { authorizeAdmin } from "@/src/server/admin-auth";
import { InMemoryStore } from "@/src/store/memory";
import { seedDemo } from "@/src/seed/demo";

async function setup() {
  const store = new InMemoryStore();
  const { venue } = await seedDemo(store);
  const other = await store.createVenue({ slug: "other", name: "Other" });
  return { store, venue, other, key: await store.getAdminToken(venue.id), otherKey: await store.getAdminToken(other.id) };
}
const req = (slug: string, key?: string) => new Request(`https://x.app/api/admin/${slug}${key ? `?key=${encodeURIComponent(key)}` : ""}`);
const as = (id: string | null, email = "o@example.com") => sessionUser.mockResolvedValue(id ? { id, email } : null);

describe("authorizeAdmin", () => {
  it("accepts a key that matches the slug, as before", async () => {
    const { store, venue, key } = await setup();
    as(null);
    expect(await authorizeAdmin(req(venue.slug, key), venue.slug, { store })).toEqual({ venue, via: "key", key });
  });

  it("refuses a key for another slug, even when a session owns the requested venue", async () => {
    const { store, venue, otherKey } = await setup();
    as("u1");
    await store.linkVenueUser(venue.id, "u1", "owner");
    expect(await authorizeAdmin(req(venue.slug, otherKey), venue.slug, { store })).toBeNull();
    expect(await authorizeAdmin(req(venue.slug, "wrong"), venue.slug, { store })).toBeNull();
  });

  it("accepts a session user who owns the venue (via session, no key)", async () => {
    const { store, venue } = await setup();
    await store.linkVenueUser(venue.id, "u1", "owner");
    as("u1");
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store })).toEqual({ venue, via: "session" });
  });

  it("refuses a signed-in user who does not own the venue, is only staff, or has the owner's email only", async () => {
    const { store, venue, other } = await setup();
    await store.linkVenueUser(other.id, "u1", "owner");
    await store.linkVenueUser(venue.id, "u2", "staff");
    await store.createPendingAccountInvite(venue.id, "o@example.com"); // an unclaimed invite grants nothing
    as("u1");
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store })).toBeNull();
    as("u2");
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store })).toBeNull();
    as("u3", "o@example.com");
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store })).toBeNull();
  });

  it("refuses without a key and without a session, and for an unknown slug", async () => {
    const { store, venue } = await setup();
    as(null);
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store })).toBeNull();
    as("u1");
    expect(await authorizeAdmin(req("nope"), "nope", { store })).toBeNull();
  });

  it("takes an injected session reader (no cookies needed)", async () => {
    const { store, venue } = await setup();
    await store.linkVenueUser(venue.id, "u9", "owner");
    as(null);
    expect(await authorizeAdmin(req(venue.slug), venue.slug, { store, sessionUser: async () => ({ id: "u9", email: "x@y.z" }) })).toMatchObject({ via: "session" });
  });
});
