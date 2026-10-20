// test/entitlements.test.ts — plan gating in the agent, paused never offline, the free trial's 20-change limit, the trial end and its reminders.
import { describe, expect, it, vi } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { copy } from "@/src/bot/copy";
import { usageLine } from "@/src/bot/limit";
import { billingUrl, effectiveLimit, entitlement, lockedFeatures, type BillingConfig } from "@/src/billing/entitlements";
import { pauseExpiredTrials, sendTrialReminders, type TrialBilling } from "@/src/billing/reminders";
import { applyStripeEvent, type StripeLike, type StripeSubscription } from "@/src/billing/stripe";
import { planChanges } from "@/src/domain/changes";
import type { Venue } from "@/src/domain/types";
import { ownerEmailsFrom } from "@/src/server/owner-emails";
import { handleTickRequest } from "@/src/server/tick";
import type { InMemoryStore } from "@/src/store/memory";
import { changeUsage } from "@/src/store/usage";
import { SupabaseStore } from "@/src/store/supabase";
import { runTick } from "@/src/tick";
import { at as commentAt, connectedVenue, MIN as COMMENT_MIN, T0 as COMMENT_T0 } from "./comments-helpers";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-19T09:00:00.000Z"); // Mon 19 Oct 2026, 12:00 Sofia
const DAY = 86_400_000;
const iso = (offsetDays: number, from = T0) => new Date(from.getTime() + offsetDays * DAY).toISOString();
const BASE = "https://getclaudia.app";
const CONFIG: BillingConfig = { billingEnabled: true, trialChangeLimit: 20, trialRequiresCard: false, publicBaseUrl: BASE };
const LINK = `${BASE}/billing/agala`;

type VenuePatch = Parameters<InMemoryStore["updateVenue"]>[1];

/** An applied set that counts as a change (source text) at `at`. */
async function applied(store: InMemoryStore, venueId: string, at: string, source: "text" | "undo" | "auto" = "text") {
  const cs = await store.createChangeSet({ venue_id: venueId, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source, status: "proposed", changes: [] });
  await store.applyChangeSet(cs.id, at);
  return cs;
}

/** The demo venue with billing on and the venue's billing fields set AFTER any applied sets are seeded (so seeding is never limited). */
async function setup(opts: { venue?: VenuePatch; config?: Partial<BillingConfig> | null; seed?: (s: Awaited<ReturnType<typeof makeDemo>>) => Promise<void> } = {}) {
  const demo = await makeDemo();
  await opts.seed?.(demo);
  await demo.store.updateVenue(demo.venue.id, opts.venue ?? {});
  if (opts.config !== null) demo.store.billingConfig = { ...CONFIG, ...opts.config };
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: BASE };
  const tools = makeTools(deps);
  const price = (name = "Cappuccino", to = 3.2) => ({ summary_bg: `${name} ${to}`, summary_en: `${name} ${to}`, changes: [{ op: "set_price" as const, item_id: demo.items[name].id, price_eur: to }] });
  const propose = (to = 3.2) => call(tools, "propose_changes", price("Cappuccino", to));
  const sets = () => demo.store.listChangeSets(demo.venue.id, {});
  return { ...demo, messenger, deps, tools, propose, sets, member };
}

const TRIALING: VenuePatch = { billing_status: "trialing", trial_started_at: iso(-5), trial_ends_at: iso(9) };

describe("entitlement()", () => {
  const v = (over: Partial<Venue> = {}): Venue => ({ plan: null, billing_status: null, trial_started_at: null, trial_ends_at: null, past_due_since: null, stripe_subscription_id: null, ...over }) as Venue;
  const on = { billingEnabled: true };

  it("with BILLING_ENABLED off everything is ok, whatever the venue says", () => {
    for (const venue of [v({ billing_status: "paused" }), v({ billing_status: "canceled" }), v({ plan: "admin", billing_status: "active" }), v({ billing_status: "trialing", trial_ends_at: iso(-3) })]) {
      for (const f of ["site", "social", "comments", "boost"] as const) expect(entitlement(venue, f, T0, { billingEnabled: false, trialRequiresCard: true })).toEqual({ ok: true });
    }
  });

  it("a venue billing never touched is ok", () => {
    expect(entitlement(v(), "social", T0, on)).toEqual({ ok: true });
  });

  it("a trialing Admin plan: site ok, social / comments / boost are not in the plan", () => {
    const venue = v({ plan: "admin", billing_status: "trialing", trial_ends_at: iso(9) });
    expect(entitlement(venue, "site", T0, on)).toEqual({ ok: true });
    for (const f of ["social", "comments", "boost"] as const) expect(entitlement(venue, f, T0, on)).toEqual({ ok: false, reason: "not_in_plan" });
    expect(lockedFeatures(venue, on)).toEqual(["social", "comments", "boost"]);
  });

  it("a Social plan has no site changes; Both has everything", () => {
    expect(entitlement(v({ plan: "social", billing_status: "active" }), "site", T0, on)).toEqual({ ok: false, reason: "not_in_plan" });
    expect(entitlement(v({ plan: "social", billing_status: "active" }), "boost", T0, on)).toEqual({ ok: true });
    for (const f of ["site", "social", "comments", "boost"] as const) expect(entitlement(v({ plan: "both", billing_status: "active" }), f, T0, on)).toEqual({ ok: true });
  });

  it("a trialing venue with no plan has every feature", () => {
    const venue = v({ billing_status: "trialing", trial_ends_at: iso(9) });
    for (const f of ["site", "social", "comments", "boost"] as const) expect(entitlement(venue, f, T0, on)).toEqual({ ok: true });
    expect(lockedFeatures(venue, on)).toEqual([]);
  });

  it("paused and canceled are refused as paused", () => {
    expect(entitlement(v({ plan: "both", billing_status: "paused" }), "site", T0, on)).toEqual({ ok: false, reason: "paused" });
    expect(entitlement(v({ plan: "both", billing_status: "canceled" }), "site", T0, on)).toEqual({ ok: false, reason: "paused" });
  });

  it("a free trial that is over by the clock is paused even before the tick flips it; a Stripe trial is not", () => {
    expect(entitlement(v({ billing_status: "trialing", trial_ends_at: iso(-1) }), "site", T0, on)).toEqual({ ok: false, reason: "paused" });
    expect(entitlement(v({ billing_status: "trialing", trial_ends_at: iso(-1), stripe_subscription_id: "sub_1", plan: "both" }), "site", T0, on)).toEqual({ ok: true });
  });

  it("past_due works for 7 days after past_due_since, then is past_due_expired", () => {
    const at = (days: number) => entitlement(v({ plan: "both", billing_status: "past_due", past_due_since: iso(-days) }), "site", T0, on);
    expect(at(0)).toEqual({ ok: true });
    expect(at(6.9)).toEqual({ ok: true });
    expect(at(7)).toEqual({ ok: false, reason: "past_due_expired" });
    expect(at(30)).toEqual({ ok: false, reason: "past_due_expired" });
    expect(entitlement(v({ plan: "both", billing_status: "past_due", past_due_since: null }), "site", T0, on)).toEqual({ ok: true });
  });

  it("TRIAL_REQUIRES_CARD: a free trial without a subscription needs a card; a subscription does not", () => {
    const cfg = { billingEnabled: true, trialRequiresCard: true };
    expect(entitlement(v({ billing_status: "trialing", trial_ends_at: iso(9) }), "site", T0, cfg)).toEqual({ ok: false, reason: "card_required" });
    expect(entitlement(v({ billing_status: "trialing", trial_ends_at: iso(9), stripe_subscription_id: "sub_1", plan: "both" }), "site", T0, cfg)).toEqual({ ok: true });
  });
});

describe("effectiveLimit()", () => {
  const venue = (over: Partial<Venue> = {}) => ({ change_limit: null, plan: null, billing_status: null, trial_started_at: null, trial_ends_at: null, past_due_since: null, stripe_subscription_id: null, ...over }) as Venue;
  it("is change_limit alone with billing off", () => {
    expect(effectiveLimit(venue({ plan: "admin", billing_status: "active" }), { ...CONFIG, billingEnabled: false })).toMatchObject({ kind: "none", limit: null });
    expect(effectiveLimit(venue({ change_limit: 7, billing_status: "trialing" }), undefined)).toMatchObject({ kind: "override", limit: 7 });
  });
  it("plan limits when change_limit is null: Admin 40, Both 150, Social none; an explicit change_limit wins", () => {
    expect(effectiveLimit(venue({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" }), CONFIG)).toMatchObject({ kind: "plan", limit: 40 });
    expect(effectiveLimit(venue({ plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" }), CONFIG)).toMatchObject({ kind: "plan", limit: 150 });
    expect(effectiveLimit(venue({ plan: "social", billing_status: "active", stripe_subscription_id: "sub_1" }), CONFIG)).toMatchObject({ kind: "none", limit: null });
    expect(effectiveLimit(venue({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1", change_limit: 5 }), CONFIG)).toMatchObject({ kind: "override", limit: 5 });
  });
  it("a free trial counts TRIAL_CHANGE_LIMIT over [trial_started_at, trial_ends_at); a subscription switches to the plan's number", () => {
    const trial = venue({ billing_status: "trialing", trial_started_at: iso(-5), trial_ends_at: iso(9) });
    expect(effectiveLimit(trial, CONFIG, T0)).toEqual({ kind: "trial", limit: 20, window: { from: iso(-5), to: iso(9) } });
    expect(effectiveLimit({ ...trial, plan: "both", stripe_subscription_id: "sub_1" }, CONFIG, T0)).toMatchObject({ kind: "plan", limit: 150 });
    // a trial that is over stops nothing: a due scheduled set still applies
    expect(effectiveLimit({ ...trial, trial_ends_at: iso(-1) }, CONFIG, T0)).toMatchObject({ kind: "none", limit: null });
  });
});

describe("the agent with BILLING_ENABLED off", () => {
  it("behaves as before: no gate, no trial limit", async () => {
    // a paused Social venue with 25 changes this trial, but billing is off (no billingConfig on the store)
    const s = await setup({ config: null, venue: { plan: "social", billing_status: "paused", trial_started_at: iso(-5), trial_ends_at: iso(-1) }, seed: async ({ store, venue }) => { for (let i = 0; i < 25; i++) await applied(store, venue.id, iso(-3)); } });
    expect((await s.propose()).status).toBe("proposed");
    s.deps.store.billingConfig = { ...CONFIG, billingEnabled: false };
    const again = await setup({ config: { billingEnabled: false }, venue: { plan: "social", billing_status: "paused" } });
    expect((await again.propose()).status).toBe("proposed");
  });
});

describe("plan gating in the agent", () => {
  it("a trialing Admin plan proposes site changes; a social post is refused with the not-in-plan line and the upgrade link", async () => {
    const s = await setup({ venue: { ...TRIALING, plan: "admin" } });
    expect((await s.propose()).status).toBe("proposed");
    // the social tool: connected networks are declared on the deps; the gate runs before anything is read
    const tools = makeTools({ ...s.deps, social: { facebook: true, instagram: false }, source: "photo" });
    const photo = await s.store.saveMedia(s.venue.id, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg");
    const getMedia = s.store.getMedia.bind(s.store);
    s.store.getMedia = async (id: string) => {
      const m = await getMedia(id);
      return m && { ...m, public_url: m.public_url.replace("memory://media/", "https://media.example/storage/") };
    };
    const r = await call(tools, "social_post", { summary_bg: "Пост", summary_en: "Post", media_id: photo.id, caption: "Здравейте", targets: ["facebook_post"] });
    expect(r.error).toContain("(not_in_plan)");
    expect(r.error).toContain(copy("bg").notInPlanRefusal("social", "Admin", LINK));
    expect(r.error).toContain(LINK);
    expect(r.error).toContain("nothing was proposed");
  });

  it("a Social plan refuses site-change proposals as not in plan", async () => {
    const s = await setup({ venue: { plan: "social", billing_status: "active" } });
    const r = await s.propose();
    expect(r.error).toContain(copy("bg").notInPlanRefusal("site", "Социални мрежи", LINK));
    expect(await s.sets()).toHaveLength(0);
  });

  it("propose_boost and the comment tools need their feature too", async () => {
    const s = await setup({ venue: { plan: "admin", billing_status: "active" } });
    const tools = makeTools({ ...s.deps, social: { facebook: true, instagram: true } });
    const boost = await call(tools, "propose_boost", {});
    expect(boost.error).toContain("(not_in_plan)");
    const replies = await call(tools, "reply_to_comments", { replies: [{ comment_id: "c1", reply_text: "Благодаря" }] });
    expect(replies.error).toContain("(not_in_plan)");
    const mode = await call(tools, "set_comment_mode", { mode: "off" });
    expect(mode.error).toContain("(not_in_plan)");
  });

  it("an English owner gets the English line", async () => {
    const s = await setup({ venue: { plan: "social", billing_status: "active" } });
    await s.store.upsertMember({ venue_id: s.venue.id, chat_ref: "tg:1003", role: "owner", lang: "en" });
    const member = (await s.store.findMember("tg:1003"))!;
    const tools = makeTools({ ...s.deps, member, chatRef: "tg:1003" });
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: s.items.Cappuccino.id, price_eur: 3.3 }] });
    expect(r.error).toContain(copy("en").notInPlanRefusal("site", "Social media", LINK));
  });
});

describe("paused venues", () => {
  it("refuse new proposals with the trial-ended line and the /billing/<slug> link, and create nothing", async () => {
    const s = await setup({ venue: { billing_status: "paused", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const r = await s.propose();
    expect(r.error).toContain("(paused)");
    expect(r.error).toContain(copy("bg").trialEndedRefusal(LINK));
    expect(await s.sets()).toHaveLength(0);
  });

  it("a paused paid plan (or a canceled one) gets the plan-paused line", async () => {
    const s = await setup({ venue: { plan: "both", billing_status: "paused", stripe_subscription_id: "sub_1" } });
    expect((await s.propose()).error).toContain(copy("bg").planPausedRefusal(LINK));
    const c = await setup({ venue: { plan: "both", billing_status: "canceled" } });
    expect((await c.propose()).error).toContain(copy("bg").planPausedRefusal(LINK));
  });

  it("undo still works", async () => {
    const s = await setup({ venue: { plan: "both", billing_status: "active" } });
    const done = await s.propose();
    await s.store.applyChangeSet(done.change_set_id as string, T0.toISOString());
    await s.store.updateVenue(s.venue.id, { billing_status: "paused" });
    const undone = await call(s.tools, "undo", { change_set_id: "last" });
    expect(undone.status).toBe("proposed");
  });

  it("a scheduled set due now is still applied by the tick, and an auto sold-out revert still runs; nothing goes offline", async () => {
    const s = await setup({ config: { billingEnabled: true }, venue: { billing_status: "paused", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const site = await s.store.getSite(s.venue.id);
    const due = await s.store.createChangeSet({ venue_id: s.venue.id, chat_ref: "tg:1001", summary_bg: "Капучино", summary_en: "Cappuccino", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: iso(0, new Date(T0.getTime() - 3_600_000)), changes: planChanges(site, [{ op: "set_price", item_id: s.items.Cappuccino.id, price_eur: 3.4 }], { newId: () => crypto.randomUUID(), now: T0.toISOString() }) });
    const banitsa = s.store.sites.get(s.venue.id)!.items.find((i) => i.id === s.items["Cheese banitsa"].id)!;
    banitsa.sold_out_until = iso(0, new Date(T0.getTime() - 60_000));
    const billing: TrialBilling = { config: CONFIG, ownerEmails: async () => [], sendEmail: async () => ({ status: "disabled" }) };
    const r = await runTick({ store: s.store, messenger: s.messenger, now: T0, billing });
    expect(r.applied).toEqual([due.id]);
    expect(r.auto).toHaveLength(1);
    expect((await s.store.getSite(s.venue.id)).items.find((i) => i.id === s.items.Cappuccino.id)?.price_eur).toBe(3.4);
    expect((await s.store.getVenue(s.venue.id)).status).toBe("live"); // the venue itself is untouched
  });
});

describe("past_due in the agent", () => {
  it("works for 7 days, then is refused like paused", async () => {
    const s = await setup({ venue: { plan: "both", billing_status: "past_due", past_due_since: iso(-6) } });
    expect((await s.propose()).status).toBe("proposed");
    await s.store.updateVenue(s.venue.id, { past_due_since: iso(-8) });
    const r = await call(s.tools, "propose_changes", { summary_bg: "Капучино", summary_en: "Cappuccino", changes: [{ op: "set_price", item_id: s.items.Cappuccino.id, price_eur: 3.3 }] });
    expect(r.error).toContain("(past_due_expired)");
    expect(r.error).toContain(copy("bg").pastDueRefusal(LINK));
  });
});

describe("TRIAL_REQUIRES_CARD", () => {
  it("refuses proposals in a free trial with the add-a-card line; the card-trial subscription goes ahead", async () => {
    const s = await setup({ config: { trialRequiresCard: true }, venue: TRIALING });
    const r = await s.propose();
    expect(r.error).toContain("(card_required)");
    expect(r.error).toContain(copy("bg").cardRequiredRefusal(LINK));
    expect(copy("en").cardRequiredRefusal(LINK)).toMatch(/^Add a card to start your trial/);
    await s.store.updateVenue(s.venue.id, { plan: "both", stripe_subscription_id: "sub_1" });
    expect((await s.propose()).status).toBe("proposed");
  });
});

describe("plan limits when change_limit is null", () => {
  it("an Admin venue gets 40 a month: the 41st proposal is refused with the monthly line", async () => {
    const s = await setup({ venue: { plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" }, seed: async ({ store, venue }) => { for (let i = 0; i < 40; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect(await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).toMatchObject({ used: 40, limit: 40, reached: true, kind: "plan" });
    const r = await s.propose();
    expect(r.error).toContain("(40/40 this month)");
    expect(r.error).toContain(copy("bg").limitReached(40, 40, "2026-11-01"));
  });

  it("a Both venue gets 150; a Social venue has no site-change limit", async () => {
    const s = await setup({ venue: { plan: "both", billing_status: "active", stripe_subscription_id: "sub_1" } });
    expect(await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).toMatchObject({ limit: 150, kind: "plan" });
    const social = await setup({ venue: { plan: "social", billing_status: "active", stripe_subscription_id: "sub_1" } });
    expect(await changeUsage(social.store, await social.store.getVenue(social.venue.id), T0)).toMatchObject({ limit: null, kind: "none" });
  });

  it("an explicit change_limit still overrides the plan", async () => {
    const s = await setup({ venue: { plan: "both", billing_status: "active" }, seed: async ({ store, venue }) => { for (let i = 0; i < 2; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    await s.store.setChangeLimit(s.venue.id, 2);
    expect((await s.propose()).error).toContain(copy("bg").limitReached(2, 2, "2026-11-01"));
  });
});

describe("the free trial's change limit", () => {
  // The trial started on 28 September, so it spans two calendar months: 10 changes in September, 10 in October.
  const trial: VenuePatch = { billing_status: "trialing", trial_started_at: "2026-09-28T08:00:00.000Z", trial_ends_at: "2026-10-26T08:00:00.000Z" };
  const seed20 = async ({ store, venue }: Awaited<ReturnType<typeof makeDemo>>) => {
    for (let i = 0; i < 10; i++) await applied(store, venue.id, "2026-09-29T10:00:00.000Z");
    for (let i = 0; i < 10; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z");
  };

  it("counts from trial_started_at, not the calendar month", async () => {
    const s = await setup({ venue: trial, seed: seed20 });
    expect(await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).toMatchObject({ used: 20, limit: 20, reached: true, kind: "trial", resets_on: "2026-10-26" });
    // the calendar month alone would say 10
    expect(await s.store.countAppliedChangeSets(s.venue.id, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z")).toBe(10);
  });

  it("never counts undo, auto or comment sets (the same rules as the monthly limit)", async () => {
    const s = await setup({ venue: trial, seed: async ({ store, venue }) => { await applied(store, venue.id, "2026-10-05T10:00:00.000Z", "undo"); await applied(store, venue.id, "2026-10-05T10:00:00.000Z", "auto"); await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect((await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).used).toBe(1);
  });

  it("the 21st proposal is refused with the choose-a-plan line; undo still works", async () => {
    const s = await setup({ venue: trial, seed: seed20 });
    const r = await s.propose();
    const line = copy("bg").trialLimitReached(20, LINK);
    expect(r.error).toContain("Trial change limit reached (20/20");
    expect(r.error).toContain(line);
    expect(line).toContain("Отмяната работи");
    expect(copy("en").trialLimitReached(20, LINK)).toBe(`That was your 20th trial change, so new changes are paused until you choose a plan. Undo still works: ${LINK}`);
    expect(await s.sets()).toHaveLength(20);
    const last = (await s.sets()).find((cs) => cs.status === "applied")!;
    await s.store.updateChangeSet(last.id, { applied_at: "2026-10-05T10:00:00.000Z" });
    const undone = await call(s.tools, "undo", { change_set_id: last.id });
    expect(undone.status).toBe("proposed");
  });

  it("the 20th proposal is allowed (19 used)", async () => {
    const s = await setup({ venue: trial, seed: async ({ store, venue }) => { for (let i = 0; i < 19; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect((await s.propose()).status).toBe("proposed");
  });

  it("an owner's ✅ on a proposal made earlier is stopped at the limit with the same line", async () => {
    const s = await setup({ venue: trial, seed: async ({ store, venue }) => { for (let i = 0; i < 19; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    const a = await s.propose(3.2);
    await applied(s.store, s.venue.id, "2026-10-06T10:00:00.000Z"); // another change lands meanwhile: 20 of 20
    const r = await handleDecision({ store: s.store, messenger: s.messenger, now: () => T0 }, "tg:1001", "apply", a.change_set_id as string);
    expect(r.toast).toBe(copy("bg").trialLimitReached(20, LINK));
    expect((await s.store.getChangeSet(a.change_set_id as string)).status).toBe("cancelled");
  });

  it("shows the trial usage line after a change", async () => {
    const s = await setup({ venue: trial, seed: async ({ store, venue }) => { for (let i = 0; i < 6; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect(await usageLine(s.store, s.venue.id, T0, "bg")).toBe("Промени в пробния период: 6/20");
    expect(await usageLine(s.store, s.venue.id, T0, "en")).toBe("Changes in your trial: 6/20");
  });

  it("paying during the trial (checkout.session.completed) switches to the plan's monthly limit at once", async () => {
    const s = await setup({ venue: { ...trial, stripe_customer_id: "cus_1" }, seed: seed20 });
    expect((await s.propose()).error).toContain("Trial change limit reached");
    const subscription: StripeSubscription = { id: "sub_1", status: "trialing", customer: "cus_1", metadata: {}, items: { data: [{ price: { id: "price_both" } }] } };
    const stripe = { subscriptions: { retrieve: async () => subscription } } as unknown as StripeLike;
    const session = { id: "cs_1", mode: "subscription", customer: "cus_1", subscription: "sub_1", client_reference_id: s.venue.id, payment_status: "paid", metadata: { venue_id: s.venue.id, plan: "both", setup_fee: "0" } };
    const outcome = await applyStripeEvent(s.store, { id: "evt_1", type: "checkout.session.completed", data: { object: session } }, { config: { stripePrices: { admin: "price_admin", social: "price_social", both: "price_both", websiteSetup: "price_setup" } }, stripe, now: () => T0 });
    expect(outcome).toBe("applied");
    const venue = await s.store.getVenue(s.venue.id);
    expect(venue).toMatchObject({ plan: "both", stripe_subscription_id: "sub_1" });
    // 20 changes this trial are 20 of the October window's... the plan counts the calendar month: 10 so far
    expect(await changeUsage(s.store, venue, T0)).toMatchObject({ used: 10, limit: 150, kind: "plan" });
    expect((await s.propose()).status).toBe("proposed");
  });

  it("an explicit change_limit overrides the trial limit", async () => {
    const s = await setup({ venue: trial, seed: seed20 });
    await s.store.setChangeLimit(s.venue.id, 100);
    expect(await changeUsage(s.store, await s.store.getVenue(s.venue.id), T0)).toMatchObject({ kind: "override", limit: 100, used: 10 });
    expect((await s.propose()).status).toBe("proposed");
  });

  it("with BILLING_ENABLED off there is no trial limit", async () => {
    const s = await setup({ config: null, venue: trial, seed: seed20 });
    expect((await s.propose()).status).toBe("proposed");
  });
});

describe("the trial end in the tick", () => {
  const deps = (s: Awaited<ReturnType<typeof setup>>, sent: unknown[] = []): TrialBilling => ({ config: CONFIG, ownerEmails: async () => ["owner@example.com"], sendEmail: async (m) => (sent.push(m), { status: "sent" }) });

  it("flips trialing to paused only when trial_ends_at has passed and there is no subscription; idempotently", async () => {
    const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const b = { store: s.store, messenger: s.messenger, billing: deps(s) };
    expect(await pauseExpiredTrials(b, T0)).toEqual([s.venue.id]);
    expect((await s.store.getVenue(s.venue.id)).billing_status).toBe("paused");
    expect(await pauseExpiredTrials(b, T0)).toEqual([]);
    expect((await s.store.getVenue(s.venue.id)).billing_status).toBe("paused");
  });

  it("leaves a running trial, a Stripe trial subscription and an active venue alone", async () => {
    const running = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-5), trial_ends_at: iso(9) } });
    expect(await pauseExpiredTrials({ store: running.store, messenger: null, billing: deps(running) }, T0)).toEqual([]);
    const stripeTrial = await setup({ venue: { billing_status: "trialing", plan: "both", stripe_subscription_id: "sub_1", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    expect(await pauseExpiredTrials({ store: stripeTrial.store, messenger: null, billing: deps(stripeTrial) }, T0)).toEqual([]);
    expect((await stripeTrial.store.getVenue(stripeTrial.venue.id)).billing_status).toBe("trialing");
    const active = await setup({ venue: { billing_status: "active", plan: "both", trial_ends_at: iso(-1) } });
    expect(await pauseExpiredTrials({ store: active.store, messenger: null, billing: deps(active) }, T0)).toEqual([]);
  });

  it("does nothing while billing is off (no billing deps, or billingEnabled false)", async () => {
    const s = await setup({ config: null, venue: { billing_status: "trialing", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const r = await runTick({ store: s.store, messenger: s.messenger, now: T0 });
    expect(r.trials_paused).toBeUndefined();
    expect((await s.store.getVenue(s.venue.id)).billing_status).toBe("trialing");
    expect(await pauseExpiredTrials({ store: s.store, messenger: null, billing: { ...deps(s), config: { ...CONFIG, billingEnabled: false } } }, T0)).toEqual([]);
    expect(s.messenger.sent).toEqual([]);
  });

  it("the per-venue tick (scoped to a venue) also ends its trial", async () => {
    const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const r = await runTick({ store: s.store, messenger: s.messenger, now: T0, venueId: s.venue.id, billing: deps(s) });
    expect(r.trials_paused).toEqual([s.venue.id]);
  });

  it("the cron endpoint passes the billing deps to the tick", async () => {
    const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-15), trial_ends_at: iso(-1) } });
    const res = await handleTickRequest(new Request("https://x.test/api/tick", { headers: { "x-tick-secret": "sek" } }), { config: { tickSecret: "sek" }, store: s.store, messenger: s.messenger, billing: deps(s) }, T0);
    expect(((await res.json()) as { trials_paused: string[] }).trials_paused).toEqual([s.venue.id]);
  });
});

describe("trial reminders", () => {
  async function remind(venue: VenuePatch, seed?: (d: Awaited<ReturnType<typeof makeDemo>>) => Promise<void>) {
    const s = await setup({ venue, seed });
    const mails: { to: string; subject: string; text: string; html: string }[] = [];
    const billing: TrialBilling = { config: CONFIG, ownerEmails: async () => ["owner@example.com"], sendEmail: async (m) => (mails.push(m), { status: "sent" }) };
    const tick = (at: Date) => runTick({ store: s.store, messenger: s.messenger, now: at, billing });
    const texts = () => s.messenger.sent.map((m) => m.text);
    return { ...s, mails, billing, tick, texts };
  }

  it("fires once at 3 days left: a chat message to the owner and an email; a second tick sends nothing", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) });
    const first = await r.tick(T0);
    expect(first.trial_reminders).toBe(1);
    expect(r.messenger.sent).toEqual([expect.objectContaining({ chatRef: "tg:1001", proactive: true, text: copy("bg").trialEndsSoon(3, "22 октомври", LINK) })]);
    expect(r.messenger.sent.some((m) => m.chatRef === "tg:1002")).toBe(false); // staff are not told
    expect(r.mails).toHaveLength(1);
    expect(r.mails[0]).toMatchObject({ to: "owner@example.com", subject: "Пробният ви период в Claudia свършва скоро" });
    expect(r.mails[0].text).toContain(LINK);
    expect(r.mails[0].html).toContain(`<a href="${LINK}">`);
    expect((await r.store.getVenue(r.venue.id)).trial_reminder_sent).toBe("soon");
    const second = await r.tick(new Date(T0.getTime() + 3_600_000));
    expect(second.trial_reminders).toBe(0);
    expect(r.messenger.sent).toHaveLength(1);
    expect(r.mails).toHaveLength(1);
  });

  it("does not fire early (10 days left, few changes used)", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-4), trial_ends_at: iso(10) });
    expect((await r.tick(T0)).trial_reminders).toBe(0);
    expect(r.messenger.sent).toEqual([]);
  });

  it("fires 'ended' once at the end, pausing the venue; a second tick sends nothing", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-14), trial_ends_at: iso(0, new Date(T0.getTime() - 60_000)) });
    const first = await r.tick(T0);
    expect(first.trials_paused).toEqual([r.venue.id]);
    expect(first.trial_reminders).toBe(1);
    expect(r.messenger.sent.map((m) => m.text)).toEqual([copy("bg").trialEnded(LINK)]);
    expect(r.mails[0].subject).toBe("Пробният ви период в Claudia приключи");
    expect((await r.store.getVenue(r.venue.id))).toMatchObject({ billing_status: "paused", trial_reminder_sent: "ended" });
    expect((await r.tick(new Date(T0.getTime() + 3_600_000))).trial_reminders).toBe(0);
    expect(r.messenger.sent).toHaveLength(1);
  });

  it("'soon' then 'ended' are two separate messages, each once", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) });
    await r.tick(T0);
    await r.tick(new Date(T0.getTime() + 4 * DAY));
    expect(r.texts()).toEqual([copy("bg").trialEndsSoon(3, "22 октомври", LINK), copy("bg").trialEnded(LINK)]);
    await r.tick(new Date(T0.getTime() + 5 * DAY));
    expect(r.texts()).toHaveLength(2);
    expect(r.mails).toHaveLength(2);
  });

  it("fires 'soon' once when 15 of the 20 trial changes are used, even with 10 days left", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-4), trial_ends_at: iso(10) }, async ({ store, venue }) => {
      for (let i = 0; i < 14; i++) await applied(store, venue.id, iso(-2));
    });
    expect((await r.tick(T0)).trial_reminders).toBe(0);
    await applied(r.store, r.venue.id, iso(-1));
    expect((await r.tick(T0)).trial_reminders).toBe(1);
    expect(r.texts()).toEqual([copy("bg").trialChangesSoon(15, 20, LINK)]);
    expect((await r.tick(T0)).trial_reminders).toBe(0);
  });

  it("fires 'ended' when the 20th change is used (with the 20th-change line), and only once", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-4), trial_ends_at: iso(10) }, async ({ store, venue }) => {
      for (let i = 0; i < 20; i++) await applied(store, venue.id, iso(-2));
    });
    expect((await r.tick(T0)).trial_reminders).toBe(1);
    expect(r.texts()).toEqual([copy("bg").trialLimitReached(20, LINK)]);
    expect((await r.store.getVenue(r.venue.id)).trial_reminder_sent).toBe("ended");
    expect((await r.tick(new Date(T0.getTime() + DAY))).trial_reminders).toBe(0);
    expect(r.texts()).toHaveLength(1);
  });

  it("two ticks at the same moment send one reminder (the marker is a compare-and-set)", async () => {
    const r = await remind({ billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) });
    const b = { store: r.store, messenger: r.messenger, billing: r.billing };
    const counts = await Promise.all([sendTrialReminders(b, T0), sendTrialReminders(b, T0), sendTrialReminders(b, T0)]);
    expect(counts.reduce((a, c) => a + c, 0)).toBe(1);
    expect(r.messenger.sent).toHaveLength(1);
    expect(r.mails).toHaveLength(1);
  });

  it("uses the owner's chat language (English) and skips venues with a subscription, no owner to tell, or billing off", async () => {
    const en = await remind({ billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) });
    await en.store.upsertMember({ venue_id: en.venue.id, chat_ref: "tg:1003", role: "owner", lang: "en" });
    await en.tick(T0);
    expect(en.messenger.sent.find((m) => m.chatRef === "tg:1003")?.text).toBe(copy("en").trialEndsSoon(3, "22 October", LINK));
    const subscribed = await remind({ billing_status: "trialing", plan: "both", stripe_subscription_id: "sub_1", trial_started_at: iso(-11), trial_ends_at: iso(3) });
    expect((await subscribed.tick(T0)).trial_reminders).toBe(0);
    const off = await setup({ config: null, venue: { billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) } });
    const billingOff: TrialBilling = { config: { ...CONFIG, billingEnabled: false }, ownerEmails: async () => ["o@x.com"], sendEmail: async () => ({ status: "sent" }) };
    expect(await sendTrialReminders({ store: off.store, messenger: off.messenger, billing: billingOff }, T0)).toBe(0);
  });

  it("a venue with no owner chat and no account email is not marked, so the next tick tries again", async () => {
    const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) } });
    s.store.members.delete("tg:1001");
    const none: TrialBilling = { config: CONFIG, ownerEmails: async () => [], sendEmail: async () => ({ status: "disabled" }) };
    expect(await sendTrialReminders({ store: s.store, messenger: s.messenger, billing: none }, T0)).toBe(0);
    expect((await s.store.getVenue(s.venue.id)).trial_reminder_sent).toBeNull();
    const withEmail: TrialBilling = { ...none, ownerEmails: async () => ["owner@example.com"] };
    expect(await sendTrialReminders({ store: s.store, messenger: s.messenger, billing: withEmail }, T0)).toBe(1);
  });

  it("a failing email or chat never stops the others", async () => {
    const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) } });
    const failing: TrialBilling = { config: CONFIG, ownerEmails: async () => ["a@x.com", "b@x.com"], sendEmail: async () => ({ status: "failed", error: "Resend 500" }) };
    expect(await sendTrialReminders({ store: s.store, messenger: s.messenger, billing: failing }, T0)).toBe(1);
    expect(s.messenger.sent).toHaveLength(1);
  });
});

describe("owner emails", () => {
  it("lists the account owners' emails from venue_users and auth.users, once each", async () => {
    const calls: string[] = [];
    const db = {
      from: (table: string) => {
        calls.push(table);
        const q = { select: () => q, eq: (c: string, v: string) => { calls.push(`${c}=${v}`); return q; }, then: (ok: (r: unknown) => void) => ok({ data: [{ user_id: "u1" }, { user_id: "u2" }, { user_id: "u3" }], error: null }) };
        return q;
      },
      auth: { admin: { getUserById: async (id: string) => (id === "u3" ? { data: { user: null }, error: { message: "nope" } } : { data: { user: { email: id === "u1" ? "Owner@Example.com" : "owner@example.com" } }, error: null }) } },
    };
    expect(await ownerEmailsFrom(db as never)("venue-1")).toEqual(["owner@example.com"]);
    expect(calls).toEqual(["venue_users", "venue_id=venue-1", "role=owner"]);
  });
});

describe("the dashboard", () => {
  it("shows the trial counter and locks the features a plan does not have", async () => {
    const { adminOverview } = await import("@/src/server/admin");
    const s = await setup({ venue: { ...TRIALING, trial_started_at: "2026-10-01T08:00:00.000Z" }, seed: async ({ store, venue }) => { for (let i = 0; i < 6; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    const venue = await s.store.getVenue(s.venue.id);
    const o = await adminOverview(s.store, venue, T0, BASE, { billing: true });
    expect(o.billing).toMatchObject({ trial_changes: { used: 6, limit: 20 }, trial_days_left: 9, locked: [] });
    expect(o.changes_this_month).toEqual({ used: 6, limit: 20, trial: true });
    const admin = await s.store.updateVenue(s.venue.id, { plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" });
    const o2 = await adminOverview(s.store, admin, T0, BASE, { billing: true });
    expect(o2.billing).toMatchObject({ trial_changes: null, locked: ["social", "comments", "boost"] });
    expect(o2.changes_this_month).toEqual({ used: 6, limit: 40 });
    const paused = await s.store.updateVenue(s.venue.id, { billing_status: "paused" });
    expect((await adminOverview(s.store, paused, T0, BASE, { billing: true })).billing).toMatchObject({ locked: [] });
  });

  it("counts the applied changes once for the whole overview", async () => {
    const { adminOverview } = await import("@/src/server/admin");
    const s = await setup({ venue: TRIALING });
    const count = vi.spyOn(s.store, "countAppliedChangeSets");
    await adminOverview(s.store, await s.store.getVenue(s.venue.id), T0, BASE, { billing: true });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("billingUrl builds the /billing/<slug> link on the public base", () => {
    expect(billingUrl({ publicBaseUrl: "https://getclaudia.app/" }, "café bar")).toBe("https://getclaudia.app/billing/caf%C3%A9%20bar");
  });
});

describe("fix round 1", () => {
  const SUB: VenuePatch = { stripe_subscription_id: "sub_1" };

  it("a grandfathered venue (active, no subscription) is unlimited with billing on; a subscribed Both venue gets 150", async () => {
    const old = await setup({ venue: { plan: "both", billing_status: "active" }, seed: async ({ store, venue }) => { for (let i = 0; i < 155; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect(await changeUsage(old.store, await old.store.getVenue(old.venue.id), T0)).toMatchObject({ used: 155, limit: null, kind: "none", reached: false });
    expect((await old.propose()).status).toBe("proposed");
    const paying = await setup({ venue: { plan: "both", billing_status: "active", ...SUB }, seed: async ({ store, venue }) => { for (let i = 0; i < 150; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
    expect(await changeUsage(paying.store, await paying.store.getVenue(paying.venue.id), T0)).toMatchObject({ used: 150, limit: 150, reached: true, kind: "plan" });
    expect((await paying.propose()).error).toContain(copy("bg").limitReached(150, 150, "2026-11-01"));
    // an explicit change_limit still overrides everything
    await old.store.setChangeLimit(old.venue.id, 10);
    expect((await old.propose()).error).toContain("Monthly change limit reached");
  });

  describe("marking an item sold out is always allowed", () => {
    const soldOut = (s: Awaited<ReturnType<typeof setup>>) => call(s.tools, "propose_changes", { summary_bg: "Свърши", summary_en: "Sold out", changes: [{ op: "set_sold_out", item_id: s.items.Cappuccino.id, until: null }] });
    const states: [string, VenuePatch, Partial<BillingConfig>][] = [
      ["paused", { billing_status: "paused", trial_started_at: iso(-15), trial_ends_at: iso(-1) }, {}],
      ["past_due_expired", { plan: "both", billing_status: "past_due", past_due_since: iso(-9), ...SUB }, {}],
      ["card_required", TRIALING, { trialRequiresCard: true }],
      ["not in plan (Social)", { plan: "social", billing_status: "active", ...SUB }, {}],
    ];
    for (const [name, venue, config] of states) {
      it(`while ${name}`, async () => {
        const s = await setup({ venue, config });
        expect((await s.propose()).error).toBeTruthy(); // an ordinary change is refused
        const r = await soldOut(s);
        expect(r.error).toBeUndefined();
        expect(r.status).toBe("applied");
      });
    }
    it("while the trial limit is reached (20 of 20), and the apply-time stop lets it through", async () => {
      const s = await setup({ venue: { billing_status: "trialing", trial_started_at: "2026-10-05T08:00:00.000Z", trial_ends_at: iso(9) }, seed: async ({ store, venue }) => { for (let i = 0; i < 20; i++) await applied(store, venue.id, "2026-10-06T10:00:00.000Z"); } });
        expect((await s.propose()).error).toContain("Trial change limit reached");
      const r = await soldOut(s);
      expect(r.status).toBe("applied");
    });
    it("but a change_limit set on the venue itself still stops it", async () => {
      const s = await setup({ venue: { plan: "both", billing_status: "active", ...SUB }, seed: async ({ store, venue }) => { for (let i = 0; i < 2; i++) await applied(store, venue.id, "2026-10-05T10:00:00.000Z"); } });
      await s.store.setChangeLimit(s.venue.id, 2);
      expect((await soldOut(s)).error).toContain("Monthly change limit reached");
    });
  });

  it("the trial-ended line needs a trial end and no subscription; otherwise the paused line", async () => {
    const noTrial = await setup({ venue: { plan: "both", billing_status: "paused" } });
    expect((await noTrial.propose()).error).toContain(copy("bg").planPausedRefusal(LINK));
    const trial = await setup({ venue: { billing_status: "paused", trial_ends_at: iso(-1) } });
    expect((await trial.propose()).error).toContain(copy("bg").trialEndedRefusal(LINK));
  });

  describe("reminders follow the same limit as the agent", () => {
    it("with change_limit 100 there is no 20th-change message at 20, and the end-of-trial message still goes out", async () => {
      const mails: unknown[] = [];
      const s = await setup({ venue: { billing_status: "trialing", trial_started_at: iso(-4), trial_ends_at: iso(10) }, seed: async ({ store, venue }) => { for (let i = 0; i < 20; i++) await applied(store, venue.id, iso(-2)); } });
      await s.store.setChangeLimit(s.venue.id, 100);
      const billing: TrialBilling = { config: CONFIG, ownerEmails: async () => ["owner@example.com"], sendEmail: async (m) => (mails.push(m), { status: "sent" }) };
      expect((await runTick({ store: s.store, messenger: s.messenger, now: T0, billing })).trial_reminders).toBe(0); // 20 used (and 15): nothing
      expect(s.messenger.sent).toEqual([]);
      const end = new Date(T0.getTime() + 11 * DAY);
      const r = await runTick({ store: s.store, messenger: s.messenger, now: end, billing });
      expect(r.trial_reminders).toBe(1);
      expect(s.messenger.sent.map((m) => m.text)).toEqual([copy("bg").trialEnded(LINK)]);
    });
  });

  describe("undelivered reminders", () => {
    const trialing: VenuePatch = { billing_status: "trialing", trial_started_at: iso(-11), trial_ends_at: iso(3) };
    it("logs counts and statuses, never an address", async () => {
      const s = await setup({ venue: trialing });
      s.messenger.send = async () => { throw new Error("chat down for owner@example.com"); };
      const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const billing: TrialBilling = { config: CONFIG, ownerEmails: async () => ["owner@example.com"], sendEmail: async () => ({ status: "failed", error: "Resend 422: owner@example.com is invalid" }) };
      expect(await sendTrialReminders({ store: s.store, messenger: s.messenger, billing }, T0)).toBe(1);
      const text = logged.mock.calls.flat().map(String).join("\n");
      logged.mockRestore();
      expect(text).toContain("chats sent 0, failed 1");
      expect(text).toContain("emails sent 0, disabled 0, failed 1");
      expect(text).toContain(s.venue.id);
      expect(text).not.toContain("owner@example.com");
      expect(text).not.toContain("Resend 422");
    });
    it("does not claim when nothing can be delivered (no messenger, mail disabled), so a later tick retries", async () => {
      const s = await setup({ venue: trialing });
      const off: TrialBilling = { config: CONFIG, emailEnabled: false, ownerEmails: async () => ["owner@example.com"], sendEmail: async () => ({ status: "disabled" }) };
      expect(await sendTrialReminders({ store: s.store, messenger: null, billing: off }, T0)).toBe(0);
      expect((await s.store.getVenue(s.venue.id)).trial_reminder_sent).toBeNull();
      // a messenger appears: delivered
      expect(await sendTrialReminders({ store: s.store, messenger: s.messenger, billing: off }, T0)).toBe(1);
      expect(s.messenger.sent).toHaveLength(1);
    });
  });

  it("an owner whose account cannot be read is skipped and logged by venue id; the others still count", async () => {
    const db = {
      from: () => { const q = { select: () => q, eq: () => q, then: (ok: (r: unknown) => void) => ok({ data: [{ user_id: "u1" }, { user_id: "u2" }], error: null }) }; return q; },
      auth: { admin: { getUserById: async (id: string) => { if (id === "u1") throw new Error("boom for a@x.com"); return { data: { user: { email: "b@x.com" } }, error: null }; } } },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await ownerEmailsFrom(db as never)("venue-9")).toEqual(["b@x.com"]);
    const text = logged.mock.calls.flat().map(String).join("\n");
    logged.mockRestore();
    expect(text).toContain("venue-9");
    expect(text).not.toContain("a@x.com");
  });

  describe("comment polling and drafting need the plan to include comments", () => {
    async function commentsTick(venue: VenuePatch, billingOn = true) {
      const v = await connectedVenue();
      await v.store.updateVenue(v.venue.id, venue);
      const { igMediaId } = await v.publishPost(["instagram_post"]);
      v.meta.addInstagramComment(igMediaId!, { text: "Супер!", from_id: "1784", username: "maria.k", created: commentAt(-COMMENT_MIN) });
      const drafts: string[] = [];
      const draft = async (ctx: { comment: { text: string } }) => (drafts.push(ctx.comment.text), { reply: "Благодарим!", kind: "praise" as const, fallback: false });
      const billing: TrialBilling | null = billingOn ? { config: CONFIG, ownerEmails: async () => [], sendEmail: async () => ({ status: "disabled" }) } : null;
      const r = await runTick({ store: v.store, messenger: v.messenger, now: COMMENT_T0, sync: v.d, comments: { draft: draft as never }, billing });
      return { r, drafts };
    }
    it("an Admin plan: nothing is read or drafted", async () => {
      const { r, drafts } = await commentsTick({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" });
      expect(r.comments_found).toBe(0);
      expect(r.comments_proposed).toBe(0);
      expect(drafts).toEqual([]);
    });
    it("a Social or Both plan, and a free trial with no plan: read and proposed", async () => {
      for (const venue of [{ plan: "social" as const, billing_status: "active" as const, stripe_subscription_id: "sub_1" }, { plan: "both" as const, billing_status: "active" as const, stripe_subscription_id: "sub_1" }, { billing_status: "trialing" as const, trial_started_at: COMMENT_T0.toISOString(), trial_ends_at: commentAt(9 * DAY).toISOString() }]) {
        const { r, drafts } = await commentsTick(venue);
        expect(r.comments_found).toBe(1);
        expect(r.comments_proposed).toBe(1);
        expect(drafts).toEqual(["Супер!"]);
      }
    });
    it("a paused venue with the plan is not gated here; billing off gates nothing", async () => {
      expect((await commentsTick({ plan: "both", billing_status: "paused", stripe_subscription_id: "sub_1" })).r.comments_found).toBe(1);
      expect((await commentsTick({ plan: "admin", billing_status: "active", stripe_subscription_id: "sub_1" }, false)).r.comments_found).toBe(1);
    });
  });

  describe("Supabase conditional updates (fake client)", () => {
    function fakeStore() {
      const calls: [string, ...unknown[]][] = [];
      const q: Record<string, unknown> = {
        then: (ok: (r: unknown) => void) => ok({ data: [{ id: "x" }], error: null }),
      };
      for (const m of ["update", "eq", "is", "lte", "or", "select"]) q[m] = (...args: unknown[]) => (calls.push([m, ...args]), q);
      const store = new SupabaseStore("https://x.supabase.co", "service-key");
      (store as unknown as { db: unknown }).db = { from: (t: string) => (calls.push(["from", t]), q) };
      return { store, calls };
    }
    const id = "0b1f6c1e-6a5c-4b8e-9a56-1d2f3a4b5c6d";
    it("pauseExpiredTrial: only a trialing venue with no subscription whose trial is over", async () => {
      const { store, calls } = fakeStore();
      expect(await store.pauseExpiredTrial(id, "2026-11-02T09:00:00.000Z")).toBe(true);
      expect(calls).toEqual([["from", "venues"], ["update", { billing_status: "paused" }], ["eq", "id", id], ["eq", "billing_status", "trialing"], ["is", "stripe_subscription_id", null], ["lte", "trial_ends_at", "2026-11-02T09:00:00.000Z"], ["select", "id"]]);
    });
    it("claimTrialReminder: 'soon' only while no marker; 'ended' unless already ended (null counts)", async () => {
      const soon = fakeStore();
      expect(await soon.store.claimTrialReminder(id, "soon")).toBe(true);
      expect(soon.calls).toEqual([["from", "venues"], ["update", { trial_reminder_sent: "soon" }], ["eq", "id", id], ["is", "trial_reminder_sent", null], ["select", "id"]]);
      const ended = fakeStore();
      expect(await ended.store.claimTrialReminder(id, "ended")).toBe(true);
      expect(ended.calls).toEqual([["from", "venues"], ["update", { trial_reminder_sent: "ended" }], ["eq", "id", id], ["or", "trial_reminder_sent.is.null,trial_reminder_sent.neq.ended"], ["select", "id"]]);
    });
  });
});
