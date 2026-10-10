# Site Manager MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-venue café/restaurant website (Next.js on Vercel + Supabase) whose owner changes every piece of content from Telegram in Bulgarian or English, through typed, previewed, approved, logged and undoable change sets.

**Architecture:** One Next.js 16 App Router deployment serves the public sites (`/[slug]`, `/[slug]/menu`), the owner dashboard (`/admin/[slug]?key=`), the Telegram webhook (`/api/telegram`) and the tick (`/api/tick`). All business logic lives in `src/` behind a `Store` interface with an in-memory implementation (tests, offline e2e) and a Supabase implementation (production). Every edit is a change set of entity diffs (`before`/`after` patches) computed by pure domain code; the agent (Anthropic tool runner) only proposes; the bot's inline buttons or the dashboard approve; the tick applies scheduled/auto sets.

**Tech Stack:** next 16.4.0, react 19.3.0, tailwindcss 4.3.3 (`@tailwindcss/turbopack`), typescript 5.9 (pinned by create-next-app), @anthropic-ai/sdk 0.133.0, grammy 1.46.0, openai 7.32.0, @supabase/supabase-js 2.117.3, zod 4.6.5, pg 8.23.1, qrcode.react 4.2.0, vitest 5.0.3, tsx 4.23.15.

**Spec:** `docs/superpowers/specs/2026-10-10-site-manager-design.md` (read it first; this plan argues from it).

**Already done before Task 1** (commits `b78708e`, `6abc1e6`): create-next-app scaffold, pinned packages installed, `vitest.config.mts`, `.env.example` + git-ignored `.env.local` (empty values), `scripts/env-set.mts`, package scripts for every live step, GitHub repo `biskwida/site-manager` on `main`.

## Global Constraints

- Work on `main`, small commits, every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `package.json` has no `"type": "module"`: scripts with top-level `await` are `.mts`; app and `src/` code is `.ts`/`.tsx` imported by Next and vitest (both handle ESM syntax). Path alias `@/*` → repo root (`@/src/domain/types`).
- Every stored text has `_bg` and `_en`; both must read naturally. Bot replies in the member's `lang`. Previews are rendered in both languages and stored (`preview_bg`, `preview_en`).
- Prices are EUR with two decimals; range `0.10`–`500.00`; the model never does arithmetic (`bulkPrices`, `roundTo` do).
- Time zone: venue `tz`, default `Europe/Sofia`; the model sees `nowText` with the UTC offset; helpers resolve `"next_opening"` / `"closing_today"`.
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `TELEGRAM_BOT_TOKEN`, `TICK_SECRET`, `ANTHROPIC_API_KEY`, `STT_API_KEY` are read only in `src/config.ts` (server) and `scripts/`. Nothing under `app/` or `src/i18n`, `src/lib/supabase-browser.ts` imports `src/config.ts`. Telegram file URLs (`https://api.telegram.org/file/bot<token>/…`) are never logged. Admin tokens appear only in the owner's link and RPC parameters.
- Agent: model `claude-opus-5-5` (env `AGENT_MODEL`), effort `medium` default (env `AGENT_EFFORT`), `high` for image/bulk/scheduled turns; `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `max_tokens: 16000`, `max_iterations: 30`, refusal handling.
- All tests run offline with `InMemoryStore` and fakes: `npm test` must never need network or keys.
- Next 16 specifics verified in the installed docs (`node_modules/next/dist/docs`): `after` from `next/server`; `export const maxDuration = 300` in a route file; `params`/`searchParams` are Promises; global `PageProps<'/x/[slug]'>` and `RouteContext<'/api/x'>` helpers exist after typegen; `next/font/google` `Literata` and `Onest` both have the `cyrillic` subset.
- Copy rules: no invented testimonials; pitch facts only: two venues quoted 30 € (Bar and Dinner Central) and 20 € (Coffique) a month before the product existed; list price 25 €/venue/month. No contact details on the landing (user's decision 2026-10-10).

## Review Focus

Inputs the spec implies but does not spell out; each has a test pinned to the owning task:

1. **A second "Apply" tap on an already-decided proposal** (double tap, or dashboard and phone both decide): must be a no-op that reports the current status, never a double apply. → Task 6 (`applyChangeSet` returns `"skipped"`), Task 13 (callback edits the message with the existing status).
2. **An item that was removed or renamed between proposal and approval**: applying a stale `set_price` on an inactive item must still succeed as a patch and undo must restore the old value; applying `add_item` twice (same pre-generated id) must not duplicate. → Task 4 (apply is idempotent on inserts by id), Task 6.
3. **`set_sold_out` with `until` in the past or `"next_opening"` when the venue is closed for 14 days**: must resolve to `null` (back in stock) or a clear error, never a sold-out that never returns silently. → Task 1 (`nextOpening` returns `null`), Task 10 (tool error text).
4. **A Telegram update from an unknown chat, or a staff member asking for a price change**: unknown chat gets the `/start <code>` hint in the update's `language_code`; staff gets a role error with the next step. → Task 13 (unknown chat), Task 10 (`requireRole`).
5. **Owner language English but site default Bulgarian, item text given in only one language**: preview must show both languages, the untouched language must not be blanked by a patch. → Task 4 (`update_item` patch keeps unspecified keys), Task 5 (preview prints both).

---

## File structure

```
src/config.ts                 env parsing (server only)
src/time.ts                   zone helpers: localDate/localTime/weekday, zonedToIso, nowText, formatters
src/domain/types.ts           Venue/Category/Item/…, SiteState, ChangeOp union, Change, ChangeSet, Member
src/domain/hours.ts           nextOpening, closingToday, todayStatus
src/domain/allergens.ts       14 EU allergens BG/EN, keyword map, suggestAllergens, allergenWarnings
src/domain/pricing.ts         roundTo, bulkPrices
src/domain/changes.ts         validateChange, planChange, applyChange, invertChange(s)
src/domain/format.ts          formatPrice, tr
src/domain/effective.ts       isSoldOut, isLiveSpecial, visibleItems
src/domain/preview.ts         renderPreview (one line per change, both languages)
src/store/types.ts            Store interface, NewVenue/NewChangeSet/… , newToken
src/store/memory.ts           InMemoryStore
src/store/supabase.ts         SupabaseStore (must/mustRows, row mappers, entity writes, storage upload)
src/seed/demo.ts              demo venue data + seedDemo(store)
src/tick.ts                   runTick: due sets, auto sets, reminders, expiry
src/bot/messenger.ts          Messenger interface + TelegramMessenger (grammY Api)
src/bot/copy.ts               bot strings BG/EN
src/bot/bot.ts                createBot: commands, text/photo/voice/callback handlers
src/bot/approvals.ts          handleDecision(apply|change|cancel)
src/bot/media.ts              downloadTelegramFile (no URL logging), mime/ext helpers
src/bot/voice.ts              transcribe via OpenAI (injectable client)
src/agent/tools.ts            9 tools with guards + queue + attempt()
src/agent/prompt.ts           SYSTEM_PROMPT (bilingual rules), userMessage()
src/agent/memory.ts           conversation memory (8 turns, 30 min TTL)
src/agent/run.ts              runTurn: effort routing, toolRunner, refusal, close-out
src/server/deps.ts            lazy server singletons: config, store, messenger, bot, runner
src/i18n/dicts.ts             web copy EN/BG
src/i18n/index.tsx            LangProvider, useLang, LangToggle (client)
src/lib/supabase-browser.ts   anon client (NEXT_PUBLIC_* only)
src/lib/site-data.ts          fetchPublicSite(client, slug) → SiteState (anon-readable tables only)
app/layout.tsx app/page.tsx app/globals.css app/not-found.tsx
app/[slug]/page.tsx app/[slug]/menu/page.tsx app/[slug]/components/*.tsx
app/admin/[slug]/page.tsx app/admin/[slug]/components/AdminPanel.tsx
app/api/telegram/route.ts app/api/tick/route.ts
supabase/schema.sql supabase/policies.sql supabase/cron.sql
scripts/{db-apply,check-rls,venue-create,dev-bot,set-webhook,demo-reset,smoke,e2e-offline}.mts
test/helpers.ts test/*.test.ts
vercel.json next.config.ts README.md
```

---

### Task 1: Time helpers and opening hours

**Files:**
- Create: `src/time.ts`, `src/domain/types.ts` (only the parts listed here; later tasks extend it), `src/domain/hours.ts`
- Test: `test/time.test.ts`, `test/hours.test.ts`

**Interfaces:**
- Produces: `Weekday`, `WEEKDAYS`, `DayHours`, `WeekHours`, `Holiday`, `Lang` in `src/domain/types.ts`; `localDate(now, tz)`, `localTime(now, tz)`, `localWeekday(now, tz)`, `zonedToIso(date, time, tz)`, `nowText(now, tz)`, `formatDateTime(iso, lang, tz)`, `formatDate(date, lang)` in `src/time.ts`; `nextOpening(hours, holidays, from, tz)`, `closingToday(hours, holidays, now, tz)`, `todayStatus(hours, holidays, now, tz)` in `src/domain/hours.ts`.

- [ ] **Step 1: Write the type stubs**

```ts
// src/domain/types.ts
export type Lang = "bg" | "en";
export const LANGS: readonly Lang[] = ["bg", "en"];

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "HH:MM" 24-hour wall-clock times in the venue's zone. */
export interface DayHours {
  open: string;
  close: string;
}
/** null = closed that day. */
export type WeekHours = Record<Weekday, DayHours | null>;

export interface Holiday {
  id: string;
  venue_id: string;
  /** YYYY-MM-DD in the venue's zone. */
  date: string;
  note_bg: string;
  note_en: string;
}
```

- [ ] **Step 2: Write the failing time tests**

```ts
// test/time.test.ts
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, localDate, localTime, localWeekday, nowText, zonedToIso } from "@/src/time";

const TZ = "Europe/Sofia";

describe("time", () => {
  it("reads the local date, time and weekday in the zone", () => {
    const d = new Date("2026-10-10T21:30:00Z"); // Sat 10 Oct, 00:30 next day in Sofia (UTC+3)
    expect(localDate(d, TZ)).toBe("2026-10-11");
    expect(localTime(d, TZ)).toBe("00:30");
    expect(localWeekday(d, TZ)).toBe("sun");
  });

  it("converts wall-clock time to ISO across the DST change", () => {
    expect(zonedToIso("2026-10-24", "08:00", TZ)).toBe("2026-10-24T05:00:00.000Z"); // summer, UTC+3
    expect(zonedToIso("2026-10-26", "08:00", TZ)).toBe("2026-10-26T06:00:00.000Z"); // winter, UTC+2
  });

  it("describes now with the UTC offset for the model", () => {
    expect(nowText(new Date("2026-10-10T16:30:00Z"), TZ)).toBe("Saturday, 10 October 2026 at 19:30 GMT+03:00");
  });

  it("formats for people in both languages", () => {
    expect(formatDateTime("2026-10-10T16:30:00Z", "bg", TZ)).toBe("10.10.2026, 19:30");
    expect(formatDateTime("2026-10-10T16:30:00Z", "en", TZ)).toBe("10 Oct 2026, 19:30");
    expect(formatDate("2026-12-24", "bg")).toBe("24.12.2026");
    expect(formatDate("2026-12-24", "en")).toBe("24 Dec 2026");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/time.test.ts`
Expected: FAIL, "Failed to resolve import "@/src/time"".

- [ ] **Step 4: Implement `src/time.ts`**

```ts
// src/time.ts
import type { Lang, Weekday } from "./domain/types";

export const DEFAULT_TZ = "Europe/Sofia";

function parts(now: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) out[p.type] = p.value;
  return out;
}

/** YYYY-MM-DD in the zone. */
export function localDate(now: Date, tz: string): string {
  const p = parts(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM in the zone. */
export function localTime(now: Date, tz: string): string {
  const p = parts(now, tz);
  return `${p.hour}:${p.minute}`;
}

export function localWeekday(now: Date, tz: string): Weekday {
  return parts(now, tz).weekday.toLowerCase().slice(0, 3) as Weekday;
}

/** Minutes east of UTC for the zone at the given instant. */
function offsetMinutes(utc: Date, tz: string): number {
  const p = parts(utc, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - utc.getTime()) / 60_000);
}

/** Wall-clock date + time in the zone → ISO instant. Correct on both sides of a DST change. */
export function zonedToIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off1 = offsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60_000;
  const off2 = offsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60_000;
  return new Date(utc).toISOString();
}

/** e.g. "Saturday, 10 October 2026 at 19:30 GMT+03:00": the offset tells the model which one to write in ISO times. */
export function nowText(now: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "longOffset",
  }).format(now);
}

export function formatDateTime(iso: string, lang: Lang, tz: string): string {
  const d = new Date(iso);
  if (lang === "bg") {
    const p = parts(d, tz);
    return `${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d)
    .replace(",", ",");
}

/** YYYY-MM-DD → "24.12.2026" / "24 Dec 2026". */
export function formatDate(date: string, lang: Lang): string {
  const [y, m, d] = date.split("-");
  if (lang === "bg") return `${d}.${m}.${y}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
}

/** HH:MM for display (strips seconds if present). */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}
```

- [ ] **Step 5: Run the time tests**

Run: `npx vitest run test/time.test.ts`
Expected: PASS (4 tests). If `formatDateTime` for `en` yields "10 Oct 2026, 19:30" with a different separator on this ICU build, adjust the expected string to the actual Intl output rather than hand-formatting, but keep the `bg` branch exact.

- [ ] **Step 6: Write the failing hours tests**

```ts
// test/hours.test.ts
import { describe, expect, it } from "vitest";
import { closingToday, nextOpening, todayStatus } from "@/src/domain/hours";
import type { Holiday, WeekHours } from "@/src/domain/types";

const TZ = "Europe/Sofia";
const H: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};
const hol = (date: string): Holiday => ({ id: date, venue_id: "v", date, note_bg: "Почивен ден", note_en: "Closed" });

describe("nextOpening", () => {
  it("is tomorrow's opening when asked during opening hours", () => {
    // Fri 9 Oct 2026 12:00 Sofia
    expect(nextOpening(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBe("2026-10-10T06:00:00.000Z"); // Sat 09:00 +03
  });
  it("is today's opening when asked before opening", () => {
    expect(nextOpening(H, [], new Date("2026-10-09T03:00:00Z"), TZ)).toBe("2026-10-09T05:00:00.000Z");
  });
  it("skips closed days and holidays", () => {
    // Sat 10 Oct 20:00 Sofia; Sun closed; Mon 12 Oct is a holiday → Tue 13 Oct 08:00 +03
    expect(nextOpening(H, [hol("2026-10-12")], new Date("2026-10-10T17:00:00Z"), TZ)).toBe("2026-10-13T05:00:00.000Z");
  });
  it("crosses the DST change", () => {
    // Sat 24 Oct 2026 20:00 Sofia (+03); Sun closed; Mon 26 Oct 08:00 is +02 → 06:00Z
    expect(nextOpening(H, [], new Date("2026-10-24T17:00:00Z"), TZ)).toBe("2026-10-26T06:00:00.000Z");
  });
  it("returns null when closed for the next 14 days", () => {
    const closed: WeekHours = { ...H, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null };
    expect(nextOpening(closed, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBeNull();
  });
});

describe("closingToday", () => {
  it("is today's close while open", () => {
    expect(closingToday(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toBe("2026-10-09T15:00:00.000Z");
  });
  it("is null after closing, on closed days and on holidays", () => {
    expect(closingToday(H, [], new Date("2026-10-09T16:00:00Z"), TZ)).toBeNull();
    expect(closingToday(H, [], new Date("2026-10-11T09:00:00Z"), TZ)).toBeNull();
    expect(closingToday(H, [hol("2026-10-09")], new Date("2026-10-09T09:00:00Z"), TZ)).toBeNull();
  });
});

describe("todayStatus", () => {
  it("reports open until close", () => {
    expect(todayStatus(H, [], new Date("2026-10-09T09:00:00Z"), TZ)).toEqual({ state: "open", until: "18:00", holiday: null });
  });
  it("reports opens later today", () => {
    expect(todayStatus(H, [], new Date("2026-10-09T03:00:00Z"), TZ)).toEqual({ state: "opens_later", at: "08:00", holiday: null });
  });
  it("reports closed with the next opening", () => {
    expect(todayStatus(H, [], new Date("2026-10-11T09:00:00Z"), TZ)).toEqual({ state: "closed", next: "2026-10-12T05:00:00.000Z", holiday: null });
  });
  it("reports a holiday", () => {
    const h = hol("2026-10-09");
    expect(todayStatus(H, [h], new Date("2026-10-09T09:00:00Z"), TZ)).toEqual({ state: "closed", next: "2026-10-10T06:00:00.000Z", holiday: h });
  });
});
```

- [ ] **Step 7: Run the hours tests to verify they fail**

Run: `npx vitest run test/hours.test.ts`
Expected: FAIL, cannot resolve `@/src/domain/hours`.

- [ ] **Step 8: Implement `src/domain/hours.ts`**

```ts
// src/domain/hours.ts
import { localDate, localTime, localWeekday, zonedToIso } from "../time";
import { WEEKDAYS, type Holiday, type WeekHours } from "./types";

const DAY_MS = 86_400_000;
const LOOKAHEAD_DAYS = 14;

function isHoliday(date: string, holidays: Holiday[]): boolean {
  return holidays.some((h) => h.date === date);
}

/** The first opening instant strictly after `from`, within 14 days; null if the venue never opens in that window. */
export function nextOpening(hours: WeekHours, holidays: Holiday[], from: Date, tz: string): string | null {
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const day = new Date(from.getTime() + i * DAY_MS);
    const date = localDate(day, tz);
    const dh = hours[localWeekday(day, tz)];
    if (!dh || isHoliday(date, holidays)) continue;
    const iso = zonedToIso(date, dh.open, tz);
    if (new Date(iso).getTime() > from.getTime()) return iso;
  }
  return null;
}

/** Today's closing instant if the venue is open today and has not closed yet; otherwise null. */
export function closingToday(hours: WeekHours, holidays: Holiday[], now: Date, tz: string): string | null {
  const date = localDate(now, tz);
  const dh = hours[localWeekday(now, tz)];
  if (!dh || isHoliday(date, holidays)) return null;
  const iso = zonedToIso(date, dh.close, tz);
  return new Date(iso).getTime() > now.getTime() ? iso : null;
}

export type TodayStatus =
  | { state: "open"; until: string; holiday: Holiday | null }
  | { state: "opens_later"; at: string; holiday: Holiday | null }
  | { state: "closed"; next: string | null; holiday: Holiday | null };

export function todayStatus(hours: WeekHours, holidays: Holiday[], now: Date, tz: string): TodayStatus {
  const date = localDate(now, tz);
  const time = localTime(now, tz);
  const holiday = holidays.find((h) => h.date === date) ?? null;
  const dh = hours[localWeekday(now, tz)];
  if (dh && !holiday) {
    if (time < dh.open) return { state: "opens_later", at: dh.open, holiday: null };
    if (time < dh.close) return { state: "open", until: dh.close, holiday: null };
  }
  return { state: "closed", next: nextOpening(hours, holidays, now, tz), holiday };
}

export function isValidHours(h: unknown): h is WeekHours {
  if (!h || typeof h !== "object") return false;
  const rec = h as Record<string, unknown>;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  return WEEKDAYS.every((d) => {
    const v = rec[d];
    if (v === null) return true;
    if (!v || typeof v !== "object") return false;
    const { open, close } = v as Record<string, unknown>;
    return typeof open === "string" && typeof close === "string" && hhmm.test(open) && hhmm.test(close) && open < close;
  });
}
```

- [ ] **Step 9: Run the hours tests**

Run: `npx vitest run test/hours.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 10: Commit**

```bash
git add src/time.ts src/domain/types.ts src/domain/hours.ts test/time.test.ts test/hours.test.ts
git commit -m "Domain: time-zone helpers and opening hours (next opening, closing today, status)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Allergens (EU 1169/2011 Annex II)

**Files:**
- Create: `src/domain/allergens.ts`
- Test: `test/allergens.test.ts`

**Interfaces:**
- Produces: `ALLERGENS: { code: number; bg: string; en: string }[]`, `allergenName(code, lang)`, `suggestAllergens(text): number[]`, `allergenWarnings(declared: number[], text: string): { code: number; keyword: string }[]`, `isAllergenCode(n)`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/allergens.test.ts
import { describe, expect, it } from "vitest";
import { ALLERGENS, allergenName, allergenWarnings, suggestAllergens } from "@/src/domain/allergens";

describe("allergens", () => {
  it("lists the 14 EU allergens in both languages", () => {
    expect(ALLERGENS).toHaveLength(14);
    expect(ALLERGENS.map((a) => a.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(allergenName(7, "bg")).toBe("Мляко");
    expect(allergenName(7, "en")).toBe("Milk");
    expect(allergenName(1, "en")).toBe("Gluten");
  });

  it("suggests from Bulgarian keywords", () => {
    expect(suggestAllergens("Баница със сирене и яйца")).toEqual([1, 3, 7]);
    expect(suggestAllergens("Сандвич с пуешко и горчица")).toEqual([1, 10]);
    expect(suggestAllergens("Фреш портокал")).toEqual([]);
  });

  it("suggests from English keywords and is case-insensitive", () => {
    expect(suggestAllergens("Walnut brownie with CREAM")).toEqual([1, 7, 8]);
    expect(suggestAllergens("Shrimp salad with sesame")).toEqual([2, 11]);
  });

  it("warns only about suggested codes that are not declared", () => {
    expect(allergenWarnings([1], "Кроасан с масло")).toEqual([{ code: 7, keyword: "масло" }]);
    expect(allergenWarnings([1, 7], "Кроасан с масло")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/allergens.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/domain/allergens.ts`**

```ts
// src/domain/allergens.ts
import type { Lang } from "./types";

/** Regulation (EU) 1169/2011, Annex II. Short display names; the site shows a legend. */
export const ALLERGENS: readonly { code: number; bg: string; en: string }[] = [
  { code: 1, bg: "Глутен", en: "Gluten" },
  { code: 2, bg: "Ракообразни", en: "Crustaceans" },
  { code: 3, bg: "Яйца", en: "Eggs" },
  { code: 4, bg: "Риба", en: "Fish" },
  { code: 5, bg: "Фъстъци", en: "Peanuts" },
  { code: 6, bg: "Соя", en: "Soybeans" },
  { code: 7, bg: "Мляко", en: "Milk" },
  { code: 8, bg: "Ядки", en: "Nuts" },
  { code: 9, bg: "Целина", en: "Celery" },
  { code: 10, bg: "Горчица", en: "Mustard" },
  { code: 11, bg: "Сусам", en: "Sesame" },
  { code: 12, bg: "Сулфити", en: "Sulphites" },
  { code: 13, bg: "Лупина", en: "Lupin" },
  { code: 14, bg: "Мекотели", en: "Molluscs" },
];

export function isAllergenCode(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 14;
}

export function allergenName(code: number, lang: Lang): string {
  const a = ALLERGENS.find((x) => x.code === code);
  return a ? a[lang] : String(code);
}

/** Lower-case stems; a stem matches when it is a substring of the lower-cased text. Advisory only. */
const KEYWORDS: readonly { code: number; stems: string[] }[] = [
  { code: 1, stems: ["хляб", "брашно", "тесто", "баниц", "кроасан", "паста", "пица", "питк", "кори", "козунак", "бисквит", "браун", "кекс", "торта", "пшениц", "ръж", "ечемик", "овес", "сандвич", "тост", "bread", "flour", "dough", "croissant", "pasta", "pizza", "wheat", "rye", "barley", "oat", "biscuit", "brownie", "cake", "sandwich", "toast", "bun", "pastry", "banitsa"] },
  { code: 2, stems: ["скарид", "рак", "омар", "лангуст", "shrimp", "prawn", "crab", "lobster", "crayfish"] },
  { code: 3, stems: ["яйц", "майонез", "омлет", "egg", "mayonnaise", "omelet", "meringue"] },
  { code: 4, stems: ["риба", "сьомга", "тон ", "риба тон", "скумрия", "пъстърва", "аншоа", "fish", "salmon", "tuna", "mackerel", "trout", "anchov", "cod"] },
  { code: 5, stems: ["фъстъ", "peanut"] },
  { code: 6, stems: ["соя", "соев", "тофу", "soy", "tofu", "edamame"] },
  { code: 7, stems: ["мляко", "млечн", "сирене", "кашкавал", "масло", "сметана", "йогурт", "кисело мляко", "капучино", "лате", "моцарела", "извара", "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "cappuccino", "latte", "mozzarella", "ricotta", "whey"] },
  { code: 8, stems: ["орех", "бадем", "лешни", "шам", "кашу", "пекан", "ядки", "walnut", "almond", "hazelnut", "pistachio", "cashew", "pecan", "nuts"] },
  { code: 9, stems: ["целина", "celery"] },
  { code: 10, stems: ["горчиц", "mustard"] },
  { code: 11, stems: ["сусам", "тахан", "sesame", "tahini"] },
  { code: 12, stems: ["вино", "сулфит", "wine", "sulphite", "sulfite"] },
  { code: 13, stems: ["лупин", "lupin"] },
  { code: 14, stems: ["миди", "калмар", "октопод", "охлюв", "mussel", "squid", "octopus", "clam", "oyster", "snail"] },
];

/** Codes whose keywords appear in the text, ascending. */
export function suggestAllergens(text: string): number[] {
  return matches(text).map((m) => m.code);
}

function matches(text: string): { code: number; keyword: string }[] {
  const t = ` ${text.toLowerCase()} `;
  const out: { code: number; keyword: string }[] = [];
  for (const k of KEYWORDS) {
    const stem = k.stems.find((s) => t.includes(s));
    if (stem !== undefined) out.push({ code: k.code, keyword: stem.trim() });
  }
  return out;
}

/** Suggested allergens the dish does not declare, with the keyword that triggered each. */
export function allergenWarnings(declared: number[], text: string): { code: number; keyword: string }[] {
  const have = new Set(declared);
  return matches(text).filter((m) => !have.has(m.code));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/allergens.test.ts`
Expected: PASS. If "Кроасан с масло" also matches gluten via "кроасан", the warnings test still passes because 1 is declared; keep the expectations as written.

- [ ] **Step 5: Commit**

```bash
git add src/domain/allergens.ts test/allergens.test.ts
git commit -m "Domain: 14 EU allergens with BG/EN names and keyword suggestions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pricing (bulk changes with rounding)

**Files:**
- Create: `src/domain/pricing.ts`
- Test: `test/pricing.test.ts`

**Interfaces:**
- Produces: `PRICE_MIN = 0.1`, `PRICE_MAX = 500`, `round2(n)`, `Rounding = "none" | "0.05" | "0.10" | "0.50" | "1.00"`, `roundTo(value, rounding)`, `bulkPrices(items: { id; name_bg; name_en; price_eur }[], change: { percent?: number; delta_eur?: number; rounding: Rounding })` → `{ item_id, name_bg, name_en, old_eur, new_eur }[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/pricing.test.ts
import { describe, expect, it } from "vitest";
import { bulkPrices, round2, roundTo } from "@/src/domain/pricing";

const items = [
  { id: "a", name_bg: "Еспресо", name_en: "Espresso", price_eur: 1.8 },
  { id: "b", name_bg: "Капучино", name_en: "Cappuccino", price_eur: 2.9 },
  { id: "c", name_bg: "Лате", name_en: "Latte", price_eur: 3.2 },
];

describe("pricing", () => {
  it("rounds to two decimals without float noise", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.9 * 1.1)).toBe(3.19);
  });

  it("rounds to a step", () => {
    expect(roundTo(3.19, "0.10")).toBe(3.2);
    expect(roundTo(3.14, "0.05")).toBe(3.15);
    expect(roundTo(3.24, "0.50")).toBe(3.0);
    expect(roundTo(3.26, "0.50")).toBe(3.5);
    expect(roundTo(3.19, "none")).toBe(3.19);
  });

  it("applies a percentage with rounding", () => {
    expect(bulkPrices(items, { percent: 10, rounding: "0.10" })).toEqual([
      { item_id: "a", name_bg: "Еспресо", name_en: "Espresso", old_eur: 1.8, new_eur: 2.0 },
      { item_id: "b", name_bg: "Капучино", name_en: "Cappuccino", old_eur: 2.9, new_eur: 3.2 },
      { item_id: "c", name_bg: "Лате", name_en: "Latte", old_eur: 3.2, new_eur: 3.5 },
    ]);
  });

  it("applies a delta and clamps to the price range", () => {
    expect(bulkPrices(items, { delta_eur: -2, rounding: "none" }).map((r) => r.new_eur)).toEqual([0.1, 0.9, 1.2]);
  });

  it("rejects percent and delta together or neither", () => {
    expect(() => bulkPrices(items, { rounding: "none" })).toThrow(/percent or delta_eur/);
    expect(() => bulkPrices(items, { percent: 5, delta_eur: 1, rounding: "none" })).toThrow(/not both/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/pricing.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/domain/pricing.ts`**

```ts
// src/domain/pricing.ts
export const PRICE_MIN = 0.1;
export const PRICE_MAX = 500;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type Rounding = "none" | "0.05" | "0.10" | "0.50" | "1.00";
export const ROUNDINGS: readonly Rounding[] = ["none", "0.05", "0.10", "0.50", "1.00"];

export function roundTo(value: number, rounding: Rounding): number {
  if (rounding === "none") return round2(value);
  const step = Number(rounding);
  return round2(Math.round(value / step) * step);
}

export function clampPrice(value: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, round2(value)));
}

export interface BulkInput {
  percent?: number;
  delta_eur?: number;
  rounding: Rounding;
}
export interface BulkRow {
  item_id: string;
  name_bg: string;
  name_en: string;
  old_eur: number;
  new_eur: number;
}

/** old → new for each item. The model never does this arithmetic. */
export function bulkPrices(items: { id: string; name_bg: string; name_en: string; price_eur: number }[], change: BulkInput): BulkRow[] {
  const hasPercent = typeof change.percent === "number";
  const hasDelta = typeof change.delta_eur === "number";
  if (hasPercent && hasDelta) throw new Error("Give percent or delta_eur, not both.");
  if (!hasPercent && !hasDelta) throw new Error("Give percent or delta_eur.");
  return items.map((i) => {
    const raw = hasPercent ? i.price_eur * (1 + (change.percent as number) / 100) : i.price_eur + (change.delta_eur as number);
    return { item_id: i.id, name_bg: i.name_bg, name_en: i.name_en, old_eur: i.price_eur, new_eur: clampPrice(roundTo(raw, change.rounding)) };
  });
}
```

- [ ] **Step 4: Run the tests** → `npx vitest run test/pricing.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/pricing.ts test/pricing.test.ts
git commit -m "Domain: bulk price changes with step rounding and range clamp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Domain types and change operations (validate, plan, apply, invert)

**Files:**
- Modify: `src/domain/types.ts` (append everything below the Task 1 types)
- Create: `src/domain/changes.ts`
- Test: `test/changes.test.ts`, `test/fixtures.ts`

**Interfaces:**
- Consumes: `isValidHours` (Task 1), `isAllergenCode` (Task 2), `PRICE_MIN/PRICE_MAX/round2` (Task 3).
- Produces: every entity type, `SiteState`, `ChangeOp` union, `Change`, `ChangeSet`, `Member`, `Conversation`; `validateChange(state, op, ctx): string | null`, `planChange(state, op, ctx): Change`, `planChanges(state, ops, ctx): Change[]`, `applyChange(state, change): SiteState`, `applyChanges(state, changes): SiteState`, `invertChanges(changes): Change[]`, `PlanContext = { newId: () => string; now: string }`. Later tasks (store, tools, preview, tick, web) all import these names exactly.

- [ ] **Step 1: Append the entity and change types to `src/domain/types.ts`**

```ts
// src/domain/types.ts (append)
export interface Venue {
  id: string;
  slug: string;
  name: string;
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  address: string;
  phone: string;
  maps_url: string;
  instagram: string;
  cover_media_id: string | null;
  logo_media_id: string | null;
  hours: WeekHours;
  tz: string;
  default_lang: Lang;
  theme: { accent: string };
  created_at: string;
}

export interface Category {
  id: string;
  venue_id: string;
  name_bg: string;
  name_en: string;
  position: number;
  active: boolean;
}

export interface Item {
  id: string;
  venue_id: string;
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  image_media_id: string | null;
  sold_out_until: string | null;
  is_special: boolean;
  special_expires_at: string | null;
  position: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  venue_id: string;
  text_bg: string;
  text_en: string;
  expires_at: string | null;
  created_at: string;
}

export interface Media {
  id: string;
  venue_id: string;
  storage_path: string;
  public_url: string;
  is_gallery: boolean;
  position: number;
  created_at: string;
}

export const SITE_TEXT_KEYS = ["welcome", "footer_note"] as const;
export type SiteTextKey = (typeof SITE_TEXT_KEYS)[number];
export const VENUE_TEXT_KEYS = ["tagline", "about", "address", "phone", "maps_url", "instagram"] as const;
export type VenueTextKey = (typeof VENUE_TEXT_KEYS)[number];
export type TextKey = SiteTextKey | VenueTextKey;
/** Single-language keys: the agent passes the same value as text_bg and text_en; only text_bg is stored. */
export const MONO_TEXT_KEYS: readonly TextKey[] = ["address", "phone", "maps_url", "instagram"];

export interface SiteText {
  venue_id: string;
  key: SiteTextKey;
  text_bg: string;
  text_en: string;
}

/** Everything the public site, the preview and the agent need for one venue. */
export interface SiteState {
  venue: Venue;
  categories: Category[];
  items: Item[];
  holidays: Holiday[];
  announcements: Announcement[];
  media: Media[];
  texts: SiteText[];
}

export interface NewItemInput {
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  is_special: boolean;
  special_expires_at: string | null;
  image_media_id?: string | null;
}
export type ItemPatch = Partial<Pick<Item, "category_id" | "name_bg" | "name_en" | "desc_bg" | "desc_en" | "price_eur" | "allergens" | "position">>;

export type ChangeOp =
  | { op: "set_price"; item_id: string; price_eur: number }
  | { op: "set_sold_out"; item_id: string; until: string | null }
  | { op: "add_item"; item: NewItemInput; id?: string }
  | { op: "update_item"; item_id: string; patch: ItemPatch }
  | { op: "remove_item"; item_id: string }
  | { op: "set_item_image"; item_id: string; media_id: string | null }
  | { op: "set_cover_image"; media_id: string | null }
  | { op: "set_logo_image"; media_id: string | null }
  | { op: "add_gallery_image"; media_id: string }
  | { op: "remove_gallery_image"; media_id: string }
  | { op: "set_hours"; hours: WeekHours }
  | { op: "add_holiday"; date: string; note_bg: string; note_en: string; id?: string }
  | { op: "remove_holiday"; holiday_id: string }
  | { op: "add_announcement"; text_bg: string; text_en: string; expires_at: string | null; id?: string }
  | { op: "remove_announcement"; announcement_id: string }
  | { op: "set_text"; key: TextKey; text_bg: string; text_en: string }
  | { op: "set_theme"; accent: string };
export type OpName = ChangeOp["op"];
export const OP_NAMES: readonly OpName[] = [
  "set_price", "set_sold_out", "add_item", "update_item", "remove_item", "set_item_image", "set_cover_image", "set_logo_image",
  "add_gallery_image", "remove_gallery_image", "set_hours", "add_holiday", "remove_holiday", "add_announcement", "remove_announcement",
  "set_text", "set_theme",
];

export type Entity = "venue" | "category" | "item" | "holiday" | "announcement" | "media" | "site_text";
export type Row = Record<string, unknown>;

/**
 * One entity write. `before`/`after` are patches (the touched keys only) for updates,
 * `before: null` + full row for inserts, full row + `after: null` for deletes.
 * Undo swaps them. For `site_text`, entity_id is the text key.
 */
export interface Change {
  position: number;
  op: OpName;
  entity: Entity;
  entity_id: string;
  before: Row | null;
  after: Row | null;
}

export type ChangeSource = "text" | "voice" | "photo" | "dashboard" | "auto" | "undo";
export type ChangeSetStatus = "proposed" | "scheduled" | "applied" | "rejected" | "expired" | "cancelled" | "reverted";

export interface ChangeSet {
  id: string;
  venue_id: string;
  chat_id: number | null;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  source: ChangeSource;
  status: ChangeSetStatus;
  apply_at: string | null;
  reminded_at: string | null;
  decided_at: string | null;
  applied_at: string | null;
  reverted_by: string | null;
  /** For source "undo": the set this one reverts. */
  undoes_id: string | null;
  tg_message_id: number | null;
  created_at: string;
  changes: Change[];
}

export type Role = "owner" | "staff";
export interface Member {
  venue_id: string;
  tg_chat_id: number;
  role: Role;
  lang: Lang;
  created_at: string;
}

export interface ConversationTurn {
  at: string;
  owner: string;
  agent: string;
  outcome?: string;
}
export interface Conversation {
  turns: ConversationTurn[];
  /** Set by the ✏️ Change button: the next message corrects this proposal. */
  correction_for: string | null;
  updated_at: string;
}
```

- [ ] **Step 2: Write the shared fixture**

```ts
// test/fixtures.ts
import type { Category, Item, Media, SiteState, Venue, WeekHours } from "@/src/domain/types";

export const NOW = "2026-10-09T09:00:00.000Z"; // Fri 9 Oct 2026 12:00 Sofia
export const TZ = "Europe/Sofia";

export const HOURS: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};

export function venue(over: Partial<Venue> = {}): Venue {
  return {
    id: "v1",
    slug: "agala",
    name: "Кафене „Ъгъла“",
    tagline_bg: "Кафе на ъгъла",
    tagline_en: "Coffee on the corner",
    about_bg: "Малко кафене в центъра.",
    about_en: "A small café downtown.",
    address: "ул. Пример 1, София",
    phone: "+359 2 000 0000",
    maps_url: "https://maps.example/agala",
    instagram: "agala.cafe",
    cover_media_id: null,
    logo_media_id: null,
    hours: HOURS,
    tz: TZ,
    default_lang: "bg",
    theme: { accent: "#2f6b4f" },
    created_at: NOW,
    ...over,
  };
}

export function category(id: string, name_bg: string, name_en: string, position = 0): Category {
  return { id, venue_id: "v1", name_bg, name_en, position, active: true };
}

export function item(over: Partial<Item> & { id: string; name_bg: string; name_en: string; price_eur: number }): Item {
  return {
    venue_id: "v1",
    category_id: "c-coffee",
    desc_bg: "",
    desc_en: "",
    allergens: [],
    image_media_id: null,
    sold_out_until: null,
    is_special: false,
    special_expires_at: null,
    position: 0,
    active: true,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

export function media(id: string, over: Partial<Media> = {}): Media {
  return { id, venue_id: "v1", storage_path: `v1/${id}.jpg`, public_url: `https://cdn.example/v1/${id}.jpg`, is_gallery: false, position: 0, created_at: NOW, ...over };
}

export function state(over: Partial<SiteState> = {}): SiteState {
  return {
    venue: venue(),
    categories: [category("c-coffee", "Кафе", "Coffee", 0), category("c-pastry", "Закуски", "Pastries", 1)],
    items: [
      item({ id: "i-esp", name_bg: "Еспресо", name_en: "Espresso", price_eur: 1.8 }),
      item({ id: "i-cap", name_bg: "Капучино", name_en: "Cappuccino", price_eur: 2.9, allergens: [7], position: 1 }),
      item({ id: "i-ban", name_bg: "Баница със сирене", name_en: "Cheese banitsa", price_eur: 2.5, category_id: "c-pastry", allergens: [1, 3, 7] }),
    ],
    holidays: [],
    announcements: [],
    media: [media("m1"), media("m2", { is_gallery: true, position: 0 })],
    texts: [{ venue_id: "v1", key: "welcome", text_bg: "Добре дошли!", text_en: "Welcome!" }],
    ...over,
  };
}
```

- [ ] **Step 3: Write the failing change tests**

```ts
// test/changes.test.ts
import { describe, expect, it } from "vitest";
import { applyChanges, invertChanges, planChange, planChanges, validateChange, type PlanContext } from "@/src/domain/changes";
import type { ChangeOp, Item, SiteState } from "@/src/domain/types";
import { HOURS, NOW, state } from "./fixtures";

const ctx = (): PlanContext => {
  let n = 0;
  return { newId: () => `new-${++n}`, now: NOW };
};
const itemById = (s: SiteState, id: string): Item | undefined => s.items.find((i) => i.id === id);

/** Every op must round-trip: plan → apply → invert → apply gives the original state. */
const OPS: { name: string; op: ChangeOp }[] = [
  { name: "set_price", op: { op: "set_price", item_id: "i-cap", price_eur: 3.2 } },
  { name: "set_sold_out", op: { op: "set_sold_out", item_id: "i-ban", until: "2026-10-10T05:00:00.000Z" } },
  { name: "add_item", op: { op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "С мляко", desc_en: "With milk", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } } },
  { name: "update_item", op: { op: "update_item", item_id: "i-cap", patch: { desc_bg: "Двойно", desc_en: "Double", price_eur: 3 } } },
  { name: "remove_item", op: { op: "remove_item", item_id: "i-esp" } },
  { name: "set_item_image", op: { op: "set_item_image", item_id: "i-cap", media_id: "m1" } },
  { name: "set_cover_image", op: { op: "set_cover_image", media_id: "m1" } },
  { name: "set_logo_image", op: { op: "set_logo_image", media_id: "m1" } },
  { name: "add_gallery_image", op: { op: "add_gallery_image", media_id: "m1" } },
  { name: "remove_gallery_image", op: { op: "remove_gallery_image", media_id: "m2" } },
  { name: "set_hours", op: { op: "set_hours", hours: { ...HOURS, sun: { open: "10:00", close: "14:00" } } } },
  { name: "add_holiday", op: { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" } },
  { name: "add_announcement", op: { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: "2026-12-26T00:00:00.000Z" } },
  { name: "set_text welcome", op: { op: "set_text", key: "welcome", text_bg: "Здравейте!", text_en: "Hello!" } },
  { name: "set_text tagline", op: { op: "set_text", key: "tagline", text_bg: "Ново мото", text_en: "New tagline" } },
  { name: "set_text phone", op: { op: "set_text", key: "phone", text_bg: "+359 88 000", text_en: "+359 88 000" } },
  { name: "set_theme", op: { op: "set_theme", accent: "#aa3311" } },
];

describe("round trips", () => {
  for (const { name, op } of OPS) {
    it(name, () => {
      const s0 = state();
      const change = planChange(s0, op, ctx());
      const s1 = applyChanges(s0, [change]);
      expect(s1).not.toEqual(s0);
      const s2 = applyChanges(s1, invertChanges([change]));
      expect(s2).toEqual(s0);
    });
  }
  it("remove_holiday and remove_announcement", () => {
    const s0 = state({
      holidays: [{ id: "h1", venue_id: "v1", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }],
      announcements: [{ id: "a1", venue_id: "v1", text_bg: "Хей", text_en: "Hey", expires_at: null, created_at: NOW }],
    });
    const changes = planChanges(s0, [{ op: "remove_holiday", holiday_id: "h1" }, { op: "remove_announcement", announcement_id: "a1" }], ctx());
    const s1 = applyChanges(s0, changes);
    expect(s1.holidays).toEqual([]);
    expect(s1.announcements).toEqual([]);
    expect(applyChanges(s1, invertChanges(changes))).toEqual(s0);
  });
});

describe("planning details", () => {
  it("set_price stores only the touched key", () => {
    const c = planChange(state(), { op: "set_price", item_id: "i-cap", price_eur: 3.2 }, ctx());
    expect(c).toEqual({ position: 0, op: "set_price", entity: "item", entity_id: "i-cap", before: { price_eur: 2.9 }, after: { price_eur: 3.2 } });
  });
  it("add_item gets a generated id, the next position in its category and full row", () => {
    const c = planChange(state(), OPS[2].op, ctx());
    expect(c.entity_id).toBe("new-1");
    expect(c.before).toBeNull();
    expect(c.after).toMatchObject({ id: "new-1", venue_id: "v1", position: 2, active: true, sold_out_until: null, created_at: NOW });
  });
  it("planChanges lets a later op reference an item added earlier in the same set", () => {
    const changes = planChanges(state(), [OPS[2].op, { op: "set_sold_out", item_id: "new-1", until: null }], ctx());
    expect(changes.map((c) => c.position)).toEqual([0, 1]);
    expect(changes[1].entity_id).toBe("new-1");
  });
  it("update_item keeps the untouched language", () => {
    const s1 = applyChanges(state(), [planChange(state(), { op: "update_item", item_id: "i-cap", patch: { desc_bg: "Двойно" } }, ctx())]);
    expect(itemById(s1, "i-cap")).toMatchObject({ desc_bg: "Двойно", desc_en: "", name_en: "Cappuccino" });
  });
  it("applying an insert twice does not duplicate", () => {
    const c = planChange(state(), OPS[2].op, ctx());
    const s = applyChanges(applyChanges(state(), [c]), [c]);
    expect(s.items.filter((i) => i.id === "new-1")).toHaveLength(1);
  });
  it("a stale patch on an inactive item still applies and inverts", () => {
    const s0 = state();
    const c = planChange(s0, { op: "set_price", item_id: "i-esp", price_eur: 2 }, ctx());
    const removed = applyChanges(s0, [planChange(s0, { op: "remove_item", item_id: "i-esp" }, ctx())]);
    const s1 = applyChanges(removed, [c]);
    expect(itemById(s1, "i-esp")).toMatchObject({ price_eur: 2, active: false });
    expect(itemById(applyChanges(s1, invertChanges([c])), "i-esp")).toMatchObject({ price_eur: 1.8, active: false });
  });
  it("mono text keys store text_bg only; bilingual venue keys store both", () => {
    const c = planChange(state(), { op: "set_text", key: "phone", text_bg: "+359 1", text_en: "+359 1" }, ctx());
    expect(c).toMatchObject({ entity: "venue", before: { phone: "+359 2 000 0000" }, after: { phone: "+359 1" } });
    const t = planChange(state(), { op: "set_text", key: "about", text_bg: "А", text_en: "B" }, ctx());
    expect(t.after).toEqual({ about_bg: "А", about_en: "B" });
  });
  it("set_text on a missing site text inserts; undo deletes", () => {
    const c = planChange(state(), { op: "set_text", key: "footer_note", text_bg: "Благодарим", text_en: "Thank you" }, ctx());
    expect(c).toMatchObject({ entity: "site_text", entity_id: "footer_note", before: null });
    const s1 = applyChanges(state(), [c]);
    expect(s1.texts.find((t) => t.key === "footer_note")).toMatchObject({ text_en: "Thank you" });
    expect(applyChanges(s1, invertChanges([c])).texts.find((t) => t.key === "footer_note")).toBeUndefined();
  });
});

describe("validation", () => {
  const cases: [string, ChangeOp, RegExp][] = [
    ["unknown item", { op: "set_price", item_id: "nope", price_eur: 2 }, /item_id "nope" not found/],
    ["price too high", { op: "set_price", item_id: "i-cap", price_eur: 600 }, /between 0.10 and 500/],
    ["price not two decimals", { op: "set_price", item_id: "i-cap", price_eur: 2.999 }, /two decimals/],
    ["sold out in the past", { op: "set_sold_out", item_id: "i-cap", until: "2026-10-01T00:00:00.000Z" }, /in the future/],
    ["sold out invalid date", { op: "set_sold_out", item_id: "i-cap", until: "tomorrow" }, /ISO 8601/],
    ["add item unknown category", { op: "add_item", item: { ...OPS[2].op.item, category_id: "zzz" } as never }, /category_id "zzz" not found/],
    ["add item bad allergen", { op: "add_item", item: { ...(OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, allergens: [0, 15] } }, /allergen codes 1–14/],
    ["add item empty name", { op: "add_item", item: { ...(OPS[2].op as Extract<ChangeOp, { op: "add_item" }>).item, name_en: "" } }, /name_en/],
    ["foreign media", { op: "set_cover_image", media_id: "other" }, /media_id "other" not found/],
    ["gallery twice", { op: "add_gallery_image", media_id: "m2" }, /already in the gallery/],
    ["bad hours", { op: "set_hours", hours: { ...HOURS, mon: { open: "18:00", close: "08:00" } } }, /HH:MM/],
    ["bad holiday date", { op: "add_holiday", date: "24.12.2026", note_bg: "x", note_en: "x" }, /YYYY-MM-DD/],
    ["bad text key", { op: "set_text", key: "menu" as never, text_bg: "x", text_en: "x" }, /key must be one of/],
    ["bad accent", { op: "set_theme", accent: "green" }, /#rrggbb/],
    ["empty patch", { op: "update_item", item_id: "i-cap", patch: {} }, /patch is empty/],
  ];
  for (const [name, op, re] of cases) {
    it(name, () => {
      expect(validateChange(state(), op, ctx())).toMatch(re);
      expect(() => planChange(state(), op, ctx())).toThrow(re);
    });
  }
  it("accepts a valid op", () => {
    expect(validateChange(state(), { op: "set_price", item_id: "i-cap", price_eur: 3.2 }, ctx())).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run test/changes.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `src/domain/changes.ts`**

```ts
// src/domain/changes.ts
import { isAllergenCode } from "./allergens";
import { isValidHours } from "./hours";
import { PRICE_MAX, PRICE_MIN, round2 } from "./pricing";
import {
  MONO_TEXT_KEYS, SITE_TEXT_KEYS, VENUE_TEXT_KEYS,
  type Announcement, type Change, type ChangeOp, type Entity, type Holiday, type Item, type Media, type Row, type SiteState, type SiteText, type TextKey,
} from "./types";

export interface PlanContext {
  newId: () => string;
  /** ISO instant used for created_at and "in the future" checks. */
  now: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

function isIso(s: unknown): s is string {
  return typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
}

function priceError(p: unknown): string | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return "price_eur must be a number.";
  if (round2(p) !== p) return "price_eur must have at most two decimals.";
  if (p < PRICE_MIN || p > PRICE_MAX) return `price_eur must be between ${PRICE_MIN.toFixed(2)} and ${PRICE_MAX.toFixed(2)}.`;
  return null;
}

function allergensError(a: unknown): string | null {
  if (!Array.isArray(a) || !a.every(isAllergenCode)) return "allergens must be allergen codes 1–14.";
  if (new Set(a).size !== a.length) return "allergens must not repeat.";
  return null;
}

function nonEmpty(v: unknown, field: string): string | null {
  return typeof v === "string" && v.trim().length > 0 ? null : `${field} must be a non-empty string.`;
}

const findItem = (s: SiteState, id: string) => s.items.find((i) => i.id === id);
const findMedia = (s: SiteState, id: string) => s.media.find((m) => m.id === id);

function mediaError(s: SiteState, id: unknown): string | null {
  if (typeof id !== "string" || !findMedia(s, id)) return `media_id "${String(id)}" not found for this venue; use an id from a photo you received.`;
  return null;
}

/** English error for the model, or null when the op can be planned against this state. */
export function validateChange(s: SiteState, op: ChangeOp, ctx: PlanContext): string | null {
  switch (op.op) {
    case "set_price": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      return priceError(op.price_eur);
    }
    case "set_sold_out": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      if (op.until === null) return null;
      if (!isIso(op.until)) return 'until must be null, "next_opening" (resolved by the tool) or an ISO 8601 datetime with offset.';
      if (Date.parse(op.until) <= Date.parse(ctx.now)) return "until must be in the future (or null to put the item back on sale).";
      return null;
    }
    case "add_item": {
      const it = op.item;
      if (!s.categories.some((c) => c.id === it.category_id && c.active)) return `category_id "${it.category_id}" not found; use an id from get_menu.`;
      return (
        nonEmpty(it.name_bg, "name_bg") ?? nonEmpty(it.name_en, "name_en") ?? priceError(it.price_eur) ?? allergensError(it.allergens) ??
        (typeof it.desc_bg !== "string" || typeof it.desc_en !== "string" ? "desc_bg and desc_en must be strings (may be empty)." : null) ??
        (it.is_special && it.special_expires_at !== null && !isIso(it.special_expires_at) ? 'special_expires_at must be null, "closing_today" (resolved by the tool) or ISO 8601.' : null) ??
        (it.image_media_id ? mediaError(s, it.image_media_id) : null) ??
        (op.id !== undefined && !UUIDISH.test(op.id) ? "id must be a short identifier." : null)
      );
    }
    case "update_item": {
      const item = findItem(s, op.item_id);
      if (!item) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      const keys = Object.keys(op.patch) as (keyof typeof op.patch)[];
      if (keys.length === 0) return "patch is empty.";
      for (const k of keys) {
        const v = op.patch[k];
        if (k === "price_eur") { const e = priceError(v); if (e) return e; }
        else if (k === "allergens") { const e = allergensError(v); if (e) return e; }
        else if (k === "category_id") { if (!s.categories.some((c) => c.id === v && c.active)) return `category_id "${String(v)}" not found.`; }
        else if (k === "position") { if (!Number.isInteger(v)) return "position must be an integer."; }
        else if (k === "name_bg" || k === "name_en") { const e = nonEmpty(v, k); if (e) return e; }
        else if (k === "desc_bg" || k === "desc_en") { if (typeof v !== "string") return `${k} must be a string.`; }
        else return `patch key "${String(k)}" is not editable here.`;
      }
      return null;
    }
    case "remove_item": {
      const item = findItem(s, op.item_id);
      if (!item) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      if (!item.active) return `item_id "${op.item_id}" is already removed.`;
      return null;
    }
    case "set_item_image": {
      if (!findItem(s, op.item_id)) return `item_id "${op.item_id}" not found; use an id from get_menu.`;
      return op.media_id === null ? null : mediaError(s, op.media_id);
    }
    case "set_cover_image":
    case "set_logo_image":
      return op.media_id === null ? null : mediaError(s, op.media_id);
    case "add_gallery_image": {
      const e = mediaError(s, op.media_id);
      if (e) return e;
      return findMedia(s, op.media_id)!.is_gallery ? `media_id "${op.media_id}" is already in the gallery.` : null;
    }
    case "remove_gallery_image": {
      const e = mediaError(s, op.media_id);
      if (e) return e;
      return findMedia(s, op.media_id)!.is_gallery ? null : `media_id "${op.media_id}" is not in the gallery.`;
    }
    case "set_hours":
      return isValidHours(op.hours) ? null : "hours must have mon..sun, each null or {open, close} as HH:MM with open < close.";
    case "add_holiday": {
      if (!DATE.test(op.date) || Number.isNaN(Date.parse(op.date))) return "date must be YYYY-MM-DD.";
      if (s.holidays.some((h) => h.date === op.date)) return `A holiday on ${op.date} already exists.`;
      return nonEmpty(op.note_bg, "note_bg") ?? nonEmpty(op.note_en, "note_en");
    }
    case "remove_holiday":
      return s.holidays.some((h) => h.id === op.holiday_id) ? null : `holiday_id "${op.holiday_id}" not found; use an id from get_site.`;
    case "add_announcement": {
      if (op.expires_at !== null && !isIso(op.expires_at)) return "expires_at must be null or ISO 8601 with offset.";
      return nonEmpty(op.text_bg, "text_bg") ?? nonEmpty(op.text_en, "text_en");
    }
    case "remove_announcement":
      return s.announcements.some((a) => a.id === op.announcement_id) ? null : `announcement_id "${op.announcement_id}" not found; use an id from get_site.`;
    case "set_text": {
      const keys: readonly string[] = [...SITE_TEXT_KEYS, ...VENUE_TEXT_KEYS];
      if (!keys.includes(op.key)) return `key must be one of ${keys.join(", ")}.`;
      if (typeof op.text_bg !== "string" || typeof op.text_en !== "string") return "text_bg and text_en must be strings.";
      return null;
    }
    case "set_theme":
      return HEX.test(op.accent) ? null : "accent must be a hex colour like #rrggbb.";
    default:
      return `unknown op "${(op as { op: string }).op}".`;
  }
}

function patchOf<T extends Row>(row: T, after: Row): { before: Row; after: Row } {
  const before: Row = {};
  for (const k of Object.keys(after)) before[k] = row[k] ?? null;
  return { before, after };
}

function change(position: number, op: ChangeOp, entity: Entity, entity_id: string, before: Row | null, after: Row | null): Change {
  return { position, op: op.op, entity, entity_id, before, after };
}

/** Turns an op into one entity write against `s`. Throws the validation error. */
export function planChange(s: SiteState, op: ChangeOp, ctx: PlanContext, position = 0): Change {
  const err = validateChange(s, op, ctx);
  if (err) throw new Error(err);
  const v = s.venue;
  switch (op.op) {
    case "set_price": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { price_eur: it.price_eur }, { price_eur: op.price_eur });
    }
    case "set_sold_out": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { sold_out_until: it.sold_out_until }, { sold_out_until: op.until });
    }
    case "add_item": {
      const id = op.id ?? ctx.newId();
      const inCat = s.items.filter((i) => i.category_id === op.item.category_id);
      const row: Item = {
        id, venue_id: v.id, category_id: op.item.category_id,
        name_bg: op.item.name_bg.trim(), name_en: op.item.name_en.trim(), desc_bg: op.item.desc_bg.trim(), desc_en: op.item.desc_en.trim(),
        price_eur: op.item.price_eur, allergens: [...op.item.allergens].sort((a, b) => a - b),
        image_media_id: op.item.image_media_id ?? null, sold_out_until: null,
        is_special: op.item.is_special, special_expires_at: op.item.is_special ? op.item.special_expires_at : null,
        position: inCat.length ? Math.max(...inCat.map((i) => i.position)) + 1 : 0,
        active: true, created_at: ctx.now, updated_at: ctx.now,
      };
      return change(position, op, "item", id, null, { ...row });
    }
    case "update_item": {
      const it = findItem(s, op.item_id)!;
      const after: Row = { ...op.patch };
      if (Array.isArray(after.allergens)) after.allergens = [...(after.allergens as number[])].sort((a, b) => a - b);
      const p = patchOf(it as unknown as Row, after);
      return change(position, op, "item", it.id, p.before, p.after);
    }
    case "remove_item":
      return change(position, op, "item", op.item_id, { active: true }, { active: false });
    case "set_item_image": {
      const it = findItem(s, op.item_id)!;
      return change(position, op, "item", it.id, { image_media_id: it.image_media_id }, { image_media_id: op.media_id });
    }
    case "set_cover_image":
      return change(position, op, "venue", v.id, { cover_media_id: v.cover_media_id }, { cover_media_id: op.media_id });
    case "set_logo_image":
      return change(position, op, "venue", v.id, { logo_media_id: v.logo_media_id }, { logo_media_id: op.media_id });
    case "add_gallery_image": {
      const m = findMedia(s, op.media_id)!;
      const gallery = s.media.filter((x) => x.is_gallery);
      const next = gallery.length ? Math.max(...gallery.map((x) => x.position)) + 1 : 0;
      return change(position, op, "media", m.id, { is_gallery: false, position: m.position }, { is_gallery: true, position: next });
    }
    case "remove_gallery_image": {
      const m = findMedia(s, op.media_id)!;
      return change(position, op, "media", m.id, { is_gallery: true, position: m.position }, { is_gallery: false, position: m.position });
    }
    case "set_hours":
      return change(position, op, "venue", v.id, { hours: v.hours }, { hours: op.hours });
    case "add_holiday": {
      const id = op.id ?? ctx.newId();
      const row: Holiday = { id, venue_id: v.id, date: op.date, note_bg: op.note_bg.trim(), note_en: op.note_en.trim() };
      return change(position, op, "holiday", id, null, { ...row });
    }
    case "remove_holiday": {
      const h = s.holidays.find((x) => x.id === op.holiday_id)!;
      return change(position, op, "holiday", h.id, { ...h }, null);
    }
    case "add_announcement": {
      const id = op.id ?? ctx.newId();
      const row: Announcement = { id, venue_id: v.id, text_bg: op.text_bg.trim(), text_en: op.text_en.trim(), expires_at: op.expires_at, created_at: ctx.now };
      return change(position, op, "announcement", id, null, { ...row });
    }
    case "remove_announcement": {
      const a = s.announcements.find((x) => x.id === op.announcement_id)!;
      return change(position, op, "announcement", a.id, { ...a }, null);
    }
    case "set_text": {
      const key = op.key as TextKey;
      if ((SITE_TEXT_KEYS as readonly string[]).includes(key)) {
        const existing = s.texts.find((t) => t.key === key);
        const after = { text_bg: op.text_bg, text_en: op.text_en };
        if (!existing) {
          const row: SiteText = { venue_id: v.id, key: key as SiteText["key"], ...after };
          return change(position, op, "site_text", key, null, { ...row });
        }
        return change(position, op, "site_text", key, { text_bg: existing.text_bg, text_en: existing.text_en }, after);
      }
      const after: Row = MONO_TEXT_KEYS.includes(key) ? { [key]: op.text_bg } : { [`${key}_bg`]: op.text_bg, [`${key}_en`]: op.text_en };
      const p = patchOf(v as unknown as Row, after);
      return change(position, op, "venue", v.id, p.before, p.after);
    }
    case "set_theme":
      return change(position, op, "venue", v.id, { theme: v.theme }, { theme: { accent: op.accent.toLowerCase() } });
  }
}

/** Plans ops in order against a working copy, so a later op may reference an entity an earlier one adds. */
export function planChanges(s: SiteState, ops: ChangeOp[], ctx: PlanContext): Change[] {
  const out: Change[] = [];
  let work = s;
  ops.forEach((op, i) => {
    const c = planChange(work, op, ctx, i);
    out.push(c);
    work = applyChange(work, c);
  });
  return out;
}

const clone = <T>(v: T): T => structuredClone(v);

function writeList<T extends { id: string }>(list: T[], id: string, before: Row | null, after: Row | null, what: string): T[] {
  if (after === null) return list.filter((x) => x.id !== id);
  if (before === null) {
    const row = after as unknown as T;
    return list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? clone(row) : x)) : [...list, clone(row)];
  }
  if (!list.some((x) => x.id === id)) throw new Error(`${what} ${id} not found`);
  return list.map((x) => (x.id === id ? { ...x, ...clone(after) } : x));
}

/** Pure entity write. Inserts are idempotent by id; updates merge the patch; deletes remove by id. */
export function applyChange(s: SiteState, c: Change): SiteState {
  switch (c.entity) {
    case "venue":
      if (c.after === null || c.before === null) throw new Error("venue rows are only updated");
      return { ...s, venue: { ...s.venue, ...clone(c.after) } };
    case "item":
      return { ...s, items: writeList(s.items, c.entity_id, c.before, c.after, "item") };
    case "category":
      return { ...s, categories: writeList(s.categories, c.entity_id, c.before, c.after, "category") };
    case "holiday":
      return { ...s, holidays: writeList(s.holidays, c.entity_id, c.before, c.after, "holiday") };
    case "announcement":
      return { ...s, announcements: writeList(s.announcements, c.entity_id, c.before, c.after, "announcement") };
    case "media":
      return { ...s, media: writeList(s.media, c.entity_id, c.before, c.after, "media") };
    case "site_text": {
      const key = c.entity_id;
      if (c.after === null) return { ...s, texts: s.texts.filter((t) => t.key !== key) };
      if (c.before === null) {
        const row = c.after as unknown as SiteText;
        return { ...s, texts: [...s.texts.filter((t) => t.key !== key), clone(row)] };
      }
      return { ...s, texts: s.texts.map((t) => (t.key === key ? { ...t, ...clone(c.after) } : t)) };
    }
  }
}

export function applyChanges(s: SiteState, changes: Change[]): SiteState {
  return [...changes].sort((a, b) => a.position - b.position).reduce(applyChange, s);
}

export function invertChange(c: Change): Change {
  return { ...c, before: clone(c.after), after: clone(c.before) };
}

/** Reverse order, swapped before/after, renumbered from 0. */
export function invertChanges(changes: Change[]): Change[] {
  return [...changes]
    .sort((a, b) => b.position - a.position)
    .map((c, i) => ({ ...invertChange(c), position: i }));
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/changes.test.ts`
Expected: PASS (all round trips, details and validations). If a round trip fails because `after` for `add_item` carries `updated_at` and the fixture equality differs, make sure the inverted insert is a delete (so equality holds).

- [ ] **Step 7: Commit**

```bash
git add src/domain/types.ts src/domain/changes.ts test/changes.test.ts test/fixtures.ts
git commit -m "Domain: typed change ops with validate/plan/apply/invert round trips

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Formatting, read-time effectiveness and bilingual previews

**Files:**
- Create: `src/domain/format.ts`, `src/domain/effective.ts`, `src/domain/preview.ts`
- Test: `test/preview.test.ts`

**Interfaces:**
- Consumes: `Change`, `SiteState`, `Lang` (Task 4), `formatDateTime`, `formatDate`, `hhmm` (Task 1), `allergenName` (Task 2).
- Produces: `formatPrice(eur, lang)`, `tr(lang, bg, en)`, `itemName(item, lang)`, `categoryName(cat, lang)`; `isSoldOut(item, nowMs)`, `isLiveSpecial(item, nowMs)`, `visibleItems(items, nowMs)`, `liveAnnouncements(list, nowMs)`; `renderPreview(state, changes, lang, tz): string`, `weekdayLabel(day, lang)`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/preview.test.ts
import { describe, expect, it } from "vitest";
import { planChanges, type PlanContext } from "@/src/domain/changes";
import { isLiveSpecial, isSoldOut, visibleItems } from "@/src/domain/effective";
import { formatPrice } from "@/src/domain/format";
import { renderPreview } from "@/src/domain/preview";
import { HOURS, NOW, TZ, item, state } from "./fixtures";

const ctx = (): PlanContext => ({ newId: () => "new-1", now: NOW });

describe("format", () => {
  it("prints prices per language", () => {
    expect(formatPrice(2.9, "bg")).toBe("2,90 €");
    expect(formatPrice(2.9, "en")).toBe("€2.90");
    expect(formatPrice(12, "bg")).toBe("12,00 €");
  });
});

describe("effective", () => {
  const now = Date.parse(NOW);
  it("treats an elapsed sold_out_until as available", () => {
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1, sold_out_until: "2026-10-09T08:00:00.000Z" }), now)).toBe(false);
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1, sold_out_until: "2026-10-09T10:00:00.000Z" }), now)).toBe(true);
    expect(isSoldOut(item({ id: "x", name_bg: "x", name_en: "x", price_eur: 1 }), now)).toBe(false);
  });
  it("hides expired specials and inactive items", () => {
    const live = item({ id: "s1", name_bg: "s", name_en: "s", price_eur: 1, is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" });
    const gone = item({ id: "s2", name_bg: "s", name_en: "s", price_eur: 1, is_special: true, special_expires_at: "2026-10-09T08:00:00.000Z" });
    const off = item({ id: "s3", name_bg: "s", name_en: "s", price_eur: 1, active: false });
    expect(isLiveSpecial(live, now)).toBe(true);
    expect(isLiveSpecial(gone, now)).toBe(false);
    expect(visibleItems([live, gone, off], now).map((i) => i.id)).toEqual(["s1"]);
  });
});

describe("renderPreview", () => {
  it("renders a price change in both languages", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "set_price", item_id: "i-cap", price_eur: 3.2 }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Капучино: 2,90 € → 3,20 €");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• Cappuccino: €2.90 → €3.20");
  });
  it("renders sold out with the return time and back in stock", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_sold_out", item_id: "i-ban", until: "2026-10-10T06:00:00.000Z" },
      { op: "set_sold_out", item_id: "i-cap", until: null },
    ], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Баница със сирене: изчерпано до 10.10.2026, 09:00\n• Капучино: отново в наличност");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• Cheese banitsa: sold out until 10 Oct 2026, 09:00\n• Cappuccino: back in stock");
  });
  it("renders a new item with both names, descriptions, category and allergens", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-coffee", name_bg: "Лате", name_en: "Latte", desc_bg: "С мляко", desc_en: "With milk", price_eur: 3.2, allergens: [7], is_special: false, special_expires_at: null } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Ново в „Кафе“: Лате / Latte — 3,20 €\n  BG: С мляко\n  EN: With milk\n  Алергени: 7 (Мляко)");
    expect(renderPreview(s, changes, "en", TZ)).toBe("• New in “Coffee”: Latte / Лате — €3.20\n  EN: With milk\n  BG: С мляко\n  Allergens: 7 (Milk)");
  });
  it("renders a special with its expiry", () => {
    const s = state();
    const changes = planChanges(s, [{ op: "add_item", item: { category_id: "c-pastry", name_bg: "Супа топчета", name_en: "Meatball soup", desc_bg: "", desc_en: "", price_eur: 4.5, allergens: [1, 3], is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" } }], ctx());
    expect(renderPreview(s, changes, "bg", TZ)).toBe("• Специално днес (до 18:00): Супа топчета / Meatball soup — 4,50 €\n  Алергени: 1 (Глутен), 3 (Яйца)");
  });
  it("renders hours, holidays, announcements, texts, images and theme", () => {
    const s = state();
    const changes = planChanges(s, [
      { op: "set_hours", hours: { ...HOURS, sun: { open: "10:00", close: "14:00" } } },
      { op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" },
      { op: "add_announcement", text_bg: "Весели празници!", text_en: "Happy holidays!", expires_at: null },
      { op: "set_text", key: "tagline", text_bg: "Ново мото", text_en: "New tagline" },
      { op: "set_cover_image", media_id: "m1" },
      { op: "set_theme", accent: "#aa3311" },
      { op: "remove_item", item_id: "i-esp" },
      { op: "update_item", item_id: "i-cap", patch: { name_en: "Cappuccino XL" } },
    ], ctx());
    expect(renderPreview(s, changes, "en", TZ)).toBe([
      "• Opening hours:",
      "  Mon 08:00–18:00",
      "  Tue 08:00–18:00",
      "  Wed 08:00–18:00",
      "  Thu 08:00–18:00",
      "  Fri 08:00–18:00",
      "  Sat 09:00–16:00",
      "  Sun 10:00–14:00",
      "• Holiday 24 Dec 2026: Christmas Eve / Бъдни вечер",
      "• Announcement: “Happy holidays!” / „Весели празници!“",
      "• Tagline: “Coffee on the corner” → “New tagline”",
      "  BG: „Кафе на ъгъла“ → „Ново мото“",
      "• New cover photo",
      "• Accent colour: #2f6b4f → #aa3311",
      "• Removes Espresso",
      "• Cappuccino: name (EN): “Cappuccino” → “Cappuccino XL”",
    ].join("\n"));
    expect(renderPreview(s, changes, "bg", TZ).split("\n")[0]).toBe("• Работно време:");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("  нед 10:00–14:00");
    expect(renderPreview(s, changes, "bg", TZ)).toContain("• Премахва Еспресо");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/preview.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement `src/domain/format.ts`**

```ts
// src/domain/format.ts
import type { Category, Item, Lang, Weekday } from "./types";

export function tr(lang: Lang, bg: string, en: string): string {
  return lang === "bg" ? bg : en;
}

/** "2,90 €" (bg) / "€2.90" (en). */
export function formatPrice(eur: number, lang: Lang): string {
  const fixed = eur.toFixed(2);
  return lang === "bg" ? `${fixed.replace(".", ",")} €` : `€${fixed}`;
}

export function itemName(i: Pick<Item, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? i.name_bg : i.name_en) || i.name_bg || i.name_en;
}

export function categoryName(c: Pick<Category, "name_bg" | "name_en">, lang: Lang): string {
  return (lang === "bg" ? c.name_bg : c.name_en) || c.name_bg || c.name_en;
}

const DAYS: Record<Weekday, { bg: string; en: string }> = {
  mon: { bg: "пон", en: "Mon" },
  tue: { bg: "вт", en: "Tue" },
  wed: { bg: "ср", en: "Wed" },
  thu: { bg: "четв", en: "Thu" },
  fri: { bg: "пет", en: "Fri" },
  sat: { bg: "съб", en: "Sat" },
  sun: { bg: "нед", en: "Sun" },
};
export function weekdayLabel(day: Weekday, lang: Lang): string {
  return DAYS[day][lang];
}

/** Typographic quotes per language. */
export function quote(text: string, lang: Lang): string {
  return lang === "bg" ? `„${text}“` : `“${text}”`;
}
```

- [ ] **Step 4: Implement `src/domain/effective.ts`**

```ts
// src/domain/effective.ts
import type { Announcement, Item } from "./types";

/** Read-time truth: an elapsed sold_out_until means available, no tick needed. */
export function isSoldOut(item: Pick<Item, "sold_out_until">, nowMs: number): boolean {
  return item.sold_out_until !== null && Date.parse(item.sold_out_until) > nowMs;
}

export function isLiveSpecial(item: Pick<Item, "is_special" | "special_expires_at" | "active">, nowMs: number): boolean {
  if (!item.is_special || !item.active) return false;
  return item.special_expires_at === null || Date.parse(item.special_expires_at) > nowMs;
}

/** Active items; specials only while live. */
export function visibleItems<T extends Pick<Item, "is_special" | "special_expires_at" | "active">>(items: T[], nowMs: number): T[] {
  return items.filter((i) => i.active && (!i.is_special || isLiveSpecial(i, nowMs)));
}

export function liveAnnouncements<T extends Pick<Announcement, "expires_at">>(list: T[], nowMs: number): T[] {
  return list.filter((a) => a.expires_at === null || Date.parse(a.expires_at) > nowMs);
}
```

- [ ] **Step 5: Implement `src/domain/preview.ts`**

```ts
// src/domain/preview.ts
import { formatDate, formatDateTime, hhmm, localTime } from "../time";
import { allergenName } from "./allergens";
import { categoryName, formatPrice, itemName, quote, tr, weekdayLabel } from "./format";
import { WEEKDAYS, type Change, type Item, type Lang, type SiteState, type WeekHours } from "./types";

const FIELD: Record<string, { bg: string; en: string }> = {
  name_bg: { bg: "име (BG)", en: "name (BG)" },
  name_en: { bg: "име (EN)", en: "name (EN)" },
  desc_bg: { bg: "описание (BG)", en: "description (BG)" },
  desc_en: { bg: "описание (EN)", en: "description (EN)" },
  price_eur: { bg: "цена", en: "price" },
  allergens: { bg: "алергени", en: "allergens" },
  category_id: { bg: "категория", en: "category" },
  position: { bg: "позиция", en: "position" },
};
const TEXT_LABEL: Record<string, { bg: string; en: string }> = {
  welcome: { bg: "Приветствие", en: "Welcome text" },
  footer_note: { bg: "Бележка в долния край", en: "Footer note" },
  tagline: { bg: "Мото", en: "Tagline" },
  about: { bg: "За нас", en: "About" },
  address: { bg: "Адрес", en: "Address" },
  phone: { bg: "Телефон", en: "Phone" },
  maps_url: { bg: "Линк към картата", en: "Map link" },
  instagram: { bg: "Instagram", en: "Instagram" },
};

function allergenLine(codes: number[], lang: Lang): string {
  if (codes.length === 0) return tr(lang, "  Алергени: няма", "  Allergens: none");
  return `  ${tr(lang, "Алергени", "Allergens")}: ${codes.map((c) => `${c} (${allergenName(c, lang)})`).join(", ")}`;
}

function hoursLines(h: WeekHours, lang: Lang): string[] {
  return WEEKDAYS.map((d) => {
    const v = h[d];
    return `  ${weekdayLabel(d, lang)} ${v ? `${hhmm(v.open)}–${hhmm(v.close)}` : tr(lang, "почивен ден", "closed")}`;
  });
}

function fieldValue(key: string, v: unknown, s: SiteState, lang: Lang): string {
  if (v === null || v === undefined) return "—";
  if (key === "price_eur") return formatPrice(Number(v), lang);
  if (key === "allergens") return (v as number[]).join(", ") || tr(lang, "няма", "none");
  if (key === "category_id") {
    const c = s.categories.find((x) => x.id === v);
    return c ? categoryName(c, lang) : String(v);
  }
  return quote(String(v), lang);
}

/** One line (sometimes more) per change, in the reader's language, from the state the changes were planned against. */
export function renderPreview(s: SiteState, changes: Change[], lang: Lang, tz: string): string {
  const other: Lang = lang === "bg" ? "en" : "bg";
  const lines: string[] = [];
  const itemOf = (c: Change): Item | undefined => s.items.find((i) => i.id === c.entity_id) ?? (c.after as unknown as Item | null) ?? undefined;
  for (const c of [...changes].sort((a, b) => a.position - b.position)) {
    const b = c.before ?? {};
    const a = c.after ?? {};
    switch (c.op) {
      case "set_price": {
        const it = itemOf(c)!;
        lines.push(`• ${itemName(it, lang)}: ${formatPrice(Number(b.price_eur), lang)} → ${formatPrice(Number(a.price_eur), lang)}`);
        break;
      }
      case "set_sold_out": {
        const it = itemOf(c)!;
        const until = a.sold_out_until as string | null;
        lines.push(until
          ? `• ${itemName(it, lang)}: ${tr(lang, "изчерпано до", "sold out until")} ${formatDateTime(until, lang, tz)}`
          : `• ${itemName(it, lang)}: ${tr(lang, "отново в наличност", "back in stock")}`);
        break;
      }
      case "add_item": {
        const it = c.after as unknown as Item;
        const cat = s.categories.find((x) => x.id === it.category_id);
        const names = `${itemName(it, lang)} / ${itemName(it, other)}`;
        const head = it.is_special
          ? `• ${tr(lang, "Специално днес", "Today's special")}${it.special_expires_at ? ` (${tr(lang, "до", "until")} ${localTime(new Date(it.special_expires_at), tz)})` : ""}: ${names} — ${formatPrice(it.price_eur, lang)}`
          : `• ${tr(lang, "Ново в", "New in")} ${quote(cat ? categoryName(cat, lang) : "?", lang)}: ${names} — ${formatPrice(it.price_eur, lang)}`;
        lines.push(head);
        const descs: [Lang, string][] = [[lang, lang === "bg" ? it.desc_bg : it.desc_en], [other, other === "bg" ? it.desc_bg : it.desc_en]];
        for (const [l, d] of descs) if (d) lines.push(`  ${l.toUpperCase()}: ${d}`);
        lines.push(allergenLine(it.allergens, lang));
        break;
      }
      case "update_item": {
        const it = itemOf(c)!;
        for (const k of Object.keys(a)) {
          const label = FIELD[k]?.[lang] ?? k;
          lines.push(`• ${itemName(it, lang)}: ${label}: ${fieldValue(k, b[k], s, lang)} → ${fieldValue(k, a[k], s, lang)}`);
        }
        break;
      }
      case "remove_item": {
        const it = itemOf(c)!;
        lines.push(`• ${tr(lang, "Премахва", "Removes")} ${itemName(it, lang)}`);
        break;
      }
      case "set_item_image": {
        const it = itemOf(c)!;
        lines.push(a.image_media_id ? `• ${tr(lang, "Нова снимка за", "New photo for")} ${itemName(it, lang)}` : `• ${tr(lang, "Премахва снимката на", "Removes the photo of")} ${itemName(it, lang)}`);
        break;
      }
      case "set_cover_image":
        lines.push(a.cover_media_id ? tr(lang, "• Нова корица", "• New cover photo") : tr(lang, "• Премахва корицата", "• Removes the cover photo"));
        break;
      case "set_logo_image":
        lines.push(a.logo_media_id ? tr(lang, "• Ново лого", "• New logo") : tr(lang, "• Премахва логото", "• Removes the logo"));
        break;
      case "add_gallery_image":
        lines.push(tr(lang, "• Добавя снимка в галерията", "• Adds a photo to the gallery"));
        break;
      case "remove_gallery_image":
        lines.push(tr(lang, "• Премахва снимка от галерията", "• Removes a photo from the gallery"));
        break;
      case "set_hours":
        lines.push(tr(lang, "• Работно време:", "• Opening hours:"), ...hoursLines(a.hours as WeekHours, lang));
        break;
      case "add_holiday": {
        const h = c.after!;
        lines.push(`• ${tr(lang, "Почивен ден", "Holiday")} ${formatDate(String(h.date), lang)}: ${String(h[`note_${lang}`])} / ${String(h[`note_${other}`])}`);
        break;
      }
      case "remove_holiday": {
        const h = c.before!;
        lines.push(`• ${tr(lang, "Премахва почивния ден", "Removes the holiday on")} ${formatDate(String(h.date), lang)}`);
        break;
      }
      case "add_announcement": {
        const an = c.after!;
        const exp = an.expires_at ? ` (${tr(lang, "до", "until")} ${formatDateTime(String(an.expires_at), lang, tz)})` : "";
        lines.push(`• ${tr(lang, "Съобщение", "Announcement")}: ${quote(String(an[`text_${lang}`]), lang)} / ${quote(String(an[`text_${other}`]), other)}${exp}`);
        break;
      }
      case "remove_announcement": {
        const an = c.before!;
        lines.push(`• ${tr(lang, "Премахва съобщението", "Removes the announcement")} ${quote(String(an[`text_${lang}`]), lang)}`);
        break;
      }
      case "set_text": {
        const key = c.entity === "site_text" ? c.entity_id : Object.keys(a)[0].replace(/_(bg|en)$/, "");
        const label = TEXT_LABEL[key]?.[lang] ?? key;
        const pick = (row: Record<string, unknown>, l: Lang) => row[`text_${l}`] ?? row[`${key}_${l}`] ?? row[key];
        const bv = pick(b, lang), av = pick(a, lang);
        lines.push(`• ${label}: ${bv === undefined || bv === null ? "—" : quote(String(bv), lang)} → ${quote(String(av ?? ""), lang)}`);
        const bo = pick(b, other), ao = pick(a, other);
        if (ao !== undefined && ao !== null && ao !== av) {
          lines.push(`  ${other.toUpperCase()}: ${bo === undefined || bo === null ? "—" : quote(String(bo), other)} → ${quote(String(ao), other)}`);
        }
        break;
      }
      case "set_theme":
        lines.push(`• ${tr(lang, "Цвят на темата", "Accent colour")}: ${(b.theme as { accent: string } | undefined)?.accent ?? "—"} → ${(a.theme as { accent: string }).accent}`);
        break;
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/preview.test.ts`
Expected: PASS. The exact strings in the tests are the contract; adjust the implementation, not the tests, unless `formatDateTime`'s `en` output differs by ICU (then align both to the real Intl output in Task 1's test too).

- [ ] **Step 7: Commit**

```bash
git add src/domain/format.ts src/domain/effective.ts src/domain/preview.ts test/preview.test.ts
git commit -m "Domain: price formatting, read-time effectiveness and bilingual change previews

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Store interface, in-memory store and the demo seed

**Files:**
- Create: `src/store/types.ts`, `src/store/memory.ts`, `src/seed/demo.ts`
- Test: `test/store-contract.ts` (shared contract, no tests of its own), `test/store-memory.test.ts`, `test/helpers.ts`

**Interfaces:**
- Consumes: Task 4 types and `applyChanges`.
- Produces: `Store` (below), `InMemoryStore`, `NewVenue`, `NewCategory`, `NewItem`, `NewChangeSet`, `ChangeSetPatch`, `ExpiredTimer`, `DEFAULT_HOURS`, `newToken()`, `newInviteCode()`, `seedDemo(store)`, `DEMO_VENUE`, test helper `makeDemo()`.

- [ ] **Step 1: Write `src/store/types.ts`**

```ts
// src/store/types.ts
import type {
  Category, Change, ChangeSet, ChangeSetStatus, ChangeSource, Conversation, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, Venue, WeekHours,
} from "../domain/types";

export const DEFAULT_HOURS: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};

export interface NewVenue {
  slug: string;
  name: string;
  tagline_bg?: string;
  tagline_en?: string;
  about_bg?: string;
  about_en?: string;
  address?: string;
  phone?: string;
  maps_url?: string;
  instagram?: string;
  hours?: WeekHours;
  tz?: string;
  default_lang?: Lang;
  theme?: { accent: string };
}
export interface NewCategory {
  venue_id: string;
  name_bg: string;
  name_en: string;
  position: number;
}
export interface NewItem {
  venue_id: string;
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  position: number;
  is_special?: boolean;
  special_expires_at?: string | null;
  image_media_id?: string | null;
}
export interface NewChangeSet {
  venue_id: string;
  chat_id: number | null;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  source: ChangeSource;
  status: "proposed" | "scheduled";
  apply_at?: string | null;
  undoes_id?: string | null;
  tg_message_id?: number | null;
  changes: Change[];
}
export type ChangeSetPatch = Partial<Pick<ChangeSet, "status" | "apply_at" | "reminded_at" | "decided_at" | "applied_at" | "reverted_by" | "tg_message_id" | "preview_bg" | "preview_en">>;

export interface ExpiredTimer {
  item: Item;
  kind: "sold_out" | "special";
}

export interface Store {
  // venues
  createVenue(v: NewVenue): Promise<Venue>;
  getVenue(id: string): Promise<Venue>;
  getVenueBySlug(slug: string): Promise<Venue | null>;
  listVenues(): Promise<Venue[]>;
  /** Everything for one venue, including inactive items (the site filters with domain/effective). */
  getSite(venueId: string): Promise<SiteState>;
  insertCategory(c: NewCategory): Promise<Category>;
  insertItem(i: NewItem): Promise<Item>;
  setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string): Promise<void>;
  /** Deletes the venue's menu, texts, holidays, announcements, media rows and change sets (demo reset). Members, invites and tokens stay. */
  clearVenueContent(venueId: string): Promise<void>;

  // members and access
  findMember(chatId: number): Promise<Member | null>;
  upsertMember(m: Omit<Member, "created_at">): Promise<Member>;
  setMemberLang(venueId: string, chatId: number, lang: Lang): Promise<void>;
  createInvite(venueId: string, role: Role, expiresAt: string): Promise<string>;
  /** Links the chat and marks the code used; null when the code is unknown, used or expired. */
  redeemInvite(code: string, chatId: number, lang: Lang, now: string): Promise<Member | null>;
  /** Creates the token on first call. */
  getAdminToken(venueId: string): Promise<string>;
  findVenueByAdminToken(token: string): Promise<Venue | null>;

  // change sets
  createChangeSet(cs: NewChangeSet): Promise<ChangeSet>;
  getChangeSet(id: string): Promise<ChangeSet>;
  findProposed(venueId: string, chatId: number): Promise<ChangeSet | null>;
  /** Newest first. */
  listChangeSets(venueId: string, opts?: { status?: ChangeSetStatus[]; limit?: number }): Promise<ChangeSet[]>;
  /** Scheduled sets with apply_at <= now (oldest first). */
  listDue(now: string, venueId?: string): Promise<ChangeSet[]>;
  /** Scheduled, not yet reminded, apply_at in (now, until]. */
  listUpcoming(now: string, until: string, venueId?: string): Promise<ChangeSet[]>;
  /** Proposed sets created before the cutoff. */
  listProposedBefore(cutoff: string, venueId?: string): Promise<ChangeSet[]>;
  updateChangeSet(id: string, patch: ChangeSetPatch): Promise<void>;
  /**
   * Writes every change and marks the set applied, only if it is still proposed or scheduled.
   * For an undo set, also marks the target reverted. Returns "skipped" when already decided.
   */
  applyChangeSet(id: string, now: string): Promise<"applied" | "skipped">;
  listExpiredTimers(now: string, venueId?: string): Promise<ExpiredTimer[]>;

  // media
  saveMedia(venueId: string, bytes: Uint8Array, contentType: string): Promise<Media>;
  getMedia(id: string): Promise<Media | null>;

  // conversations
  getConversation(venueId: string, chatId: number): Promise<Conversation | null>;
  setConversation(venueId: string, chatId: number, c: Conversation): Promise<void>;
}

export function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function extensionFor(contentType: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[contentType] ?? "bin";
}
```

- [ ] **Step 2: Write the shared store contract**

```ts
// test/store-contract.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import type { Store } from "@/src/store/types";
import { NOW } from "./fixtures";

const LATER = "2026-10-09T10:00:00.000Z";
const ctx = { newId: () => crypto.randomUUID(), now: NOW };

/** Behaviour every Store must have. Call with a factory that yields an empty store. */
export function storeContract(name: string, make: () => Promise<Store>) {
  describe(`${name} store`, () => {
    it("creates a venue with defaults and reads it back by id and slug", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t1", name: "Test" });
      expect(v).toMatchObject({ slug: "t1", name: "Test", tz: "Europe/Sofia", default_lang: "bg", theme: { accent: "#2f6b4f" } });
      expect(v.hours.mon).toEqual({ open: "08:00", close: "18:00" });
      expect(await s.getVenueBySlug("t1")).toEqual(v);
      expect(await s.getVenueBySlug("nope")).toBeNull();
      expect((await s.listVenues()).map((x) => x.id)).toContain(v.id);
    });

    it("seeds categories, items and texts into the site state", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t2", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      await s.setSiteText(v.id, "welcome", "Добре дошли", "Welcome");
      await s.setSiteText(v.id, "welcome", "Здравейте", "Hello");
      const site = await s.getSite(v.id);
      expect(site.categories).toEqual([c]);
      expect(site.items).toEqual([i]);
      expect(site.texts).toEqual([{ venue_id: v.id, key: "welcome", text_bg: "Здравейте", text_en: "Hello" }]);
      expect(i).toMatchObject({ active: true, sold_out_until: null, is_special: false, price_eur: 1.8 });
    });

    it("links members through invites and tokens", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t3", name: "Test" });
      const code = await s.createInvite(v.id, "owner", LATER);
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(await s.redeemInvite("WRONGCOD", 10, "bg", NOW)).toBeNull();
      const m = await s.redeemInvite(code, 10, "en", NOW);
      expect(m).toMatchObject({ venue_id: v.id, tg_chat_id: 10, role: "owner", lang: "en" });
      expect(await s.redeemInvite(code, 11, "bg", NOW)).toBeNull(); // used
      const expired = await s.createInvite(v.id, "staff", NOW);
      expect(await s.redeemInvite(expired, 12, "bg", LATER)).toBeNull();
      expect(await s.findMember(10)).toMatchObject({ role: "owner", lang: "en" });
      await s.setMemberLang(v.id, 10, "bg");
      expect((await s.findMember(10))?.lang).toBe("bg");
      expect(await s.findMember(99)).toBeNull();
      const token = await s.getAdminToken(v.id);
      expect(token.length).toBeGreaterThanOrEqual(32);
      expect(await s.getAdminToken(v.id)).toBe(token);
      expect((await s.findVenueByAdminToken(token))?.id).toBe(v.id);
      expect(await s.findVenueByAdminToken("x".repeat(32))).toBeNull();
    });

    it("creates, lists, applies and skips change sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t4", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const site = await s.getSite(v.id);
      const changes = planChanges(site, [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      expect(cs).toMatchObject({ status: "proposed", source: "text", chat_id: 10, apply_at: null, undoes_id: null });
      expect(cs.changes).toHaveLength(1);
      expect(cs.changes[0]).toMatchObject({ op: "set_price", entity: "item", entity_id: i.id, before: { price_eur: 1.8 }, after: { price_eur: 2 } });
      expect((await s.findProposed(v.id, 10))?.id).toBe(cs.id);
      expect(await s.findProposed(v.id, 11)).toBeNull();

      expect(await s.applyChangeSet(cs.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      const after = await s.getChangeSet(cs.id);
      expect(after).toMatchObject({ status: "applied", applied_at: LATER });
      expect(await s.applyChangeSet(cs.id, LATER)).toBe("skipped");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(2);
      expect(await s.findProposed(v.id, 10)).toBeNull();
      expect((await s.listChangeSets(v.id, { status: ["applied"] })).map((x) => x.id)).toEqual([cs.id]);
      expect(await s.listChangeSets(v.id, { status: ["proposed"] })).toEqual([]);
    });

    it("applies an undo set and marks the target reverted", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t5", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const i = await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "", desc_en: "", price_eur: 1.8, allergens: [], position: 0 });
      const changes = planChanges(await s.getSite(v.id), [{ op: "set_price", item_id: i.id, price_eur: 2 }], ctx);
      const cs = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Цена", summary_en: "Price", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
      await s.applyChangeSet(cs.id, NOW);
      const undo = await s.createChangeSet({ venue_id: v.id, chat_id: 10, summary_bg: "Отмяна", summary_en: "Undo", preview_bg: "u", preview_en: "u", source: "undo", status: "proposed", undoes_id: cs.id, changes: [{ ...changes[0], before: changes[0].after, after: changes[0].before }] });
      expect(await s.applyChangeSet(undo.id, LATER)).toBe("applied");
      expect((await s.getSite(v.id)).items[0].price_eur).toBe(1.8);
      expect(await s.getChangeSet(cs.id)).toMatchObject({ status: "reverted", reverted_by: undo.id });
    });

    it("finds due, upcoming and stale sets", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t6", name: "Test" });
      const base = { venue_id: v.id, chat_id: 10, summary_bg: "x", summary_en: "x", preview_bg: "x", preview_en: "x", source: "text" as const, changes: [] };
      const due = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-09T09:30:00.000Z" });
      const soon = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-10T08:00:00.000Z" });
      const far = await s.createChangeSet({ ...base, status: "scheduled", apply_at: "2026-10-20T08:00:00.000Z" });
      const proposed = await s.createChangeSet({ ...base, status: "proposed" });
      expect((await s.listDue(LATER)).map((x) => x.id)).toEqual([due.id]);
      expect((await s.listDue(LATER, "other-venue"))).toEqual([]);
      expect((await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z")).map((x) => x.id)).toEqual([soon.id]);
      await s.updateChangeSet(soon.id, { reminded_at: LATER });
      expect(await s.listUpcoming(LATER, "2026-10-10T10:00:00.000Z")).toEqual([]);
      expect(far.status).toBe("scheduled");
      expect((await s.listProposedBefore("2027-01-01T00:00:00.000Z")).map((x) => x.id)).toEqual([proposed.id]);
      expect(await s.listProposedBefore("2020-01-01T00:00:00.000Z")).toEqual([]);
    });

    it("lists expired sold-out and special timers", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t7", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      const mk = (name: string, extra: Partial<Parameters<Store["insertItem"]>[0]>) =>
        s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: name, name_en: name, desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0, ...extra });
      const a = await mk("a", {});
      await s.createChangeSet({ venue_id: v.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [{ position: 0, op: "set_sold_out", entity: "item", entity_id: a.id, before: { sold_out_until: null }, after: { sold_out_until: "2026-10-09T09:30:00.000Z" } }] }).then((cs) => s.applyChangeSet(cs.id, NOW));
      const sp = await mk("special", { is_special: true, special_expires_at: "2026-10-09T09:45:00.000Z" });
      await mk("live special", { is_special: true, special_expires_at: "2026-10-09T15:00:00.000Z" });
      const timers = await s.listExpiredTimers(LATER);
      expect(timers.map((t) => [t.item.id, t.kind])).toEqual(expect.arrayContaining([[a.id, "sold_out"], [sp.id, "special"]]));
      expect(timers).toHaveLength(2);
      expect(await s.listExpiredTimers(NOW)).toEqual([]);
    });

    it("stores media and conversations", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t8", name: "Test" });
      const m = await s.saveMedia(v.id, new Uint8Array([1, 2, 3]), "image/jpeg");
      expect(m).toMatchObject({ venue_id: v.id, is_gallery: false });
      expect(m.storage_path).toMatch(new RegExp(`^${v.id}/[0-9a-f-]{36}\\.jpg$`));
      expect(m.public_url).toContain(m.storage_path);
      expect(await s.getMedia(m.id)).toEqual(m);
      expect((await s.getSite(v.id)).media).toEqual([m]);
      expect(await s.getConversation(v.id, 10)).toBeNull();
      const conv = { turns: [{ at: NOW, owner: "hi", agent: "hello" }], correction_for: null, updated_at: NOW };
      await s.setConversation(v.id, 10, conv);
      expect(await s.getConversation(v.id, 10)).toEqual(conv);
    });

    it("clears venue content but keeps members", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t9", name: "Test" });
      const c = await s.insertCategory({ venue_id: v.id, name_bg: "Кафе", name_en: "Coffee", position: 0 });
      await s.insertItem({ venue_id: v.id, category_id: c.id, name_bg: "x", name_en: "x", desc_bg: "", desc_en: "", price_eur: 1, allergens: [], position: 0 });
      await s.upsertMember({ venue_id: v.id, tg_chat_id: 10, role: "owner", lang: "bg" });
      await s.clearVenueContent(v.id);
      const site = await s.getSite(v.id);
      expect(site.items).toEqual([]);
      expect(site.categories).toEqual([]);
      expect(await s.findMember(10)).not.toBeNull();
    });
  });
}
```

- [ ] **Step 3: Write the memory test and the helper**

```ts
// test/store-memory.test.ts
import { InMemoryStore } from "@/src/store/memory";
import { storeContract } from "./store-contract";

storeContract("memory", async () => new InMemoryStore());
```

```ts
// test/helpers.ts
import { seedDemo } from "@/src/seed/demo";
import { InMemoryStore } from "@/src/store/memory";
import type { Category, Item, Venue } from "@/src/domain/types";

export interface Demo {
  store: InMemoryStore;
  venue: Venue;
  categories: Record<string, Category>; // by name_en
  items: Record<string, Item>; // by name_en
}

/** A memory store with the demo venue and an owner (chat 1001, bg) and a staff member (chat 1002, en). */
export async function makeDemo(): Promise<Demo> {
  const store = new InMemoryStore();
  const seeded = await seedDemo(store);
  await store.upsertMember({ venue_id: seeded.venue.id, tg_chat_id: 1001, role: "owner", lang: "bg" });
  await store.upsertMember({ venue_id: seeded.venue.id, tg_chat_id: 1002, role: "staff", lang: "en" });
  return {
    store,
    venue: seeded.venue,
    categories: Object.fromEntries(seeded.categories.map((c) => [c.name_en, c])),
    items: Object.fromEntries(seeded.items.map((i) => [i.name_en, i])),
  };
}
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run test/store-memory.test.ts` → FAIL (module not found).

- [ ] **Step 5: Implement `src/store/memory.ts`**

```ts
// src/store/memory.ts
import { applyChanges } from "../domain/changes";
import type { Category, ChangeSet, Conversation, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, Venue } from "../domain/types";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store } from "./types";

const clone = <T>(v: T): T => structuredClone(v);

interface Invite {
  code: string;
  venue_id: string;
  role: Role;
  expires_at: string;
  used_at: string | null;
}

export class InMemoryStore implements Store {
  sites = new Map<string, SiteState>();
  members = new Map<number, Member>(); // one venue per chat
  invites = new Map<string, Invite>();
  tokens = new Map<string, string>(); // venue id -> token
  sets = new Map<string, ChangeSet>();
  conversations = new Map<string, Conversation>();
  files = new Map<string, Uint8Array>();
  /** Fixed clock for created_at; tests may override. */
  clock: () => string = () => new Date().toISOString();

  private site(id: string): SiteState {
    const s = this.sites.get(id);
    if (!s) throw new Error(`venue ${id} not found`);
    return s;
  }

  async createVenue(v: NewVenue): Promise<Venue> {
    const venue: Venue = {
      id: crypto.randomUUID(),
      slug: v.slug,
      name: v.name,
      tagline_bg: v.tagline_bg ?? "",
      tagline_en: v.tagline_en ?? "",
      about_bg: v.about_bg ?? "",
      about_en: v.about_en ?? "",
      address: v.address ?? "",
      phone: v.phone ?? "",
      maps_url: v.maps_url ?? "",
      instagram: v.instagram ?? "",
      cover_media_id: null,
      logo_media_id: null,
      hours: clone(v.hours ?? DEFAULT_HOURS),
      tz: v.tz ?? "Europe/Sofia",
      default_lang: v.default_lang ?? "bg",
      theme: clone(v.theme ?? { accent: "#2f6b4f" }),
      created_at: this.clock(),
    };
    if ([...this.sites.values()].some((s) => s.venue.slug === venue.slug)) throw new Error(`slug ${venue.slug} already exists`);
    this.sites.set(venue.id, { venue, categories: [], items: [], holidays: [], announcements: [], media: [], texts: [] });
    return clone(venue);
  }
  async getVenue(id: string) {
    return clone(this.site(id).venue);
  }
  async getVenueBySlug(slug: string) {
    const s = [...this.sites.values()].find((x) => x.venue.slug === slug);
    return s ? clone(s.venue) : null;
  }
  async listVenues() {
    return [...this.sites.values()].map((s) => clone(s.venue));
  }
  async getSite(venueId: string) {
    return clone(this.site(venueId));
  }
  async insertCategory(c: NewCategory): Promise<Category> {
    const row: Category = { id: crypto.randomUUID(), active: true, ...c };
    this.site(c.venue_id).categories.push(row);
    return clone(row);
  }
  async insertItem(i: NewItem): Promise<Item> {
    const now = this.clock();
    const row: Item = {
      id: crypto.randomUUID(),
      venue_id: i.venue_id,
      category_id: i.category_id,
      name_bg: i.name_bg,
      name_en: i.name_en,
      desc_bg: i.desc_bg,
      desc_en: i.desc_en,
      price_eur: i.price_eur,
      allergens: [...i.allergens],
      image_media_id: i.image_media_id ?? null,
      sold_out_until: null,
      is_special: i.is_special ?? false,
      special_expires_at: i.special_expires_at ?? null,
      position: i.position,
      active: true,
      created_at: now,
      updated_at: now,
    };
    this.site(i.venue_id).items.push(row);
    return clone(row);
  }
  async setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string) {
    const s = this.site(venueId);
    const existing = s.texts.find((t) => t.key === key);
    if (existing) Object.assign(existing, { text_bg, text_en });
    else s.texts.push({ venue_id: venueId, key, text_bg, text_en });
  }
  async clearVenueContent(venueId: string) {
    const s = this.site(venueId);
    s.categories = [];
    s.items = [];
    s.holidays = [];
    s.announcements = [];
    s.media = [];
    s.texts = [];
    for (const [id, cs] of this.sets) if (cs.venue_id === venueId) this.sets.delete(id);
    for (const key of [...this.conversations.keys()]) if (key.startsWith(`${venueId}:`)) this.conversations.delete(key);
  }

  async findMember(chatId: number) {
    const m = this.members.get(chatId);
    return m ? clone(m) : null;
  }
  async upsertMember(m: Omit<Member, "created_at">) {
    const row: Member = { ...m, created_at: this.members.get(m.tg_chat_id)?.created_at ?? this.clock() };
    this.members.set(m.tg_chat_id, row);
    return clone(row);
  }
  async setMemberLang(venueId: string, chatId: number, lang: Lang) {
    const m = this.members.get(chatId);
    if (!m || m.venue_id !== venueId) throw new Error(`member ${chatId} not found`);
    m.lang = lang;
  }
  async createInvite(venueId: string, role: Role, expiresAt: string) {
    this.site(venueId);
    const code = newInviteCode();
    this.invites.set(code, { code, venue_id: venueId, role, expires_at: expiresAt, used_at: null });
    return code;
  }
  async redeemInvite(code: string, chatId: number, lang: Lang, now: string) {
    const inv = this.invites.get(code);
    if (!inv || inv.used_at !== null || Date.parse(inv.expires_at) <= Date.parse(now)) return null;
    inv.used_at = now;
    return this.upsertMember({ venue_id: inv.venue_id, tg_chat_id: chatId, role: inv.role, lang });
  }
  async getAdminToken(venueId: string) {
    this.site(venueId);
    let t = this.tokens.get(venueId);
    if (!t) {
      t = newToken();
      this.tokens.set(venueId, t);
    }
    return t;
  }
  async findVenueByAdminToken(token: string) {
    for (const [venueId, t] of this.tokens) if (t === token) return this.getVenue(venueId);
    return null;
  }

  async createChangeSet(cs: NewChangeSet): Promise<ChangeSet> {
    this.site(cs.venue_id);
    const row: ChangeSet = {
      id: crypto.randomUUID(),
      venue_id: cs.venue_id,
      chat_id: cs.chat_id,
      summary_bg: cs.summary_bg,
      summary_en: cs.summary_en,
      preview_bg: cs.preview_bg,
      preview_en: cs.preview_en,
      source: cs.source,
      status: cs.status,
      apply_at: cs.apply_at ?? null,
      reminded_at: null,
      decided_at: null,
      applied_at: null,
      reverted_by: null,
      undoes_id: cs.undoes_id ?? null,
      tg_message_id: cs.tg_message_id ?? null,
      created_at: this.clock(),
      changes: clone(cs.changes).map((c, i) => ({ ...c, position: i })),
    };
    this.sets.set(row.id, row);
    return clone(row);
  }
  async getChangeSet(id: string) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    return clone(cs);
  }
  async findProposed(venueId: string, chatId: number) {
    const cs = [...this.sets.values()].find((x) => x.venue_id === venueId && x.chat_id === chatId && x.status === "proposed");
    return cs ? clone(cs) : null;
  }
  async listChangeSets(venueId: string, opts: { status?: ChangeSet["status"][]; limit?: number } = {}) {
    return [...this.sets.values()]
      .filter((x) => x.venue_id === venueId && (!opts.status || opts.status.includes(x.status)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, opts.limit ?? 50)
      .map(clone);
  }
  async listDue(now: string, venueId?: string) {
    return [...this.sets.values()]
      .filter((x) => x.status === "scheduled" && x.apply_at !== null && x.apply_at <= now && (!venueId || x.venue_id === venueId))
      .sort((a, b) => (a.apply_at as string).localeCompare(b.apply_at as string))
      .map(clone);
  }
  async listUpcoming(now: string, until: string, venueId?: string) {
    return [...this.sets.values()]
      .filter((x) => x.status === "scheduled" && x.reminded_at === null && x.apply_at !== null && x.apply_at > now && x.apply_at <= until && (!venueId || x.venue_id === venueId))
      .map(clone);
  }
  async listProposedBefore(cutoff: string, venueId?: string) {
    return [...this.sets.values()].filter((x) => x.status === "proposed" && x.created_at < cutoff && (!venueId || x.venue_id === venueId)).map(clone);
  }
  async updateChangeSet(id: string, patch: ChangeSetPatch) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cs as unknown as Record<string, unknown>)[k] = v;
  }
  async applyChangeSet(id: string, now: string) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    if (cs.status !== "proposed" && cs.status !== "scheduled") return "skipped";
    const site = this.site(cs.venue_id);
    this.sites.set(cs.venue_id, applyChanges(site, cs.changes));
    cs.status = "applied";
    cs.applied_at = now;
    cs.decided_at ??= now;
    if (cs.undoes_id) {
      const target = this.sets.get(cs.undoes_id);
      if (target && target.status === "applied") {
        target.status = "reverted";
        target.reverted_by = cs.id;
      }
    }
    return "applied";
  }
  async listExpiredTimers(now: string, venueId?: string) {
    const out: ExpiredTimer[] = [];
    for (const s of this.sites.values()) {
      if (venueId && s.venue.id !== venueId) continue;
      for (const i of s.items) {
        if (i.sold_out_until !== null && i.sold_out_until <= now) out.push({ item: clone(i), kind: "sold_out" });
        if (i.is_special && i.active && i.special_expires_at !== null && i.special_expires_at <= now) out.push({ item: clone(i), kind: "special" });
      }
    }
    return out;
  }

  async saveMedia(venueId: string, bytes: Uint8Array, contentType: string): Promise<Media> {
    const s = this.site(venueId);
    const id = crypto.randomUUID();
    const path = `${venueId}/${id}.${extensionFor(contentType)}`;
    this.files.set(path, bytes);
    const row: Media = { id, venue_id: venueId, storage_path: path, public_url: `memory://media/${path}`, is_gallery: false, position: 0, created_at: this.clock() };
    s.media.push(row);
    return clone(row);
  }
  async getMedia(id: string) {
    for (const s of this.sites.values()) {
      const m = s.media.find((x) => x.id === id);
      if (m) return clone(m);
    }
    return null;
  }

  async getConversation(venueId: string, chatId: number) {
    const c = this.conversations.get(`${venueId}:${chatId}`);
    return c ? clone(c) : null;
  }
  async setConversation(venueId: string, chatId: number, c: Conversation) {
    this.conversations.set(`${venueId}:${chatId}`, clone(c));
  }
}
```

- [ ] **Step 6: Implement the demo seed `src/seed/demo.ts`**

```ts
// src/seed/demo.ts
import type { Category, Item, Venue } from "../domain/types";
import { DEFAULT_HOURS, type NewVenue, type Store } from "../store/types";

export const DEMO_SLUG = "agala";

export const DEMO_VENUE: NewVenue = {
  slug: DEMO_SLUG,
  name: "Кафене „Ъгъла“",
  tagline_bg: "Кафе, закуски и спокойствие на ъгъла на „Раковски“.",
  tagline_en: "Coffee, pastries and a quiet corner on Rakovski street.",
  about_bg:
    "Малко квартално кафене в центъра на София. Печем баницата сутрин, кафето е от местна пържилня, а сандвичите правим пред вас. Елате с лаптоп, с куче или просто така.",
  about_en:
    "A small neighbourhood café in the centre of Sofia. We bake the banitsa every morning, the coffee comes from a local roaster, and the sandwiches are made in front of you. Come with a laptop, a dog, or just because.",
  address: "ул. „Георги С. Раковски“ 100, София",
  phone: "+359 2 000 0000",
  maps_url: "https://maps.google.com/?q=42.6977,23.3219",
  instagram: "agala.cafe",
  hours: DEFAULT_HOURS,
  tz: "Europe/Sofia",
  default_lang: "bg",
  theme: { accent: "#2f6b4f" },
};

const CATEGORIES = [
  { name_bg: "Кафе", name_en: "Coffee" },
  { name_bg: "Закуски", name_en: "Pastries" },
  { name_bg: "Сандвичи и салати", name_en: "Sandwiches & salads" },
  { name_bg: "Напитки", name_en: "Drinks" },
];

const ITEMS: { cat: number; name_bg: string; name_en: string; desc_bg: string; desc_en: string; price_eur: number; allergens: number[] }[] = [
  { cat: 0, name_bg: "Еспресо", name_en: "Espresso", desc_bg: "Двойна доза от местна пържилня.", desc_en: "A double shot from a local roaster.", price_eur: 1.8, allergens: [] },
  { cat: 0, name_bg: "Капучино", name_en: "Cappuccino", desc_bg: "С прясно мляко и гъста пяна.", desc_en: "With fresh milk and thick foam.", price_eur: 2.9, allergens: [7] },
  { cat: 0, name_bg: "Лате", name_en: "Latte", desc_bg: "Меко и млечно, в голяма чаша.", desc_en: "Soft and milky, in a big cup.", price_eur: 3.2, allergens: [7] },
  { cat: 0, name_bg: "Чай", name_en: "Tea", desc_bg: "Черен, зелен или билков.", desc_en: "Black, green or herbal.", price_eur: 2.0, allergens: [] },
  { cat: 1, name_bg: "Баница със сирене", name_en: "Cheese banitsa", desc_bg: "Печена сутрин, с бяло сирене и яйца.", desc_en: "Baked in the morning with white cheese and eggs.", price_eur: 2.5, allergens: [1, 3, 7] },
  { cat: 1, name_bg: "Кроасан с масло", name_en: "Butter croissant", desc_bg: "Хрупкав, с истинско масло.", desc_en: "Crisp, made with real butter.", price_eur: 2.8, allergens: [1, 3, 7] },
  { cat: 1, name_bg: "Козунак", name_en: "Kozunak", desc_bg: "Сладък великденски хляб, целогодишно.", desc_en: "Sweet Bulgarian brioche, all year round.", price_eur: 2.2, allergens: [1, 3, 7] },
  { cat: 2, name_bg: "Сандвич с кашкавал", name_en: "Cheese sandwich", desc_bg: "Топъл, с кашкавал и домати.", desc_en: "Warm, with yellow cheese and tomatoes.", price_eur: 4.5, allergens: [1, 7] },
  { cat: 2, name_bg: "Сандвич с пуешко", name_en: "Turkey sandwich", desc_bg: "Пуешко филе, рукола и горчица.", desc_en: "Turkey breast, rocket and mustard.", price_eur: 5.2, allergens: [1, 10] },
  { cat: 2, name_bg: "Шопска салата", name_en: "Shopska salad", desc_bg: "Домати, краставици, чушки и сирене.", desc_en: "Tomatoes, cucumbers, peppers and white cheese.", price_eur: 6.5, allergens: [7] },
  { cat: 3, name_bg: "Фреш портокал", name_en: "Fresh orange juice", desc_bg: "Изстискан на момента.", desc_en: "Squeezed to order.", price_eur: 3.5, allergens: [] },
  { cat: 3, name_bg: "Домашна лимонада", name_en: "Homemade lemonade", desc_bg: "С мента и лед.", desc_en: "With mint and ice.", price_eur: 3.0, allergens: [] },
];

export const DEMO_TEXTS = {
  welcome: { bg: "Добре дошли! Днешните предложения са на дъската и тук.", en: "Welcome! Today's specials are on the board and right here." },
  footer_note: { bg: "Приемаме карти. Кучетата са добре дошли.", en: "Cards accepted. Dogs welcome." },
};

/** Creates the demo venue with its menu and texts. Idempotent per store only if the slug is free. */
export async function seedDemo(store: Store, slug = DEMO_SLUG): Promise<{ venue: Venue; categories: Category[]; items: Item[] }> {
  const venue = await store.createVenue({ ...DEMO_VENUE, slug });
  const categories: Category[] = [];
  for (const [i, c] of CATEGORIES.entries()) categories.push(await store.insertCategory({ venue_id: venue.id, ...c, position: i }));
  const items: Item[] = [];
  const perCat = new Map<number, number>();
  for (const it of ITEMS) {
    const pos = perCat.get(it.cat) ?? 0;
    perCat.set(it.cat, pos + 1);
    const { cat, ...rest } = it;
    items.push(await store.insertItem({ venue_id: venue.id, category_id: categories[cat].id, ...rest, position: pos }));
  }
  for (const [key, t] of Object.entries(DEMO_TEXTS)) await store.setSiteText(venue.id, key as "welcome" | "footer_note", t.bg, t.en);
  return { venue, categories, items };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/store-memory.test.ts`
Expected: PASS (9 contract tests). Then `npx vitest run` → everything green.

- [ ] **Step 8: Commit**

```bash
git add src/store/types.ts src/store/memory.ts src/seed/demo.ts test/store-contract.ts test/store-memory.test.ts test/helpers.ts
git commit -m "Store: interface, in-memory implementation with contract tests, demo seed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Config, Supabase schema/policies/RPCs, db-apply and check-rls scripts

**Files:**
- Create: `src/config.ts`, `supabase/schema.sql`, `supabase/policies.sql`, `supabase/cron.sql`, `scripts/db-apply.mts`, `scripts/check-rls.mts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?): Config` with fields `anthropicApiKey, agentModel, agentEffort, telegramToken, telegramWebhookSecret, sttApiKey (string|null), sttBaseUrl, sttModel, supabaseUrl, supabaseAnonKey, supabaseServiceKey, publicBaseUrl, tickSecret, demoVenueSlug`; `Effort = "low" | "medium" | "high"`. SQL RPCs: `admin_overview(p_key text) → json|null`, `decide_change_set(p_key, p_id uuid, p_decision text) → boolean`, `cancel_change_set(p_key, p_id) → boolean`, `request_undo(p_key, p_id) → uuid|null`.
- Nothing under `app/` imports `src/config.ts` (checked in Task 19).

- [ ] **Step 1: Write the failing config test**

```ts
// test/config.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/src/config";

const full = {
  ANTHROPIC_API_KEY: "a",
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_WEBHOOK_SECRET: "s",
  NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  TICK_SECRET: "tick",
  PUBLIC_BASE_URL: "https://site.example/",
};

describe("loadConfig", () => {
  it("reads every key with defaults", () => {
    const c = loadConfig(full);
    expect(c).toMatchObject({ agentModel: "claude-opus-5-5", agentEffort: "medium", sttApiKey: null, sttBaseUrl: "https://api.groq.com/openai/v1", sttModel: "whisper-large-v3", demoVenueSlug: "agala", publicBaseUrl: "https://site.example" });
  });
  it("names the missing key", () => {
    expect(() => loadConfig({ ...full, TELEGRAM_BOT_TOKEN: "" })).toThrow(/Missing TELEGRAM_BOT_TOKEN/);
  });
  it("rejects a bad effort", () => {
    expect(() => loadConfig({ ...full, AGENT_EFFORT: "max" })).toThrow(/AGENT_EFFORT/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/config.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
// src/config.ts
// Server-only: never import from app/ client components or src/i18n.
export type Effort = "low" | "medium" | "high";

export interface Config {
  anthropicApiKey: string;
  agentModel: string;
  agentEffort: Effort;
  telegramToken: string;
  telegramWebhookSecret: string;
  /** Any OpenAI-compatible transcription endpoint; Groq free tier by default. */
  sttApiKey: string | null;
  sttBaseUrl: string;
  sttModel: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey: string;
  publicBaseUrl: string;
  tickSecret: string;
  demoVenueSlug: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const need = (key: string): string => {
    const v = env[key]?.trim();
    if (!v) throw new Error(`Missing ${key} (set it in .env.local or the Vercel project env; see .env.example)`);
    return v;
  };
  const optional = (key: string): string | null => env[key]?.trim() || null;
  const effort = optional("AGENT_EFFORT") ?? "medium";
  if (effort !== "low" && effort !== "medium" && effort !== "high") throw new Error("AGENT_EFFORT must be low, medium or high");
  return {
    anthropicApiKey: need("ANTHROPIC_API_KEY"),
    agentModel: optional("AGENT_MODEL") ?? "claude-opus-5-5",
    agentEffort: effort,
    telegramToken: need("TELEGRAM_BOT_TOKEN"),
    telegramWebhookSecret: need("TELEGRAM_WEBHOOK_SECRET"),
    sttApiKey: optional("STT_API_KEY"),
    sttBaseUrl: (optional("STT_BASE_URL") ?? "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    sttModel: optional("STT_MODEL") ?? "whisper-large-v3",
    supabaseUrl: need("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: need("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceKey: need("SUPABASE_SERVICE_ROLE_KEY"),
    publicBaseUrl: need("PUBLIC_BASE_URL").replace(/\/+$/, ""),
    tickSecret: need("TICK_SECRET"),
    demoVenueSlug: optional("DEMO_VENUE_SLUG") ?? "agala",
  };
}
```

- [ ] **Step 4: Run** `npx vitest run test/config.test.ts` → PASS.

- [ ] **Step 5: Write `supabase/schema.sql`** (idempotent)

```sql
-- Site Manager schema. Idempotent: safe to re-run. Applied by `npm run db:apply`.
create extension if not exists pgcrypto;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  tagline_bg text not null default '',
  tagline_en text not null default '',
  about_bg text not null default '',
  about_en text not null default '',
  address text not null default '',
  phone text not null default '',
  maps_url text not null default '',
  instagram text not null default '',
  cover_media_id uuid,
  logo_media_id uuid,
  hours jsonb not null default '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"16:00"},"sun":null}'::jsonb,
  tz text not null default 'Europe/Sofia',
  default_lang text not null default 'bg' check (default_lang in ('bg', 'en')),
  theme jsonb not null default '{"accent":"#2f6b4f"}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.venue_members (
  venue_id uuid not null references public.venues(id) on delete cascade,
  tg_chat_id bigint not null,
  role text not null check (role in ('owner', 'staff')),
  lang text not null default 'bg' check (lang in ('bg', 'en')),
  created_at timestamptz not null default now(),
  primary key (venue_id, tg_chat_id)
);
-- One venue per Telegram chat: the bot looks members up by chat id alone.
create unique index if not exists venue_members_chat_idx on public.venue_members (tg_chat_id);

create table if not exists public.venue_invites (
  code text primary key check (length(code) >= 8),
  venue_id uuid not null references public.venues(id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.venue_admin_tokens (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  token text not null unique check (length(token) >= 32)
);

create table if not exists public.site_texts (
  venue_id uuid not null references public.venues(id) on delete cascade,
  key text not null check (key in ('welcome', 'footer_note')),
  text_bg text not null default '',
  text_en text not null default '',
  primary key (venue_id, key)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name_bg text not null,
  name_en text not null,
  position int not null default 0,
  active boolean not null default true
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  name_bg text not null,
  name_en text not null,
  desc_bg text not null default '',
  desc_en text not null default '',
  price_eur numeric(8,2) not null check (price_eur >= 0.10 and price_eur <= 500),
  allergens int[] not null default '{}',
  image_media_id uuid,
  sold_out_until timestamptz,
  is_special boolean not null default false,
  special_expires_at timestamptz,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_venue_idx on public.items (venue_id);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  date date not null,
  note_bg text not null default '',
  note_en text not null default '',
  unique (venue_id, date)
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  text_bg text not null,
  text_en text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  is_gallery boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.change_sets (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_id bigint,
  summary_bg text not null default '',
  summary_en text not null default '',
  preview_bg text not null default '',
  preview_en text not null default '',
  source text not null check (source in ('text', 'voice', 'photo', 'dashboard', 'auto', 'undo')),
  status text not null default 'proposed'
    check (status in ('proposed', 'scheduled', 'applied', 'rejected', 'expired', 'cancelled', 'reverted')),
  apply_at timestamptz,
  reminded_at timestamptz,
  decided_at timestamptz,
  applied_at timestamptz,
  reverted_by uuid,
  undoes_id uuid,
  tg_message_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists change_sets_venue_idx on public.change_sets (venue_id, created_at desc);
create index if not exists change_sets_status_idx on public.change_sets (status, apply_at);

create table if not exists public.changes (
  id uuid primary key default gen_random_uuid(),
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  position int not null,
  op text not null,
  entity text not null check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text')),
  entity_id text not null,
  before jsonb,
  after jsonb
);
create index if not exists changes_set_idx on public.changes (change_set_id, position);

create table if not exists public.conversations (
  venue_id uuid not null references public.venues(id) on delete cascade,
  chat_id bigint not null,
  turns jsonb not null default '[]'::jsonb,
  correction_for uuid,
  updated_at timestamptz not null default now(),
  primary key (venue_id, chat_id)
);

-- items.updated_at maintenance
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();
```

- [ ] **Step 6: Write `supabase/policies.sql`** (idempotent; anon read on public tables only; RPCs keyed by the admin token)

```sql
-- 1. Row-level security and grants. Anon (browser) may read the public site tables; everything else is server-only.
alter table public.venues enable row level security;
alter table public.venue_members enable row level security;
alter table public.venue_invites enable row level security;
alter table public.venue_admin_tokens enable row level security;
alter table public.site_texts enable row level security;
alter table public.categories enable row level security;
alter table public.items enable row level security;
alter table public.holidays enable row level security;
alter table public.announcements enable row level security;
alter table public.media enable row level security;
alter table public.change_sets enable row level security;
alter table public.changes enable row level security;
alter table public.conversations enable row level security;

revoke all on public.venue_members, public.venue_invites, public.venue_admin_tokens, public.change_sets, public.changes, public.conversations from anon, authenticated;
revoke insert, update, delete, truncate on public.venues, public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media from anon, authenticated;
grant select on public.venues, public.site_texts, public.categories, public.items, public.holidays, public.announcements, public.media to anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['venues', 'site_texts', 'categories', 'items', 'holidays', 'announcements', 'media'] loop
    execute format('drop policy if exists "anon read %1$s" on public.%1$I', t);
    execute format('create policy "anon read %1$s" on public.%1$I for select to anon, authenticated using (true)', t);
  end loop;
end $$;
-- venue_members, venue_invites, venue_admin_tokens, change_sets, changes, conversations: RLS on, no policies => invisible to anon.

-- 2. Owner dashboard RPCs (security definer, keyed by the admin token).
create or replace function public.venue_for_key(p_key text) returns uuid
language sql stable security definer set search_path = public as $$
  select venue_id from public.venue_admin_tokens where token = p_key;
$$;
revoke all on function public.venue_for_key(text) from public, anon, authenticated;

create or replace function public.admin_overview(p_key text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_id uuid := public.venue_for_key(p_key);
begin
  if v_id is null then return null; end if;
  return (
    select json_build_object(
      'venue', (select json_build_object('id', id, 'slug', slug, 'name', name, 'tz', tz, 'default_lang', default_lang) from public.venues where id = v_id),
      'now', now(),
      'pending', (select coalesce(json_agg(s order by s.created_at desc), '[]'::json) from (
        select cs.*, (select coalesce(json_agg(c order by c.position), '[]'::json) from public.changes c where c.change_set_id = cs.id) as changes
        from public.change_sets cs where cs.venue_id = v_id and cs.status = 'proposed') s),
      'scheduled', (select coalesce(json_agg(s order by s.apply_at), '[]'::json) from (
        select cs.*, (select coalesce(json_agg(c order by c.position), '[]'::json) from public.changes c where c.change_set_id = cs.id) as changes
        from public.change_sets cs where cs.venue_id = v_id and cs.status = 'scheduled') s),
      'log', (select coalesce(json_agg(s order by s.created_at desc), '[]'::json) from (
        select cs.*, (select coalesce(json_agg(c order by c.position), '[]'::json) from public.changes c where c.change_set_id = cs.id) as changes
        from public.change_sets cs where cs.venue_id = v_id and cs.status in ('applied', 'reverted', 'rejected', 'expired', 'cancelled')
        order by cs.created_at desc limit 50) s),
      'sold_out', (select coalesce(json_agg(json_build_object('id', i.id, 'name_bg', i.name_bg, 'name_en', i.name_en, 'sold_out_until', i.sold_out_until)), '[]'::json)
        from public.items i where i.venue_id = v_id and i.active and i.sold_out_until is not null and i.sold_out_until > now())
    )
  );
end $$;

-- 'apply' turns a proposal into a scheduled set due now; the tick applies it. 'reject' closes it.
create or replace function public.decide_change_set(p_key text, p_id uuid, p_decision text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.venue_for_key(p_key);
  n int;
begin
  if v_id is null then return false; end if;
  if p_decision = 'apply' then
    update public.change_sets set status = 'scheduled', apply_at = coalesce(apply_at, now()), decided_at = now()
     where id = p_id and venue_id = v_id and status = 'proposed';
  elsif p_decision = 'reject' then
    update public.change_sets set status = 'rejected', decided_at = now()
     where id = p_id and venue_id = v_id and status = 'proposed';
  else
    raise exception 'decision must be apply or reject';
  end if;
  get diagnostics n = row_count;
  return n = 1;
end $$;

create or replace function public.cancel_change_set(p_key text, p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.venue_for_key(p_key);
  n int;
begin
  if v_id is null then return false; end if;
  update public.change_sets set status = 'cancelled', decided_at = now()
   where id = p_id and venue_id = v_id and status in ('proposed', 'scheduled');
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Creates an undo set (inverse changes, reverse order) scheduled now; the tick applies it and marks the target reverted.
create or replace function public.request_undo(p_key text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.venue_for_key(p_key);
  target public.change_sets%rowtype;
  new_id uuid;
begin
  if v_id is null then return null; end if;
  select * into target from public.change_sets where id = p_id and venue_id = v_id and status = 'applied';
  if not found then return null; end if;
  insert into public.change_sets (venue_id, chat_id, summary_bg, summary_en, preview_bg, preview_en, source, status, apply_at, undoes_id)
  values (v_id, target.chat_id, 'Отмяна: ' || target.summary_bg, 'Undo: ' || target.summary_en,
          'Връща: ' || target.summary_bg, 'Reverts: ' || target.summary_en, 'undo', 'scheduled', now(), target.id)
  returning id into new_id;
  insert into public.changes (change_set_id, position, op, entity, entity_id, before, after)
  select new_id, row_number() over (order by position desc) - 1, op, entity, entity_id, after, before
    from public.changes where change_set_id = target.id;
  return new_id;
end $$;

revoke all on function public.admin_overview(text) from public;
revoke all on function public.decide_change_set(text, uuid, text) from public;
revoke all on function public.cancel_change_set(text, uuid) from public;
revoke all on function public.request_undo(text, uuid) from public;
grant execute on function public.admin_overview(text) to anon, authenticated;
grant execute on function public.decide_change_set(text, uuid, text) to anon, authenticated;
grant execute on function public.cancel_change_set(text, uuid) to anon, authenticated;
grant execute on function public.request_undo(text, uuid) to anon, authenticated;

-- 3. Realtime for the public site and the dashboard.
do $$
declare t text;
begin
  foreach t in array array['items', 'categories', 'venues', 'holidays', 'announcements', 'site_texts', 'media'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 4. Storage: public bucket for venue images (uploads happen with the service-role key).
insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
values ('media', 'media', true, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'], 5242880)
on conflict (id) do update set public = true, allowed_mime_types = excluded.allowed_mime_types, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
```

- [ ] **Step 7: Write `supabase/cron.sql`** (optional, commented)

```sql
-- Optional: call the tick every 5 minutes from Postgres (Supabase: enable pg_cron and pg_net in Database → Extensions).
-- Replace <BASE_URL> and <TICK_SECRET>, then run in the SQL editor.
-- select cron.schedule('site-manager-tick', '*/5 * * * *', $$
--   select net.http_post(url := '<BASE_URL>/api/tick', headers := '{"x-tick-secret": "<TICK_SECRET>"}'::jsonb, body := '{}'::jsonb);
-- $$);
-- To remove: select cron.unschedule('site-manager-tick');
```

- [ ] **Step 8: Write `scripts/db-apply.mts` and `scripts/check-rls.mts`**

```ts
// scripts/db-apply.mts
// Applies supabase/schema.sql and policies.sql to SUPABASE_DB_URL. Idempotent.
import { readFile } from "node:fs/promises";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL?.trim();
if (!url) throw new Error("Missing SUPABASE_DB_URL (Supabase → Settings → Database → Connection string URI); put it in .env.local");

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  for (const file of ["schema.sql", "policies.sql"]) {
    const sql = await readFile(new URL(`../supabase/${file}`, import.meta.url), "utf8");
    await client.query(sql);
    console.log(`applied ${file}`);
  }
  await client.query("notify pgrst, 'reload schema'");
  const { rows } = await client.query("select (select count(*) from venues) as venues, (select count(*) from items) as items");
  console.log(`venues=${rows[0].venues} items=${rows[0].items}`);
} finally {
  await client.end();
}
```

```ts
// scripts/check-rls.mts
// Proves with the anon key what the browser can and cannot do. Exit 1 on any FAIL.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
if (!url || !anon) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local");
const db = createClient(url, anon, { auth: { persistSession: false } });

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const venues = await db.from("venues").select("id, slug").limit(5);
check("anon can read venues", !venues.error, venues.error?.message);
const items = await db.from("items").select("id").limit(1);
check("anon can read items", !items.error, items.error?.message);
for (const t of ["venue_members", "venue_invites", "venue_admin_tokens", "change_sets", "changes", "conversations"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}
const write = await db.from("items").update({ price_eur: 1 }).eq("id", "00000000-0000-0000-0000-000000000000").select("id");
check("anon cannot update items", (write.data?.length ?? 0) === 0);
const ins = await db.from("announcements").insert({ venue_id: "00000000-0000-0000-0000-000000000000", text_bg: "x", text_en: "x" }).select("id");
check("anon cannot insert announcements", !!ins.error || (ins.data?.length ?? 0) === 0, ins.error?.code);
const overview = await db.rpc("admin_overview", { p_key: "not-a-real-key-at-all-0000000000" });
check("admin_overview returns null for a bad key", !overview.error && overview.data === null, overview.error?.message);
const decide = await db.rpc("decide_change_set", { p_key: "bad", p_id: "00000000-0000-0000-0000-000000000000", p_decision: "apply" });
check("decide_change_set returns false for a bad key", !decide.error && decide.data === false, decide.error?.message);
const undo = await db.rpc("request_undo", { p_key: "bad", p_id: "00000000-0000-0000-0000-000000000000" });
check("request_undo returns null for a bad key", !undo.error && undo.data === null, undo.error?.message);
const bucket = await db.storage.from("media").list("", { limit: 1 });
check("media bucket is readable", !bucket.error, bucket.error?.message);

process.exit(failed ? 1 : 0);
```

- [ ] **Step 9: Syntax-check the SQL offline** (no database needed): run `npx tsx -e "import('node:fs').then(fs=>{for(const f of ['supabase/schema.sql','supabase/policies.sql']){const s=fs.readFileSync(f,'utf8');const o=(s.match(/\\$\\$/g)||[]).length;if(o%2)throw new Error(f+': unbalanced $$');console.log(f,'ok')}})"` and `npx tsc --noEmit` (scripts are type-checked by the root tsconfig). If `.env.local` has `SUPABASE_DB_URL`, also run `npm run db:apply` and `npm run check:rls` now and paste the output in the commit body; otherwise note "live apply skipped: no SUPABASE_DB_URL".

- [ ] **Step 10: Commit**

```bash
git add src/config.ts supabase/ scripts/db-apply.mts scripts/check-rls.mts test/config.test.ts
git commit -m "Config and Supabase: schema, RLS, admin RPCs, realtime, storage bucket, db scripts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Supabase store

**Files:**
- Create: `src/store/supabase.ts`
- Test: `test/store-supabase.test.ts` (runs the contract only when `.env.local` has Supabase keys; otherwise skipped with a note), `test/supabase-mappers.test.ts` (offline)

**Interfaces:**
- Consumes: `Store` and the `New*` types (Task 6), `applyChanges` is **not** used here (writes go to tables directly).
- Produces: `SupabaseStore` (`new SupabaseStore(url, serviceRoleKey)`), exported row mappers `toVenue`, `toItem`, `toChangeSet`, and `must`/`mustRows`.

- [ ] **Step 1: Write the offline mapper test**

```ts
// test/supabase-mappers.test.ts
import { describe, expect, it } from "vitest";
import { toChangeSet, toItem, toVenue } from "@/src/store/supabase";

describe("supabase row mappers", () => {
  it("coerces numerics and nulls", () => {
    const item = toItem({ id: "i", venue_id: "v", category_id: "c", name_bg: "Б", name_en: "B", desc_bg: null, desc_en: null, price_eur: "2.90", allergens: [7], image_media_id: null, sold_out_until: null, is_special: false, special_expires_at: null, position: 1, active: true, created_at: "2026-10-09T09:00:00+00:00", updated_at: "2026-10-09T09:00:00+00:00" });
    expect(item.price_eur).toBe(2.9);
    expect(item.desc_bg).toBe("");
    expect(item.created_at).toBe("2026-10-09T09:00:00.000Z");
  });
  it("maps a venue with jsonb hours and theme", () => {
    const v = toVenue({ id: "v", slug: "s", name: "n", hours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null }, theme: { accent: "#000000" }, tz: "Europe/Sofia", default_lang: "en", created_at: "2026-10-09T09:00:00Z" });
    expect(v).toMatchObject({ tagline_bg: "", cover_media_id: null, default_lang: "en", theme: { accent: "#000000" } });
  });
  it("maps a change set with nested changes", () => {
    const cs = toChangeSet({ id: "c", venue_id: "v", chat_id: "1001", summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", apply_at: null, reminded_at: null, decided_at: null, applied_at: null, reverted_by: null, undoes_id: null, tg_message_id: "55", created_at: "2026-10-09T09:00:00Z", changes: [{ id: "x", position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } }] });
    expect(cs.chat_id).toBe(1001);
    expect(cs.tg_message_id).toBe(55);
    expect(cs.changes[0]).toEqual({ position: 0, op: "set_price", entity: "item", entity_id: "i", before: { price_eur: 1 }, after: { price_eur: 2 } });
  });
});
```

```ts
// test/store-supabase.test.ts
import { describe, it } from "vitest";
import { SupabaseStore } from "@/src/store/supabase";
import { storeContract } from "./store-contract";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key && process.env.SUPABASE_CONTRACT === "1") {
  // Live run: SUPABASE_CONTRACT=1 npx tsx --env-file=.env.local node_modules/vitest/vitest.mjs run test/store-supabase.test.ts
  storeContract("supabase", async () => {
    const s = new SupabaseStore(url, key);
    s.slugPrefix = `test-${Date.now().toString(36)}-`;
    return s;
  });
} else {
  describe("supabase store", () => {
    it.skip("live contract (set SUPABASE_CONTRACT=1 with Supabase keys in the env)", () => {});
  });
}
```

- [ ] **Step 2: Run** `npx vitest run test/supabase-mappers.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/store/supabase.ts`**

```ts
// src/store/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Announcement, Category, Change, ChangeSet, Conversation, Holiday, Item, Lang, Media, Member, Role, SiteState, SiteText, SiteTextKey, Venue } from "../domain/types";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store } from "./types";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

export function toVenue(r: Row): Venue {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    tagline_bg: str(r.tagline_bg),
    tagline_en: str(r.tagline_en),
    about_bg: str(r.about_bg),
    about_en: str(r.about_en),
    address: str(r.address),
    phone: str(r.phone),
    maps_url: str(r.maps_url),
    instagram: str(r.instagram),
    cover_media_id: strOrNull(r.cover_media_id),
    logo_media_id: strOrNull(r.logo_media_id),
    hours: (r.hours as Venue["hours"]) ?? DEFAULT_HOURS,
    tz: str(r.tz) || "Europe/Sofia",
    default_lang: (r.default_lang as Lang) ?? "bg",
    theme: (r.theme as Venue["theme"]) ?? { accent: "#2f6b4f" },
    created_at: iso(r.created_at),
  };
}
export function toCategory(r: Row): Category {
  return { id: r.id as string, venue_id: r.venue_id as string, name_bg: str(r.name_bg), name_en: str(r.name_en), position: num(r.position), active: Boolean(r.active) };
}
export function toItem(r: Row): Item {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    category_id: r.category_id as string,
    name_bg: str(r.name_bg),
    name_en: str(r.name_en),
    desc_bg: str(r.desc_bg),
    desc_en: str(r.desc_en),
    price_eur: num(r.price_eur),
    allergens: ((r.allergens as number[]) ?? []).map(Number),
    image_media_id: strOrNull(r.image_media_id),
    sold_out_until: isoOrNull(r.sold_out_until),
    is_special: Boolean(r.is_special),
    special_expires_at: isoOrNull(r.special_expires_at),
    position: num(r.position),
    active: Boolean(r.active),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
export function toHoliday(r: Row): Holiday {
  return { id: r.id as string, venue_id: r.venue_id as string, date: String(r.date).slice(0, 10), note_bg: str(r.note_bg), note_en: str(r.note_en) };
}
export function toAnnouncement(r: Row): Announcement {
  return { id: r.id as string, venue_id: r.venue_id as string, text_bg: str(r.text_bg), text_en: str(r.text_en), expires_at: isoOrNull(r.expires_at), created_at: iso(r.created_at) };
}
export function toMedia(r: Row): Media {
  return { id: r.id as string, venue_id: r.venue_id as string, storage_path: str(r.storage_path), public_url: str(r.public_url), is_gallery: Boolean(r.is_gallery), position: num(r.position), created_at: iso(r.created_at) };
}
export function toSiteText(r: Row): SiteText {
  return { venue_id: r.venue_id as string, key: r.key as SiteTextKey, text_bg: str(r.text_bg), text_en: str(r.text_en) };
}
export function toMember(r: Row): Member {
  return { venue_id: r.venue_id as string, tg_chat_id: num(r.tg_chat_id), role: r.role as Role, lang: (r.lang as Lang) ?? "bg", created_at: iso(r.created_at) };
}
export function toChange(r: Row): Change {
  return { position: num(r.position), op: r.op as Change["op"], entity: r.entity as Change["entity"], entity_id: str(r.entity_id), before: (r.before as Row | null) ?? null, after: (r.after as Row | null) ?? null };
}
export function toChangeSet(r: Row): ChangeSet {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    chat_id: numOrNull(r.chat_id),
    summary_bg: str(r.summary_bg),
    summary_en: str(r.summary_en),
    preview_bg: str(r.preview_bg),
    preview_en: str(r.preview_en),
    source: r.source as ChangeSet["source"],
    status: r.status as ChangeSet["status"],
    apply_at: isoOrNull(r.apply_at),
    reminded_at: isoOrNull(r.reminded_at),
    decided_at: isoOrNull(r.decided_at),
    applied_at: isoOrNull(r.applied_at),
    reverted_by: strOrNull(r.reverted_by),
    undoes_id: strOrNull(r.undoes_id),
    tg_message_id: numOrNull(r.tg_message_id),
    created_at: iso(r.created_at),
    changes: ((r.changes as Row[]) ?? []).map(toChange).sort((a, b) => a.position - b.position),
  };
}

/** Unwraps a Supabase result; keeps the error code in the message so callers can tell not-found (PGRST116) apart. */
export async function must<T>(p: PromiseLike<{ data: T | null; error: DbError }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}${error.code ? ` [${error.code}]` : ""}`);
  if (data === null) throw new Error(`${what}: not found`);
  return data;
}
/** Like `must`, but also throws when no row was affected. */
export async function mustRows<T>(p: PromiseLike<{ data: T[] | null; error: DbError }>, what: string): Promise<T[]> {
  const rows = await must(p, what);
  if (rows.length === 0) throw new Error(`${what}: not found`);
  return rows;
}

const SET_SELECT = "*, changes(*)";
const TABLE: Record<Change["entity"], string> = { venue: "venues", category: "categories", item: "items", holiday: "holidays", announcement: "announcements", media: "media", site_text: "site_texts" };

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  /** Tests prefix slugs so parallel runs never collide. */
  slugPrefix = "";

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async createVenue(v: NewVenue) {
    const row = { ...v, slug: `${this.slugPrefix}${v.slug}`, hours: v.hours ?? DEFAULT_HOURS, theme: v.theme ?? { accent: "#2f6b4f" } };
    return toVenue(await must(this.db.from("venues").insert(row).select("*").single(), "createVenue"));
  }
  async getVenue(id: string) {
    return toVenue(await must(this.db.from("venues").select("*").eq("id", id).single(), `getVenue ${id}`));
  }
  async getVenueBySlug(slug: string) {
    const { data, error } = await this.db.from("venues").select("*").eq("slug", `${this.slugPrefix}${slug}`).maybeSingle();
    if (error) throw new Error(`getVenueBySlug: ${error.message}`);
    return data ? toVenue(data) : null;
  }
  async listVenues() {
    return (await must(this.db.from("venues").select("*").order("created_at"), "listVenues")).map(toVenue);
  }
  async getSite(venueId: string): Promise<SiteState> {
    const [venue, categories, items, holidays, announcements, media, texts] = await Promise.all([
      this.getVenue(venueId),
      must(this.db.from("categories").select("*").eq("venue_id", venueId).order("position"), "categories"),
      must(this.db.from("items").select("*").eq("venue_id", venueId).order("position").order("created_at"), "items"),
      must(this.db.from("holidays").select("*").eq("venue_id", venueId).order("date"), "holidays"),
      must(this.db.from("announcements").select("*").eq("venue_id", venueId).order("created_at"), "announcements"),
      must(this.db.from("media").select("*").eq("venue_id", venueId).order("created_at"), "media"),
      must(this.db.from("site_texts").select("*").eq("venue_id", venueId), "site_texts"),
    ]);
    return { venue, categories: categories.map(toCategory), items: items.map(toItem), holidays: holidays.map(toHoliday), announcements: announcements.map(toAnnouncement), media: media.map(toMedia), texts: texts.map(toSiteText) };
  }
  async insertCategory(c: NewCategory) {
    return toCategory(await must(this.db.from("categories").insert(c).select("*").single(), "insertCategory"));
  }
  async insertItem(i: NewItem) {
    return toItem(await must(this.db.from("items").insert({ ...i, is_special: i.is_special ?? false, special_expires_at: i.special_expires_at ?? null, image_media_id: i.image_media_id ?? null }).select("*").single(), "insertItem"));
  }
  async setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string) {
    await must(this.db.from("site_texts").upsert({ venue_id: venueId, key, text_bg, text_en }, { onConflict: "venue_id,key" }).select("key"), "setSiteText");
  }
  async clearVenueContent(venueId: string) {
    for (const t of ["change_sets", "conversations", "items", "categories", "holidays", "announcements", "site_texts"]) {
      const { error } = await this.db.from(t).delete().eq("venue_id", venueId);
      if (error) throw new Error(`clearVenueContent ${t}: ${error.message}`);
    }
    const media = await must(this.db.from("media").select("storage_path").eq("venue_id", venueId), "clearVenueContent media");
    if (media.length) await this.db.storage.from("media").remove(media.map((m) => m.storage_path as string));
    await this.db.from("media").delete().eq("venue_id", venueId);
    await this.db.from("venues").update({ cover_media_id: null, logo_media_id: null }).eq("id", venueId);
  }

  async findMember(chatId: number) {
    const { data, error } = await this.db.from("venue_members").select("*").eq("tg_chat_id", chatId).maybeSingle();
    if (error) throw new Error(`findMember: ${error.message}`);
    return data ? toMember(data) : null;
  }
  async upsertMember(m: Omit<Member, "created_at">) {
    // One venue per chat: drop any previous link first (the unique index on tg_chat_id would reject it).
    await this.db.from("venue_members").delete().eq("tg_chat_id", m.tg_chat_id).neq("venue_id", m.venue_id);
    return toMember(await must(this.db.from("venue_members").upsert(m, { onConflict: "venue_id,tg_chat_id" }).select("*").single(), "upsertMember"));
  }
  async setMemberLang(venueId: string, chatId: number, lang: Lang) {
    await mustRows(this.db.from("venue_members").update({ lang }).eq("venue_id", venueId).eq("tg_chat_id", chatId).select("tg_chat_id"), "setMemberLang");
  }
  async createInvite(venueId: string, role: Role, expiresAt: string) {
    const code = newInviteCode();
    await must(this.db.from("venue_invites").insert({ code, venue_id: venueId, role, expires_at: expiresAt }).select("code"), "createInvite");
    return code;
  }
  async redeemInvite(code: string, chatId: number, lang: Lang, now: string) {
    const rows = await must(
      this.db.from("venue_invites").update({ used_at: now }).eq("code", code).is("used_at", null).gt("expires_at", now).select("*"),
      "redeemInvite",
    );
    if (rows.length === 0) return null;
    return this.upsertMember({ venue_id: rows[0].venue_id as string, tg_chat_id: chatId, role: rows[0].role as Role, lang });
  }
  async getAdminToken(venueId: string) {
    const { data, error } = await this.db.from("venue_admin_tokens").select("token").eq("venue_id", venueId).maybeSingle();
    if (error) throw new Error(`getAdminToken: ${error.message}`);
    if (data) return data.token as string;
    const token = newToken();
    await must(this.db.from("venue_admin_tokens").insert({ venue_id: venueId, token }).select("venue_id"), "getAdminToken insert");
    return token;
  }
  async findVenueByAdminToken(token: string) {
    const { data, error } = await this.db.from("venue_admin_tokens").select("venue_id").eq("token", token).maybeSingle();
    if (error) throw new Error(`findVenueByAdminToken: ${error.message}`);
    return data ? this.getVenue(data.venue_id as string) : null;
  }

  async createChangeSet(cs: NewChangeSet) {
    const { changes, ...head } = cs;
    const row = await must(this.db.from("change_sets").insert({ ...head, apply_at: head.apply_at ?? null, undoes_id: head.undoes_id ?? null, tg_message_id: head.tg_message_id ?? null }).select("*").single(), "createChangeSet");
    if (changes.length) {
      await must(this.db.from("changes").insert(changes.map((c, i) => ({ change_set_id: row.id, position: i, op: c.op, entity: c.entity, entity_id: c.entity_id, before: c.before, after: c.after }))).select("id"), "createChangeSet changes");
    }
    return this.getChangeSet(row.id as string);
  }
  async getChangeSet(id: string) {
    return toChangeSet(await must(this.db.from("change_sets").select(SET_SELECT).eq("id", id).single(), `getChangeSet ${id}`));
  }
  async findProposed(venueId: string, chatId: number) {
    const rows = await must(this.db.from("change_sets").select(SET_SELECT).eq("venue_id", venueId).eq("chat_id", chatId).eq("status", "proposed").order("created_at", { ascending: false }).limit(1), "findProposed");
    return rows.length ? toChangeSet(rows[0]) : null;
  }
  async listChangeSets(venueId: string, opts: { status?: ChangeSet["status"][]; limit?: number } = {}) {
    let q = this.db.from("change_sets").select(SET_SELECT).eq("venue_id", venueId).order("created_at", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.status) q = q.in("status", opts.status);
    return (await must(q, "listChangeSets")).map(toChangeSet);
  }
  async listDue(now: string, venueId?: string) {
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "scheduled").lte("apply_at", now).order("apply_at");
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listDue")).map(toChangeSet);
  }
  async listUpcoming(now: string, until: string, venueId?: string) {
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "scheduled").is("reminded_at", null).gt("apply_at", now).lte("apply_at", until);
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listUpcoming")).map(toChangeSet);
  }
  async listProposedBefore(cutoff: string, venueId?: string) {
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "proposed").lt("created_at", cutoff);
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listProposedBefore")).map(toChangeSet);
  }
  async updateChangeSet(id: string, patch: ChangeSetPatch) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return;
    await mustRows(this.db.from("change_sets").update(clean).eq("id", id).select("id"), `updateChangeSet ${id}`);
  }

  /** Conditional status flip first (so two appliers cannot both write), then the entity writes. */
  async applyChangeSet(id: string, now: string) {
    const flipped = await must(
      this.db.from("change_sets").update({ status: "applied", applied_at: now }).eq("id", id).in("status", ["proposed", "scheduled"]).select("*"),
      `applyChangeSet ${id}`,
    );
    if (flipped.length === 0) return "skipped";
    const cs = await this.getChangeSet(id);
    if (cs.decided_at === null) await this.updateChangeSet(id, { decided_at: now });
    for (const c of cs.changes) await this.writeEntity(cs.venue_id, c);
    if (cs.undoes_id) {
      await this.db.from("change_sets").update({ status: "reverted", reverted_by: cs.id }).eq("id", cs.undoes_id).eq("status", "applied");
    }
    return "applied";
  }

  private async writeEntity(venueId: string, c: Change) {
    const table = TABLE[c.entity];
    if (c.entity === "site_text") {
      if (c.after === null) {
        const { error } = await this.db.from(table).delete().eq("venue_id", venueId).eq("key", c.entity_id);
        if (error) throw new Error(`delete site_text: ${error.message}`);
      } else {
        await must(this.db.from(table).upsert({ venue_id: venueId, key: c.entity_id, ...c.after }, { onConflict: "venue_id,key" }).select("key"), "upsert site_text");
      }
      return;
    }
    if (c.after === null) {
      const { error } = await this.db.from(table).delete().eq("id", c.entity_id);
      if (error) throw new Error(`delete ${c.entity} ${c.entity_id}: ${error.message}`);
      return;
    }
    if (c.before === null) {
      await must(this.db.from(table).upsert({ ...c.after, id: c.entity_id }, { onConflict: "id" }).select("id"), `insert ${c.entity} ${c.entity_id}`);
      return;
    }
    await mustRows(this.db.from(table).update(c.after).eq("id", c.entity_id).select("id"), `update ${c.entity} ${c.entity_id}`);
  }

  async listExpiredTimers(now: string, venueId?: string) {
    let a = this.db.from("items").select("*").not("sold_out_until", "is", null).lte("sold_out_until", now);
    let b = this.db.from("items").select("*").eq("is_special", true).eq("active", true).not("special_expires_at", "is", null).lte("special_expires_at", now);
    if (venueId) {
      a = a.eq("venue_id", venueId);
      b = b.eq("venue_id", venueId);
    }
    const [soldOut, specials] = await Promise.all([must(a, "expired sold-out"), must(b, "expired specials")]);
    const out: ExpiredTimer[] = [];
    for (const r of soldOut) out.push({ item: toItem(r), kind: "sold_out" });
    for (const r of specials) out.push({ item: toItem(r), kind: "special" });
    return out;
  }

  async saveMedia(venueId: string, bytes: Uint8Array, contentType: string) {
    const id = crypto.randomUUID();
    const path = `${venueId}/${id}.${extensionFor(contentType)}`;
    const { error } = await this.db.storage.from("media").upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`saveMedia upload: ${error.message}`);
    const public_url = this.db.storage.from("media").getPublicUrl(path).data.publicUrl;
    return toMedia(await must(this.db.from("media").insert({ id, venue_id: venueId, storage_path: path, public_url }).select("*").single(), "saveMedia row"));
  }
  async getMedia(id: string) {
    const { data, error } = await this.db.from("media").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getMedia: ${error.message}`);
    return data ? toMedia(data) : null;
  }

  async getConversation(venueId: string, chatId: number) {
    const { data, error } = await this.db.from("conversations").select("*").eq("venue_id", venueId).eq("chat_id", chatId).maybeSingle();
    if (error) throw new Error(`getConversation: ${error.message}`);
    if (!data) return null;
    return { turns: (data.turns as Conversation["turns"]) ?? [], correction_for: strOrNull(data.correction_for), updated_at: iso(data.updated_at) };
  }
  async setConversation(venueId: string, chatId: number, c: Conversation) {
    await must(this.db.from("conversations").upsert({ venue_id: venueId, chat_id: chatId, turns: c.turns, correction_for: c.correction_for, updated_at: c.updated_at }, { onConflict: "venue_id,chat_id" }).select("chat_id"), "setConversation");
  }
}
```

- [ ] **Step 4: Run** `npx vitest run test/supabase-mappers.test.ts test/store-supabase.test.ts` → mappers PASS, live contract skipped (or PASS if keys + `SUPABASE_CONTRACT=1`). Run `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/supabase.ts test/supabase-mappers.test.ts test/store-supabase.test.ts
git commit -m "Store: Supabase implementation with conditional apply and entity writes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Messenger interface and the tick

**Files:**
- Create: `src/bot/messenger.ts`, `src/tick.ts`
- Modify: `test/helpers.ts` (add `FakeMessenger`)
- Test: `test/tick.test.ts`

**Interfaces:**
- Produces: `Messenger { send(chatId, text): Promise<number | null>; sendProposal(chatId, text, setId, lang): Promise<number | null>; edit(chatId, messageId, text): Promise<void> }`, `TelegramMessenger(api: Api)`, `proposalKeyboard(setId, lang)`; `runTick(deps: TickDeps): Promise<TickReport>` with `TickDeps = { store; messenger: Messenger | null; now: Date; venueId?: string }`, `TickReport = { applied: string[]; auto: string[]; reminded: string[]; expired: string[] }`. Callback data format `cs:<apply|change|cancel>:<setId>` (Task 13 parses it).

- [ ] **Step 1: Write `src/bot/messenger.ts`**

```ts
// src/bot/messenger.ts
import type { Api } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Lang } from "../domain/types";

export interface Messenger {
  /** Plain message; returns the Telegram message id or null if sending failed (never throws). */
  send(chatId: number, text: string): Promise<number | null>;
  /** Preview with ✅ / ✏️ / ❌ buttons. */
  sendProposal(chatId: number, text: string, setId: string, lang: Lang): Promise<number | null>;
  /** Replaces the text and removes the buttons; best-effort. */
  edit(chatId: number, messageId: number, text: string): Promise<void>;
}

export function proposalKeyboard(setId: string, lang: Lang): InlineKeyboard {
  const bg = lang === "bg";
  return new InlineKeyboard()
    .text(bg ? "✅ Приложи" : "✅ Apply", `cs:apply:${setId}`)
    .text(bg ? "✏️ Промени" : "✏️ Change", `cs:change:${setId}`)
    .text(bg ? "❌ Откажи" : "❌ Cancel", `cs:cancel:${setId}`);
}

export class TelegramMessenger implements Messenger {
  constructor(private api: Api) {}
  async send(chatId: number, text: string) {
    try {
      const m = await this.api.sendMessage(chatId, text);
      return m.message_id;
    } catch (e) {
      console.error("[messenger] send failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async sendProposal(chatId: number, text: string, setId: string, lang: Lang) {
    try {
      const m = await this.api.sendMessage(chatId, text, { reply_markup: proposalKeyboard(setId, lang) });
      return m.message_id;
    } catch (e) {
      console.error("[messenger] sendProposal failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  async edit(chatId: number, messageId: number, text: string) {
    try {
      await this.api.editMessageText(chatId, messageId, text, { reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      console.error("[messenger] edit failed:", e instanceof Error ? e.message : e);
    }
  }
}
```

- [ ] **Step 2: Add `FakeMessenger` to `test/helpers.ts`**

```ts
// test/helpers.ts (append)
import type { Messenger } from "@/src/bot/messenger";
import type { Lang } from "@/src/domain/types";

export class FakeMessenger implements Messenger {
  sent: { chatId: number; text: string; setId?: string; lang?: Lang; messageId: number }[] = [];
  edits: { chatId: number; messageId: number; text: string }[] = [];
  private next = 100;
  async send(chatId: number, text: string) {
    const messageId = this.next++;
    this.sent.push({ chatId, text, messageId });
    return messageId;
  }
  async sendProposal(chatId: number, text: string, setId: string, lang: Lang) {
    const messageId = this.next++;
    this.sent.push({ chatId, text, setId, lang, messageId });
    return messageId;
  }
  async edit(chatId: number, messageId: number, text: string) {
    this.edits.push({ chatId, messageId, text });
  }
  last() {
    return this.sent[this.sent.length - 1];
  }
}
```

- [ ] **Step 3: Write the failing tick tests**

```ts
// test/tick.test.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { runTick } from "@/src/tick";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const ctx = { newId: () => crypto.randomUUID(), now: T0.toISOString() };

describe("runTick", () => {
  it("applies due scheduled sets, notifies the chat in its language, and leaves future ones", async () => {
    const { store, venue, items } = await makeDemo();
    const m = new FakeMessenger();
    const site = await store.getSite(venue.id);
    const due = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Нова цена на капучиното", summary_en: "New cappuccino price", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], ctx) });
    const future = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-20T08:00:00.000Z", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.applied).toEqual([due.id]);
    expect((await store.getChangeSet(due.id)).status).toBe("applied");
    expect((await store.getChangeSet(future.id)).status).toBe("scheduled");
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ chatId: 1001, text: "✅ Приложено по график: Нова цена на капучиното" });
  });

  it("writes auto sets once for elapsed sold-out and special timers", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-09T08:30:00.000Z" }], { ...ctx, now: "2026-10-09T08:00:00.000Z" }) });
    await store.applyChangeSet(cs.id, "2026-10-09T08:00:00.000Z");
    const special = await store.insertItem({ venue_id: venue.id, category_id: items.Espresso.category_id, name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], position: 9, is_special: true, special_expires_at: "2026-10-09T08:45:00.000Z" });
    const r1 = await runTick({ store, messenger: null, now: T0 });
    expect(r1.auto).toHaveLength(2);
    const after = await store.getSite(venue.id);
    expect(after.items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBeNull();
    expect(after.items.find((i) => i.id === special.id)?.active).toBe(false);
    const autos = await store.listChangeSets(venue.id, { status: ["applied"] });
    expect(autos.filter((s) => s.source === "auto")).toHaveLength(2);
    expect(autos.find((s) => s.source === "auto" && s.changes[0].op === "set_sold_out")).toMatchObject({ summary_bg: "Баница със сирене отново в наличност", summary_en: "Cheese banitsa back in stock" });
    const r2 = await runTick({ store, messenger: null, now: new Date("2026-10-09T09:05:00.000Z") });
    expect(r2.auto).toEqual([]);
  });

  it("reminds once about sets due within 24 h", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    const soon = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Коледно работно време", summary_en: "Christmas hours", preview_bg: "p", preview_en: "p", source: "text", status: "scheduled", apply_at: "2026-10-10T06:00:00.000Z", changes: [] });
    const r1 = await runTick({ store, messenger: m, now: T0 });
    expect(r1.reminded).toEqual([soon.id]);
    expect(m.sent[0].text).toBe("⏰ Напомняне: на 10.10.2026, 09:00 ще се приложи: Коледно работно време");
    const r2 = await runTick({ store, messenger: m, now: new Date("2026-10-09T10:00:00.000Z") });
    expect(r2.reminded).toEqual([]);
    expect(m.sent).toHaveLength(1);
  });

  it("expires proposals older than 2 h and edits their message", async () => {
    const { store, venue } = await makeDemo();
    const m = new FakeMessenger();
    store.clock = () => "2026-10-09T06:00:00.000Z";
    const old = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Стара", summary_en: "Old", preview_bg: "превю", preview_en: "preview", source: "text", status: "proposed", tg_message_id: 42, changes: [] });
    store.clock = () => "2026-10-09T08:30:00.000Z";
    const fresh = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Нова", summary_en: "New", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [] });
    const r = await runTick({ store, messenger: m, now: T0 });
    expect(r.expired).toEqual([old.id]);
    expect((await store.getChangeSet(old.id)).status).toBe("expired");
    expect((await store.getChangeSet(fresh.id)).status).toBe("proposed");
    expect(m.edits[0]).toEqual({ chatId: 1001, messageId: 42, text: "превю\n\n⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа." });
  });

  it("limits itself to one venue when asked", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    const a = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const b = await store.createChangeSet({ venue_id: other.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const r = await runTick({ store, messenger: null, now: T0, venueId: other.id });
    expect(r.applied).toEqual([b.id]);
    expect((await store.getChangeSet(a.id)).status).toBe("scheduled");
  });
});
```

- [ ] **Step 4: Run** `npx vitest run test/tick.test.ts` → FAIL.

- [ ] **Step 5: Implement `src/tick.ts`**

```ts
// src/tick.ts
import type { Messenger } from "./bot/messenger";
import { planChange } from "./domain/changes";
import { itemName, tr } from "./domain/format";
import type { Lang } from "./domain/types";
import type { ExpiredTimer, Store } from "./store/types";
import { formatDateTime } from "./time";

export interface TickDeps {
  store: Store;
  messenger: Messenger | null;
  now: Date;
  /** Restrict to one venue (the per-webhook tick). */
  venueId?: string;
}
export interface TickReport {
  applied: string[];
  auto: string[];
  reminded: string[];
  expired: string[];
}

const HOUR = 3_600_000;
const PROPOSAL_TTL_MS = 2 * HOUR;
const REMIND_WINDOW_MS = 24 * HOUR;

async function langFor(store: Store, venueId: string, chatId: number | null): Promise<{ lang: Lang; tz: string }> {
  const venue = await store.getVenue(venueId);
  const member = chatId === null ? null : await store.findMember(chatId);
  return { lang: member?.lang ?? venue.default_lang, tz: venue.tz };
}

/** Applies due scheduled sets, writes auto sets for elapsed timers, reminds about upcoming sets, expires stale proposals. */
export async function runTick(d: TickDeps): Promise<TickReport> {
  const now = d.now.toISOString();
  const report: TickReport = { applied: [], auto: [], reminded: [], expired: [] };

  // 1. Stale proposals (before applying, so a 2 h-old proposal cannot be applied by a late tap).
  const cutoff = new Date(d.now.getTime() - PROPOSAL_TTL_MS).toISOString();
  for (const cs of await d.store.listProposedBefore(cutoff, d.venueId)) {
    await d.store.updateChangeSet(cs.id, { status: "expired", decided_at: now });
    report.expired.push(cs.id);
    if (d.messenger && cs.chat_id !== null && cs.tg_message_id !== null) {
      const { lang } = await langFor(d.store, cs.venue_id, cs.chat_id);
      const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
      await d.messenger.edit(cs.chat_id, cs.tg_message_id, `${preview}\n\n${tr(lang, "⌛ Изтекло: предложението не беше потвърдено в рамките на 2 часа.", "⌛ Expired: the proposal was not confirmed within 2 hours.")}`);
    }
  }

  // 2. Due scheduled sets.
  for (const cs of await d.store.listDue(now, d.venueId)) {
    let result: "applied" | "skipped";
    try {
      result = await d.store.applyChangeSet(cs.id, now);
    } catch (e) {
      console.error(`[tick] apply ${cs.id} failed:`, e instanceof Error ? e.message : e);
      continue;
    }
    if (result !== "applied") continue;
    report.applied.push(cs.id);
    if (d.messenger && cs.chat_id !== null) {
      const { lang } = await langFor(d.store, cs.venue_id, cs.chat_id);
      const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
      await d.messenger.send(cs.chat_id, cs.source === "undo" ? `${tr(lang, "↩️ Отменено", "↩️ Reverted")}: ${summary}` : `${tr(lang, "✅ Приложено по график", "✅ Applied as scheduled")}: ${summary}`);
    }
  }

  // 3. Auto sets for elapsed timers (read-time effectiveness already hides them; this makes the log complete).
  for (const t of await d.store.listExpiredTimers(now, d.venueId)) {
    try {
      const id = await writeAutoSet(d.store, t, now);
      report.auto.push(id);
    } catch (e) {
      console.error(`[tick] auto set for ${t.item.id} failed:`, e instanceof Error ? e.message : e);
    }
  }

  // 4. Reminders for sets due within 24 h.
  const until = new Date(d.now.getTime() + REMIND_WINDOW_MS).toISOString();
  for (const cs of await d.store.listUpcoming(now, until, d.venueId)) {
    await d.store.updateChangeSet(cs.id, { reminded_at: now });
    report.reminded.push(cs.id);
    if (d.messenger && cs.chat_id !== null && cs.apply_at) {
      const { lang, tz } = await langFor(d.store, cs.venue_id, cs.chat_id);
      const summary = lang === "bg" ? cs.summary_bg : cs.summary_en;
      await d.messenger.send(cs.chat_id, `${tr(lang, "⏰ Напомняне: на", "⏰ Reminder: on")} ${formatDateTime(cs.apply_at, lang, tz)} ${tr(lang, "ще се приложи", "this will be applied")}: ${summary}`);
    }
  }
  return report;
}

async function writeAutoSet(store: Store, t: ExpiredTimer, now: string): Promise<string> {
  const site = await store.getSite(t.item.venue_id);
  const ctx = { newId: () => crypto.randomUUID(), now };
  const change = t.kind === "sold_out"
    ? planChange(site, { op: "set_sold_out", item_id: t.item.id, until: null }, ctx)
    : planChange(site, { op: "remove_item", item_id: t.item.id }, ctx);
  const nameBg = itemName(t.item, "bg");
  const nameEn = itemName(t.item, "en");
  const cs = await store.createChangeSet({
    venue_id: t.item.venue_id,
    chat_id: null,
    summary_bg: t.kind === "sold_out" ? `${nameBg} отново в наличност` : `Специалното „${nameBg}“ изтече`,
    summary_en: t.kind === "sold_out" ? `${nameEn} back in stock` : `Special “${nameEn}” expired`,
    preview_bg: t.kind === "sold_out" ? `• ${nameBg}: отново в наличност` : `• Премахва ${nameBg}`,
    preview_en: t.kind === "sold_out" ? `• ${nameEn}: back in stock` : `• Removes ${nameEn}`,
    source: "auto",
    status: "proposed",
    changes: [change],
  });
  await store.applyChangeSet(cs.id, now);
  return cs.id;
}
```

- [ ] **Step 6: Run** `npx vitest run test/tick.test.ts` → PASS. Then `npx vitest run` → all green; `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/bot/messenger.ts src/tick.ts test/tick.test.ts test/helpers.ts
git commit -m "Tick: due scheduled sets, auto sets for elapsed timers, reminders, proposal expiry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
