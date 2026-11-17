import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { googleAdapter } from "@/src/destinations/google";
import type { GooglePeriod, GoogleSpecialPeriod } from "@/src/destinations/google-api";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, MAX_ATTEMPTS, runPendingSyncs, syncLines, type SyncDeps } from "@/src/destinations/sync";
import { invertChanges, planChanges } from "@/src/domain/changes";
import type { Change, ChangeOp, WeekHours } from "@/src/domain/types";
import { FakeGoogle } from "./fake-google";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-11-13T09:00:00.000Z");
const WEEKDAYS_8_19: WeekHours = {
  mon: { open: "08:00", close: "19:00" }, tue: { open: "08:00", close: "19:00" }, wed: { open: "08:00", close: "19:00" },
  thu: { open: "08:00", close: "19:00" }, fri: { open: "08:00", close: "19:00" }, sat: null, sun: null,
};
const CLOSED_WEEK: WeekHours = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
const holiday = (date: string): ChangeOp => ({ op: "add_holiday", date, note_bg: "Почивка", note_en: "Day off" });
const dateKey = (p: GoogleSpecialPeriod) => `${p.startDate.year}-${String(p.startDate.month).padStart(2, "0")}-${String(p.startDate.day).padStart(2, "0")}`;
const DONE_EN = "Google listing: updated ✅";

async function connectedGoogle(opts: { now?: Date; destination?: boolean; config?: Record<string, unknown>; regularHours?: GooglePeriod[]; specialHours?: GoogleSpecialPeriod[]; hasGoogleUpdated?: boolean; before?: ChangeOp[] } = {}) {
  const demo = await makeDemo();
  const fake = new FakeGoogle();
  const account = fake.addAccount("Кафе Агала");
  const loc = fake.addLocation(account.name, { regularHours: opts.regularHours, specialHours: opts.specialHours, hasGoogleUpdated: opts.hasGoogleUpdated });
  let now = opts.now ?? T0;
  const logs: string[] = [];
  const d: SyncDeps = { store: demo.store, secretKey: KEY, fetch: fake.fetch, log: (s: string) => logs.push(s), google: { clientId: fake.clientId, clientSecret: fake.clientSecret } };
  const store = withDestinationSync(demo.store, d, () => now);
  const applyOps = async (ops: ChangeOp[]) => {
    const changes = planChanges(await store.getSite(demo.venue.id), ops, { newId: randomUUID, now: now.toISOString() });
    return applyChanges(changes);
  };
  const applyChanges = async (changes: Change[], extra: { undoes_id?: string; source?: "text" | "undo" } = {}) => {
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_ref: "tg:1001", summary_bg: "Промяна", summary_en: "Change", preview_bg: "p", preview_en: "p", source: extra.source ?? "text", status: "proposed", changes, undoes_id: extra.undoes_id ?? null });
    expect(await store.applyChangeSet(cs.id, now.toISOString())).toBe("applied");
    return store.getChangeSet(cs.id);
  };
  if (opts.before) await applyOps(opts.before);
  if (opts.destination !== false) {
    await demo.store.upsertDestination({
      venue_id: demo.venue.id,
      kind: "google",
      config: { account_name: account.name, location_name: loc.name, location_v4: loc.v4, title: "Test Cafe", address: "1 Main St", connected_at: T0.toISOString(), google_account_name: "Owner", ...opts.config },
      secrets: encryptSecrets({ refresh_token: account.refresh_token }, KEY),
    });
  }
  fake.calls.length = 0;
  const dest = async () => (await demo.store.listDestinations(demo.venue.id)).find((x) => x.kind === "google")!;
  const rows = async (csId: string) => (await store.listSyncs({ changeSetId: csId })).filter((r) => r.payload.kind === "google");
  const setNow = (t: Date) => void (now = t);
  return { ...demo, store, fake, account, loc, d, logs, applyOps, applyChanges, dest, rows, setNow };
}

const patches = (fake: FakeGoogle) => fake.calls.filter((c) => c.method === "PATCH");

describe("relevant()", () => {
  const hours: Change = { position: 0, op: "set_hours", entity: "venue", entity_id: "v", before: { hours: CLOSED_WEEK }, after: { hours: WEEKDAYS_8_19 } };
  const add: Change = { position: 0, op: "add_holiday", entity: "holiday", entity_id: "h", before: null, after: { id: "h", venue_id: "v", date: "2026-12-24", note_bg: "a", note_en: "a" } };
  const remove: Change = { position: 0, op: "remove_holiday", entity: "holiday", entity_id: "h", before: { id: "h", venue_id: "v", date: "2026-12-24", note_bg: "a", note_en: "a" }, after: null };
  it("takes hours and holiday rows and their undo rows", () => {
    for (const c of [hours, add, remove]) {
      expect(googleAdapter.relevant([c])).toHaveLength(1);
      expect(googleAdapter.relevant(invertChanges([c]))).toHaveLength(1);
    }
  });
  it("ignores text, menu and social rows", () => {
    const others: Change[] = [
      { position: 0, op: "set_text", entity: "venue", entity_id: "v", before: { tagline_bg: "a" }, after: { tagline_bg: "b" } },
      { position: 1, op: "update_item", entity: "item", entity_id: "i", before: { name_en: "a" }, after: { name_en: "b" } },
      { position: 2, op: "social_post", entity: "social_post", entity_id: "m", before: null, after: { media_id: "m", image_url: "x", caption: "c", targets: ["facebook_post"] } },
    ];
    expect(googleAdapter.relevant(others)).toEqual([]);
  });
});

describe("hours push", () => {
  it("set_hours: token, read, dry run, write, read-back; done line and config", async () => {
    const g = await connectedGoogle();
    const cs = await g.applyOps([{ op: "set_hours", hours: WEEKDAYS_8_19 }]);
    const calls = g.fake.calls;
    expect(calls.map((c) => c.method + " " + c.host)).toEqual([
      "POST oauth2.googleapis.com",
      "GET mybusinessbusinessinformation.googleapis.com",
      "PATCH mybusinessbusinessinformation.googleapis.com",
      "PATCH mybusinessbusinessinformation.googleapis.com",
      "GET mybusinessbusinessinformation.googleapis.com",
    ]);
    expect(calls[2].query).toEqual({ updateMask: "regularHours,specialHours", validateOnly: "true" });
    expect(calls[3].query).toEqual({ updateMask: "regularHours,specialHours" });
    expect(calls[1].query.readMask).toBe("regularHours,specialHours,metadata");
    expect(g.fake.location(g.loc.name).regularHours?.periods).toHaveLength(5);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "done", attempts: 1 });
    expect(await syncLines(g.store, cs.id, "en")).toEqual([DONE_EN]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: обновен ✅"]);
    const cfg = (await g.dest()).config;
    expect(cfg).toMatchObject({ hours_pushed: true, last_hours_push_at: T0.toISOString() });
  });

  it("the first push with only a holiday also sends the week's regular hours", async () => {
    const g = await connectedGoogle();
    await g.applyOps([holiday("2026-11-14")]);
    const body = patches(g.fake)[1].body as { regularHours: { periods: GooglePeriod[] }; specialHours: { specialHourPeriods: GoogleSpecialPeriod[] } };
    const site = await g.store.getSite(g.venue.id);
    expect(body.regularHours.periods).toHaveLength(Object.values(site.venue.hours).filter(Boolean).length);
    expect(body.regularHours.periods.length).toBeGreaterThan(0);
    expect(body.specialHours.specialHourPeriods).toEqual([{ startDate: { year: 2026, month: 11, day: 14 }, closed: true }]);
  });

  it("closed 24–26 December, then reopened on the 25th", async () => {
    const g = await connectedGoogle();
    await g.applyOps([holiday("2026-12-24"), holiday("2026-12-25"), holiday("2026-12-26")]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods?.map(dateKey)).toEqual(["2026-12-24", "2026-12-25", "2026-12-26"]);
    const h25 = (await g.store.getSite(g.venue.id)).holidays.find((h) => h.date === "2026-12-25")!;
    await g.applyOps([{ op: "remove_holiday", holiday_id: h25.id }]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods?.map(dateKey)).toEqual(["2026-12-24", "2026-12-26"]);
    expect((await g.dest()).config.special_dates_pushed).toEqual(["2026-12-24", "2026-12-26"]);
  });

  it("a holiday dated yesterday in the venue's zone is not sent", async () => {
    const g = await connectedGoogle();
    await g.applyOps([holiday("2026-11-12"), holiday("2026-11-20")]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods?.map(dateKey)).toEqual(["2026-11-20"]);
  });

  it("uses the venue's local date: 22:30 UTC on 13 Nov is already 14 Nov in Sofia", async () => {
    const g = await connectedGoogle({ now: new Date("2026-11-13T22:30:00.000Z") });
    await g.applyOps([holiday("2026-11-13"), holiday("2026-11-14")]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods?.map(dateKey)).toEqual(["2026-11-14"]);
  });

  it("undo of an applied holiday removes the period on Google", async () => {
    const g = await connectedGoogle();
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods).toHaveLength(1);
    const undo = await g.applyChanges(invertChanges(cs.changes), { source: "undo", undoes_id: cs.id });
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods ?? []).toEqual([]);
    expect(await syncLines(g.store, undo.id, "en")).toEqual([DONE_EN]);
  });

  it("keeps a special period someone set by hand in Google (Review Focus 1)", async () => {
    const hand: GoogleSpecialPeriod = { startDate: { year: 2026, month: 12, day: 31 }, endDate: { year: 2026, month: 12, day: 31 }, openTime: { hours: 10, minutes: 0 }, closeTime: { hours: 15, minutes: 0 } };
    const g = await connectedGoogle({ specialHours: [hand] });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    const periods = g.fake.location(g.loc.name).specialHours?.specialHourPeriods ?? [];
    expect(periods.map(dateKey)).toEqual(["2026-12-24", "2026-12-31"]);
    expect(periods[1]).toEqual(hand);
    expect((await g.rows(cs.id))[0].result).toMatchObject({ hours: { regular: true, special: 1, kept: 1 } });
  });

  it("no opening hours: fails at once without calling Google", async () => {
    const g = await connectedGoogle({ before: [{ op: "set_hours", hours: CLOSED_WEEK }] });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect(g.fake.calls).toEqual([]);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: Google needs opening hours before it can take holidays — tell me your hours first"]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: Google иска работно време, преди да приеме почивни дни. Кажете ми първо работното време"]);
  });

  it("hours_conflict: holidays only touch specialHours until the owner sets hours", async () => {
    const googleWeek: GooglePeriod[] = [{ openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 17 } }];
    const g = await connectedGoogle({ regularHours: googleWeek, config: { hours_conflict: true, google_hours: googleWeek } });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect(patches(g.fake).map((c) => c.query.updateMask)).toEqual(["specialHours", "specialHours"]);
    expect(g.fake.location(g.loc.name).regularHours?.periods).toEqual(googleWeek);
    const en = await syncLines(g.store, cs.id, "en");
    expect(en).toEqual([`${DONE_EN} (the regular hours on Google stay as they are; they differ from the website)`]);
    expect((await syncLines(g.store, cs.id, "bg"))[0]).toBe("Google профил: обновен ✅ (работното време в Google остава както е; различава се от сайта)");
    expect((await g.dest()).config.hours_conflict).toBe(true);
    g.fake.calls.length = 0;
    await g.applyOps([{ op: "set_hours", hours: WEEKDAYS_8_19 }]);
    expect(patches(g.fake).map((c) => c.query.updateMask)).toEqual(["regularHours,specialHours", "regularHours,specialHours"]);
    const cfg = (await g.dest()).config;
    expect(cfg.hours_conflict).toBe(false);
    expect(cfg).not.toHaveProperty("google_hours");
    expect(g.fake.location(g.loc.name).regularHours?.periods).toHaveLength(5);
  });

  it("Google reviewing the edit: done after one attempt, with the reviewing line", async () => {
    const g = await connectedGoogle({ hasGoogleUpdated: true });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "done", attempts: 1, result: { hours: { reviewing: true } } });
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: sent, Google is reviewing"]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: изпратено, Google го преглежда"]);
  });

  it("eight consecutive closed days carry the 7+ days note", async () => {
    const g = await connectedGoogle();
    const cs = await g.applyOps(["20", "21", "22", "23", "24", "25", "26", "27"].map((d) => holiday(`2026-12-${d}`)));
    expect(await syncLines(g.store, cs.id, "en")).toEqual([`${DONE_EN} (7+ days closed: Google may show this as temporarily closed only if you set it in your profile)`]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: обновен ✅ (7+ дни затворено: Google ще го покаже като „временно затворено\" само ако го зададете в профила си)"]);
  });
});

describe("errors", () => {
  it("a validateOnly refusal stops before the real write and fails without retry", async () => {
    const g = await connectedGoogle();
    g.fake.failNext({ status: 400, message: "Invalid special period.", match: (c) => c.method === "PATCH" });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect(patches(g.fake)).toHaveLength(1);
    expect(patches(g.fake)[0].query.validateOnly).toBe("true");
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect((await g.dest()).status).toBe("connected");
    const [line] = await syncLines(g.store, cs.id, "en");
    expect(line).toBe("Google listing: Google refused the hours: Invalid special period.");
    expect((await syncLines(g.store, cs.id, "bg"))[0]).toBe("Google профил: Google отказа работното време: Invalid special period.");
  });

  it("429 retries with backoff and succeeds on the next run", async () => {
    const g = await connectedGoogle();
    g.fake.failNext({ status: 429, match: (c) => c.method === "PATCH" });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    const [row] = await g.rows(cs.id);
    expect(row).toMatchObject({ status: "pending", attempts: 1, next_at: new Date(T0.getTime() + BACKOFF_MS[0]).toISOString() });
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: not updated — I'll retry"]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: не е обновен, ще опитам пак"]);
    const r = await runPendingSyncs(g.d, { venueId: g.venue.id, now: new Date(T0.getTime() + BACKOFF_MS[0]) });
    expect(r.done).toEqual([row.id]);
    expect(g.fake.location(g.loc.name).specialHours?.specialHourPeriods).toHaveLength(1);
    expect(await syncLines(g.store, cs.id, "en")).toEqual([DONE_EN]);
  });

  it("after MAX_ATTEMPTS 503s the row fails, the connection stays, the owner is sent to the profile", async () => {
    const g = await connectedGoogle();
    for (let i = 0; i < MAX_ATTEMPTS; i++) g.fake.failNext({ status: 503, match: (c) => c.method === "GET" });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const [row] = await g.rows(cs.id);
      expect(row.status).toBe("pending");
      await runPendingSyncs(g.d, { venueId: g.venue.id, now: new Date(row.next_at) });
    }
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect((await g.dest()).status).toBe("connected");
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: not updated. Open your profile to change it by hand: https://business.google.com/"]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: не е обновен. Отворете профила си и го променете ръчно: https://business.google.com/"]);
  });

  it("a revoked token fails at once and marks the connection; the website still changes (Review Focus 5)", async () => {
    const g = await connectedGoogle();
    g.fake.revoke(g.account.refresh_token);
    const cs = await g.applyOps([{ op: "set_hours", hours: WEEKDAYS_8_19 }]);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
    const dest = await g.dest();
    expect(dest.status).toBe("error");
    expect(dest.last_error).toMatch(/^sm_google_revoked/);
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: the connection is no longer valid; connect Google again from the dashboard"]);
    expect(await syncLines(g.store, cs.id, "bg")).toEqual(["Google профил: връзката вече не е валидна; свържете Google отново от таблото"]);
    expect((await g.store.getSite(g.venue.id)).venue.hours).toEqual(WEEKDAYS_8_19);
  });

  it("a plain 403 on the read is a lost permission; a later successful push reconnects", async () => {
    const g = await connectedGoogle();
    g.fake.failNext({ status: 403, match: (c) => c.method === "GET" });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect((await g.rows(cs.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
    expect(await g.dest()).toMatchObject({ status: "error", last_error: expect.stringMatching(/^sm_google_permission/) });
    expect(await syncLines(g.store, cs.id, "en")).toEqual(["Google listing: this Google account no longer manages the profile; ask the profile owner for Manager access and connect again"]);
    await g.applyOps([holiday("2026-12-25")]);
    expect(await g.dest()).toMatchObject({ status: "connected", last_error: null });
  });

  it("a venue without Google gets no Google row and no Google line", async () => {
    const g = await connectedGoogle({ destination: false });
    const cs = await g.applyOps([holiday("2026-12-24")]);
    expect(await enqueueForChangeSet(g.store, cs, T0)).toEqual([]);
    expect(await syncLines(g.store, cs.id, "en")).toEqual([]);
    expect(g.fake.calls).toEqual([]);
  });

  it("never logs the refresh token", async () => {
    const g = await connectedGoogle();
    g.fake.failNext({ status: 503, match: (c) => c.method === "PATCH" });
    await g.applyOps([holiday("2026-12-24")]);
    g.fake.revoke(g.account.refresh_token);
    await g.applyOps([holiday("2026-12-25")]);
    expect(g.logs.length).toBeGreaterThan(0);
    for (const l of g.logs) expect(l).not.toContain(g.account.refresh_token);
  });
});
