// test/dashboard-pages.test.tsx — /dashboard (venue list), /dashboard/[slug] (the admin UI on a session) and the key banner on /admin/[slug].
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: to });
  },
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
let store: InMemoryStore;
vi.mock("@/src/server/deps", () => ({
  getServerDeps: async () => ({ store, config: { publicBaseUrl: "https://x.app" }, deployer: null, destinationSecretKey: null }),
}));

import { SessionExpired } from "@/app/admin/[slug]/components/SessionExpired";
import { AdminPanel } from "@/app/admin/[slug]/components/AdminPanel";
import { adminApiUrl } from "@/app/admin/[slug]/components/useAdminOverview";
import AdminPage from "@/app/admin/[slug]/page";
import DashboardPage from "@/app/dashboard/page";
import DashboardSlugPage from "@/app/dashboard/[slug]/page";
import { LangProvider } from "@/src/i18n";
import { adminOverview } from "@/src/server/admin";
import { seedDemo } from "@/src/seed/demo";
import { InMemoryStore } from "@/src/store/memory";

async function outcome(run: () => Promise<unknown>): Promise<{ redirectTo?: string; notFound?: boolean; html?: string }> {
  try {
    const el = (await run()) as React.ReactElement;
    return { html: renderToStaticMarkup(el) };
  } catch (e) {
    const x = e as { redirectTo?: string; notFound?: boolean };
    if (x.redirectTo || x.notFound) return { redirectTo: x.redirectTo, notFound: x.notFound };
    throw e;
  }
}
const slugProps = (slug: string, sp: Record<string, string> = {}) => ({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(sp) }) as never;

let venueId = "";
beforeEach(async () => {
  store = new InMemoryStore();
  venueId = (await seedDemo(store)).venue.id;
  sessionUser.mockResolvedValue(null);
});

describe("/dashboard", () => {
  it("sends a signed-out visitor to /login with next", async () => {
    expect(await outcome(() => DashboardPage())).toEqual({ redirectTo: "/login?next=%2Fdashboard" });
  });
  it("lists the user's venues (name, slug, site mode) with links to /dashboard/<slug>, and only theirs", async () => {
    const mine = await store.createVenue({ slug: "my-cafe", name: "My Café" });
    await store.updateVenue(mine.id, { site_mode: "own", site_url: "https://my.example" });
    await store.linkVenueUser(mine.id, "u1", "owner");
    await store.linkVenueUser(venueId, "u2", "owner");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const { html } = await outcome(() => DashboardPage());
    expect(html).toContain("My Café");
    expect(html).toContain("my-cafe");
    expect(html).toContain("Собствен сайт");
    expect(html).toContain('href="/dashboard/my-cafe"');
    expect(html).not.toContain("/dashboard/agala");
  });
  it("shows an empty state that links to /start", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const { html } = await outcome(() => DashboardPage());
    expect(html).toContain("още няма свързан бизнес");
    expect(html).toContain('href="/start"');
  });
});

describe("/dashboard/[slug]", () => {
  it("sends a signed-out visitor to /login with next=/dashboard/<slug>", async () => {
    expect(await outcome(() => DashboardSlugPage(slugProps("agala")))).toEqual({ redirectTo: "/login?next=%2Fdashboard%2Fagala" });
  });
  it("renders the admin UI for an owner, with no key anywhere in the page", async () => {
    await store.linkVenueUser(venueId, "u1", "owner");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const { html } = await outcome(() => DashboardSlugPage(slugProps("agala")));
    expect(html).toContain("Табло");
    expect(html).toContain("Кафене „Ъгъла“");
    expect(html).not.toContain("key=");
    expect(html).not.toContain("Добавете имейла");
    expect(sessionUser).toHaveBeenCalledTimes(1); // the page's user is passed on: no second getUser
  });
  it("answers not-found, the same as for a missing slug, to a user who does not own it", async () => {
    await store.linkVenueUser(venueId, "u2", "staff");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    expect(await outcome(() => DashboardSlugPage(slugProps("agala")))).toEqual({ notFound: true });
    expect(await outcome(() => DashboardSlugPage(slugProps("agala-nope")))).toEqual({ notFound: true });
    sessionUser.mockResolvedValue({ id: "u2", email: "o@example.com" }); // staff
    expect(await outcome(() => DashboardSlugPage(slugProps("agala")))).toEqual({ notFound: true });
  });
  it("ignores a ?key= in its URL: only the account opens it", async () => {
    const key = await store.getAdminToken(venueId);
    expect(await outcome(() => DashboardSlugPage(slugProps("agala", { key })))).toMatchObject({ redirectTo: expect.stringContaining("/login") });
  });
});

describe("/admin/[slug] (legacy key page)", () => {
  it("opens with the key and offers the email banner until an owner account exists", async () => {
    const key = await store.getAdminToken(venueId);
    const first = await outcome(() => AdminPage(slugProps("agala", { key })));
    expect(first.html).toContain("Табло");
    expect(first.html).toContain("Добавете имейла си, за да влизате без линк");
    expect(first.html).toContain("Помолете екипа на Claudia да свърже имейла ви — после влизате на getclaudia.app/login");
    expect(first.html).not.toContain("/login?next=");
    expect(first.html).not.toContain("<a href=\"/login");
    await store.linkVenueUser(venueId, "u1", "owner");
    const second = await outcome(() => AdminPage(slugProps("agala", { key })));
    expect(second.html).toContain("Табло");
    expect(second.html).not.toContain("Добавете имейла");
  });
  it("does not open from a session alone, or with another slug's key", async () => {
    await store.linkVenueUser(venueId, "u1", "owner");
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const bare = await outcome(() => AdminPage(slugProps("agala")));
    expect(bare.html).toContain("не е валиден");
    const other = await store.createVenue({ slug: "other-v", name: "Other" });
    const otherKey = await store.getAdminToken(other.id);
    expect((await outcome(() => AdminPage(slugProps("agala", { key: otherKey })))).html).toContain("не е валиден");
  });
});

describe("hasOwnerAccount failing never breaks the key page", () => {
  it("opens the dashboard and hides the banner", async () => {
    const key = await store.getAdminToken(venueId);
    store.hasOwnerAccount = async () => {
      throw new Error("venue_users unavailable");
    };
    const { html } = await outcome(() => AdminPage(slugProps("agala", { key })));
    expect(html).toContain("Табло");
    expect(html).not.toContain("Добавете имейла");
  });
});

describe("the admin client without a key", () => {
  it("has a session-expired notice with a way back in (shown instead of the key text when the account dashboard poll gets a 401)", () => {
    const html = renderToStaticMarkup(<LangProvider defaultLang="bg"><SessionExpired slug="agala" /></LangProvider>);
    expect(html).toContain("Сесията изтече — влезте отново");
    expect(html).toContain('href="/login?next=%2Fdashboard%2Fagala"');
    expect(renderToStaticMarkup(<LangProvider defaultLang="en"><SessionExpired slug="agala" /></LangProvider>)).toContain("Your session expired — log in again");
  });
  it("adminApiUrl adds ?key= only when there is a key", () => {
    expect(adminApiUrl("agala", "k 1")).toBe("/api/admin/agala?key=k%201");
    expect(adminApiUrl("agala", "")).toBe("/api/admin/agala");
    expect(adminApiUrl("agala", undefined, "/social/facebook/start")).toBe("/api/admin/agala/social/facebook/start");
    expect(adminApiUrl("agala", "k", "/social")).toBe("/api/admin/agala/social?key=k");
  });
  it("renders the cards with no key in any link when the panel has none", async () => {
    const venue = (await store.getVenue(venueId));
    const o = await adminOverview(store, venue, new Date("2026-10-19T09:00:00Z"), "https://x.app", { social: { facebook: true, instagram: true } });
    const html = renderToStaticMarkup(<LangProvider defaultLang="en"><AdminPanel slug="agala" initial={o} /></LangProvider>);
    expect(html).toContain("/api/admin/agala/social/facebook/start");
    expect(html).not.toContain("key=");
    expect(html).not.toContain("Add your email");
  });
});
