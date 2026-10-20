// test/final-fixes.test.tsx — the final fix wave: trial on every publish, /new needs an account while billing is on, the post-signup URL,
// the website Checkout key, the copy for a venue with no website, and the policies.sql guard.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.fn<() => Promise<{ id: string; email: string } | null>>(async () => null);
vi.mock("@/src/server/session", () => ({ getSessionUser: () => sessionUser(), supabasePublicEnv: () => ({ url: "https://x.supabase.co", anonKey: "k" }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { redirectTo: to });
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
let billingEnabled = true;
vi.mock("@/src/server/deps", () => ({ getServerDeps: async () => ({ store: new InMemoryStore(), config: { billingEnabled, publicBaseUrl: "https://getclaudia.app" } }) }));
const afterCreated = vi.fn(async (venue: unknown) => void venue);
vi.mock("@/src/server/after-venue-created", () => ({ afterVenueCreated: (v: unknown) => afterCreated(v) }));

import NewPage from "@/app/new/page";
import { withLang } from "@/src/auth/start-links";
import { websiteSetupSession } from "@/src/billing/stripe";
import { copy } from "@/src/bot/copy";
import { createDraft, publishDraft, updateDraft } from "@/src/server/wizard";
import { InMemoryStore } from "@/src/store/memory";
import { emptyDraft, type WizardDraft } from "@/src/wizard/schema";
import { BILLING } from "@/src/i18n/billing";

const T0 = new Date("2026-10-20T09:00:00.000Z");
const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) }) as never;

beforeEach(() => {
  billingEnabled = true;
  sessionUser.mockReset().mockResolvedValue(null);
  afterCreated.mockClear();
});

describe("2. /new with billing on needs an account", () => {
  async function run(o: Record<string, string> = {}) {
    try {
      return { page: await NewPage(sp(o)) }; // the chooser element itself; it is a client component, so it is not rendered here
    } catch (e) {
      const x = e as { redirectTo?: string };
      if (x.redirectTo) return { redirectTo: x.redirectTo };
      throw e;
    }
  }
  it("billing on, signed out: to /start, keeping the language", async () => {
    expect(await run({ lang: "en" })).toEqual({ redirectTo: "/start?lang=en" });
    expect(await run()).toEqual({ redirectTo: "/start?lang=bg" });
  });
  it("billing on, signed in: the chooser", async () => {
    sessionUser.mockResolvedValue({ id: "u1", email: "o@example.com" });
    const r = await run();
    expect(r.redirectTo).toBeUndefined();
    expect(r.page).toBeTruthy();
  });
  it("billing off: the chooser for everyone, exactly as before (the session is not even asked)", async () => {
    billingEnabled = false;
    const r = await run();
    expect(r.redirectTo).toBeUndefined();
    expect(r.page).toBeTruthy();
    expect(sessionUser).not.toHaveBeenCalled();
  });
});

describe("2. every non-add-on publish runs the after-created hook", () => {
  const filled = (slug: string): Partial<WizardDraft> => ({
    name: "Coffique", slug, default_lang: "bg", address: "ул. Кракра 24, София", phone: "+359 2 222 2222", instagram: "", maps_url: "",
    hours: emptyDraft("classic").hours, theme: { accent: "#2f6b4f" },
    tagline_bg: "Кафе", tagline_en: "Coffee", about_bg: "За нас", about_en: "About us",
    texts: { welcome: { bg: "Здравейте", en: "Hello" }, footer_note: { bg: "", en: "" } },
    logo_media_id: null, cover_media_id: null, gallery_media_ids: [],
    categories: [{ key: "c", name_bg: "Кафе", name_en: "Coffee", items: [{ key: "e", name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], image_media_id: null }] }],
    step: "review",
  });
  it("a publish with no account calls it too (the hook itself is a no-op while billing is off)", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("no-account"));
    const done = await publishDraft(store, await store.getVenue(d.venue.id), T0);
    expect(done.venue.status).toBe("live");
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
  it("a publish with an account still calls it once", async () => {
    const store = new InMemoryStore();
    const d = await createDraft(store, "classic", T0);
    await updateDraft(store, d.venue, filled("with-account"));
    await publishDraft(store, await store.getVenue(d.venue.id), T0, { userId: "u1" });
    expect(afterCreated).toHaveBeenCalledTimes(1);
  });
});

describe("5. withLang", () => {
  it("adds ?lang= to a plain path and &lang= when there is a query already", () => {
    expect(withLang("/onboarding/x", "bg")).toBe("/onboarding/x?lang=bg");
    expect(withLang("/billing/x?required=1", "bg")).toBe("/billing/x?required=1&lang=bg");
  });
  it("replaces a lang that is already there", () => {
    expect(withLang("/billing/x?lang=en&required=1", "bg")).toBe("/billing/x?lang=bg&required=1");
  });
});

describe("10. the website Checkout key carries the language", () => {
  it("website-<venue>-<lang>-<bucket>", async () => {
    const keys: (string | undefined)[] = [];
    const stripe = { checkout: { sessions: { create: async (_p: unknown, o?: { idempotencyKey?: string }) => (keys.push(o?.idempotencyKey), { url: "https://stripe.test/s" }) } } };
    const store = new InMemoryStore();
    const venue = await store.createVenue({ slug: "k", name: "K" });
    const opts = { baseUrl: "https://getclaudia.app", prices: { admin: "a", social: "s", both: "b", websiteSetup: "w" }, now: T0 };
    await websiteSetupSession(stripe as never, venue, { email: "o@example.com" }, { ...opts, lang: "bg" });
    await websiteSetupSession(stripe as never, venue, { email: "o@example.com" }, { ...opts, lang: "en" });
    const bucket = Math.floor(T0.getTime() / (30 * 60_000));
    expect(keys).toEqual([`website-${venue.id}-bg-${bucket}`, `website-${venue.id}-en-${bucket}`]);
  });
});

describe("11. a venue with no website is not told about its website", () => {
  const url = "https://x/billing/k";
  it("page=true says page and posts (Bulgarian and English)", () => {
    for (const lang of ["bg", "en"] as const) {
      const c = copy(lang);
      for (const line of [c.trialEnded(url, true), c.trialEndedRefusal(url, true), c.planPausedRefusal(url, true), c.pastDueRefusal(url, true)]) {
        expect(line).not.toMatch(/website|Сайтът/);
        expect(line.toLowerCase()).toContain(lang === "bg" ? "страницата и публикациите ви остават онлайн" : "your page and posts stay online");
      }
    }
  });
  it("the default is unchanged", () => {
    expect(copy("en").trialEnded(url)).toContain("Your website and posts stay online");
    expect(copy("bg").trialEndedRefusal(url)).toContain("Сайтът и постовете ви остават онлайн");
  });
});

describe("13. the Social plan note mentions ad plans", () => {
  it("both languages", () => {
    expect(BILLING.en["plan.social.note"]).toBe("Posts, stories, comment replies, ad plans");
    expect(BILLING.bg["plan.social.note"]).toContain("рекламни планове");
  });
});

describe("3. policies.sql runs on a database without billing_events", () => {
  const sql = readFileSync(new URL("../supabase/policies.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  it("the billing_events statements sit inside a do block that checks the table exists first", () => {
    const blocks = sql.match(/do \$\$[\s\S]*?end \$\$;/g) ?? [];
    const guarded = blocks.filter((b) => b.includes("billing_events"));
    expect(guarded).toHaveLength(1);
    expect(guarded[0]).toMatch(/if to_regclass\('public\.billing_events'\) is not null then/);
    expect(guarded[0]).toContain("enable row level security");
    expect(guarded[0]).toContain("revoke all on public.billing_events");
    // nothing outside that block mentions the table
    expect(sql.replace(guarded[0], "")).not.toContain("billing_events");
  });
});
