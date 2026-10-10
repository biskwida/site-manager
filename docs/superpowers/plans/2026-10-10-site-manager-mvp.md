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
- Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `TELEGRAM_BOT_TOKEN`, `TICK_SECRET`, `ANTHROPIC_API_KEY`, `STT_API_KEY` are read only in `src/config.ts` (server) and `scripts/`. Nothing under `app/` or `src/i18n`, `src/lib/supabase-browser.ts` imports `src/config.ts`. Telegram file URLs (`https://api.telegram.org/file/bot<token>/…`) are never logged. Admin tokens appear only in the owner's link and the `key` parameter of admin requests.
- Agent: model `claude-opus-5-5` (env `AGENT_MODEL`), effort `medium` default (env `AGENT_EFFORT`), `high` for image/bulk/scheduled turns; `tool_choice: { type: "auto", disable_parallel_tool_use: true }`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`, `max_tokens: 16000`, `max_iterations: 30`, refusal handling.
- All tests run offline with `InMemoryStore` and fakes: `npm test` must never need network or keys.
- Next 16 specifics verified in the installed docs (`node_modules/next/dist/docs`): `after` from `next/server`; `export const maxDuration = 300` in a route file; `params`/`searchParams` are Promises; global `PageProps<'/x/[slug]'>` and `RouteContext<'/api/x'>` helpers exist after typegen; `next/font/google` `Literata` and `Onest` both have the `cyrillic` subset.
- Copy rules: no invented testimonials; pitch facts only: four venues quoted a monthly price before the product existed: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 € ("four venues already quoted us 20–70 € a month"); list price 25 €/venue/month. No contact details on the landing (user's decision 2026-10-10).

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
  private lastTick = 0;
  /** Strictly increasing clock for created_at (so newest-first ordering is stable); tests may override. */
  clock: () => string = () => {
    const t = Math.max(Date.now(), this.lastTick + 1);
    this.lastTick = t;
    return new Date(t).toISOString();
  };

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

### Task 7: Config, Supabase schema/policies, db-apply and check-rls scripts

**Files:**
- Create: `src/config.ts`, `supabase/schema.sql`, `supabase/policies.sql`, `supabase/cron.sql`, `scripts/db-apply.mts`, `scripts/check-rls.mts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env?): Config` with fields `anthropicApiKey, agentModel, agentEffort, telegramToken, telegramWebhookSecret, sttApiKey (string|null), sttBaseUrl, sttModel, supabaseUrl, supabaseAnonKey, supabaseServiceKey, publicBaseUrl, tickSecret, demoVenueSlug`; `Effort = "low" | "medium" | "high"`; `loadConfig(env, { lenient: true })` fills missing keys with `""` for the offline memory-store mode (Task 15). No SQL RPCs: the dashboard talks to server route handlers backed by `Store` (Task 18), so the anon key only ever reads the public tables.
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
  it("fills missing keys with empty strings when lenient", () => {
    const c = loadConfig({}, { lenient: true });
    expect(c.telegramToken).toBe("");
    expect(c.publicBaseUrl).toBe("http://localhost:3000");
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

/** `lenient` (offline memory-store mode) returns "" for missing secrets instead of throwing. */
export function loadConfig(env: Env = process.env, opts: { lenient?: boolean } = {}): Config {
  const need = (key: string): string => {
    const v = env[key]?.trim();
    if (!v) {
      if (opts.lenient) return "";
      throw new Error(`Missing ${key} (set it in .env.local or the Vercel project env; see .env.example)`);
    }
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
    publicBaseUrl: (need("PUBLIC_BASE_URL") || "http://localhost:3000").replace(/\/+$/, ""),
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

- [ ] **Step 6: Write `supabase/policies.sql`** (idempotent; anon read on public tables only)

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

-- 2. No RPCs: the owner dashboard and the public site read through the app's server (service-role key, never in the browser).

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
const tokens = await db.from("venue_admin_tokens").select("token").limit(1);
check("anon sees no admin tokens", (tokens.data?.length ?? 0) === 0, tokens.error?.code);
const bucket = await db.storage.from("media").list("", { limit: 1 });
check("media bucket is readable", !bucket.error, bucket.error?.message);

process.exit(failed ? 1 : 0);
```

- [ ] **Step 9: Syntax-check the SQL offline** (no database needed): run `npx tsx -e "import('node:fs').then(fs=>{for(const f of ['supabase/schema.sql','supabase/policies.sql']){const s=fs.readFileSync(f,'utf8');const o=(s.match(/\\$\\$/g)||[]).length;if(o%2)throw new Error(f+': unbalanced $$');console.log(f,'ok')}})"` and `npx tsc --noEmit` (scripts are type-checked by the root tsconfig). If `.env.local` has `SUPABASE_DB_URL`, also run `npm run db:apply` and `npm run check:rls` now and paste the output in the commit body; otherwise note "live apply skipped: no SUPABASE_DB_URL".

- [ ] **Step 10: Commit**

```bash
git add src/config.ts supabase/ scripts/db-apply.mts scripts/check-rls.mts test/config.test.ts
git commit -m "Config and Supabase: schema, RLS, realtime, storage bucket, db scripts

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

### Task 10: Agent tools, part 1 (site/menu reads, propose, cancel, list) — most capable model

**Files:**
- Create: `src/agent/tools.ts`, `src/agent/tool-schemas.ts`
- Test: `test/tools-core.test.ts`, `test/tool-call.ts` (helper)

**Interfaces:**
- Consumes: `Store` (Task 6), `Messenger` (Task 9), domain (Tasks 1–5).
- Produces: `AgentDeps { store; venueId; chatId; member; messenger; now: () => Date; baseUrl; correctionFor?: string | null }`, `makeTools(d): BetaZodTool[]` (9 tools; this task implements `get_site`, `get_menu`, `propose_changes`, `cancel_change_set`, `list_changes`; Task 11 adds the rest in the same file), `ChangeInputSchema` (zod), `resolveTokens(ops, site, now)`, `proposalText(preview, lang, applyAt, tz)`, `requireRole`.

- [ ] **Step 1: Write the tool-call helper**

```ts
// test/tool-call.ts
import type { makeTools } from "@/src/agent/tools";

type Tools = ReturnType<typeof makeTools>;

/** Finds a tool by name, runs it with already-validated input, parses the JSON string it returns. */
export async function call(tools: Tools, name: string, input: unknown): Promise<Record<string, unknown>> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const parsed = tool.inputSchema.parse(input);
  return JSON.parse(await (tool.run as (i: unknown) => Promise<string>)(parsed));
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// test/tools-core.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { FakeMessenger, makeDemo, type Demo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z"); // Fri 12:00 Sofia, open

async function setup(over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember(1001))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example", ...over };
  return { ...demo, messenger, deps, tools: makeTools(deps) } as Demo & { messenger: FakeMessenger; deps: AgentDeps; tools: ReturnType<typeof makeTools> };
}

describe("get_site / get_menu", () => {
  it("describes the venue with now, status, language and role", async () => {
    const { tools } = await setup();
    const r = await call(tools, "get_site", {});
    expect(r).toMatchObject({ owner_lang: "bg", member_role: "owner", public_url: "https://site.example/agala", pending_proposal: null });
    expect(r.now).toContain("GMT+03:00");
    expect(r.today).toEqual({ state: "open", until: "18:00", holiday: null });
    expect((r.venue as Record<string, unknown>).name).toBe("Кафене „Ъгъла“");
    expect(r.hours).toHaveProperty("mon");
  });
  it("lists active items by category with ids", async () => {
    const { tools, items } = await setup();
    const r = await call(tools, "get_menu", {});
    const cats = r.categories as { name_en: string; items: { id: string; name_en: string; price_eur: number; allergens: number[] }[] }[];
    expect(cats.map((c) => c.name_en)).toEqual(["Coffee", "Pastries", "Sandwiches & salads", "Drinks"]);
    expect(cats[0].items.find((i) => i.id === items.Cappuccino.id)).toMatchObject({ name_en: "Cappuccino", price_eur: 2.9, allergens: [7] });
  });
});

describe("propose_changes", () => {
  it("creates a proposal, sends the preview with buttons in the owner's language, stores both previews", async () => {
    const { tools, store, items, messenger, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    expect(r).toMatchObject({ status: "proposed", preview: "• Капучино: 2,90 € → 3,20 €" });
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs).toMatchObject({ status: "proposed", source: "text", chat_id: 1001, preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20", tg_message_id: 100 });
    expect(messenger.sent[0]).toMatchObject({ chatId: 1001, setId: cs.id, lang: "bg", text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9); // not applied yet
  });
  it("applies all-sold-out sets at once, resolving next_opening", async () => {
    const { tools, store, items, messenger, venue } = await setup();
    const r = await call(tools, "propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa sold out", changes: [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "next_opening" }] });
    expect(r).toMatchObject({ status: "applied", sold_out_until: "2026-10-10T06:00:00.000Z" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items["Cheese banitsa"].id)?.sold_out_until).toBe("2026-10-10T06:00:00.000Z");
    expect(messenger.sent[0].text).toBe("✅ Баница със сирене: изчерпано до 10.10.2026, 09:00");
    expect(messenger.sent[0].setId).toBeUndefined();
  });
  it("returns an error for a stale id, a pending proposal, or a closed venue with next_opening unavailable", async () => {
    const { tools, items, store, venue } = await setup();
    expect(await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: "nope", price_eur: 2 }] })).toEqual({ error: 'item_id "nope" not found; use an id from get_menu.' });
    await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }] });
    const second = await call(tools, "propose_changes", { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.6 }] });
    expect(second.error).toMatch(/already waiting for a decision/);
    const closed = { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
    const site = await store.getSite(venue.id);
    store.sites.get(venue.id)!.venue.hours = closed;
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_sold_out", item_id: site.items[0].id, until: "next_opening" }] });
    expect(r.error).toMatch(/no opening in the next 14 days/);
  });
  it("replaces the proposal the owner asked to change", async () => {
    const base = await setup();
    const first = await call(base.tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    const tools = makeTools({ ...base.deps, correctionFor: first.change_set_id as string });
    const second = await call(tools, "propose_changes", { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.4 }] });
    expect(second.status).toBe("proposed");
    expect((await base.store.getChangeSet(first.change_set_id as string)).status).toBe("cancelled");
    expect(base.messenger.edits[0]).toMatchObject({ messageId: 100 });
    expect(base.messenger.edits[0].text).toContain("✏️");
  });
  it("lets staff mark sold-out and add specials but not change prices", async () => {
    const base = await setup();
    const staff = (await base.store.findMember(1002))!;
    const tools = makeTools({ ...base.deps, chatId: 1002, member: staff });
    const denied = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    expect(denied.error).toMatch(/only the owner/);
    const ok = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "add_item", item: { category_id: base.categories.Pastries.id, name_bg: "Супа", name_en: "Soup", desc_bg: "", desc_en: "", price_eur: 4, allergens: [], is_special: true, special_expires_at: "closing_today" } }] });
    expect(ok.status).toBe("proposed");
    expect(base.messenger.last().lang).toBe("en");
    expect(base.messenger.last().text).toContain("Today's special (until 18:00)");
  });
  it("renders a preview in English for an English-speaking owner", async () => {
    const base = await setup();
    await base.store.setMemberLang(base.venue.id, 1001, "en");
    const tools = makeTools({ ...base.deps, member: { ...base.deps.member, lang: "en" } });
    const r = await call(tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_text", key: "tagline", text_bg: "Ново", text_en: "New" }] });
    expect(r.preview).toBe("• Tagline: “Coffee on the corner” → “New”\n  BG: „Кафе на ъгъла“ → „Ново“");
  });
});

describe("cancel_change_set / list_changes", () => {
  it("cancels a proposal, edits its message, and lists history newest first", async () => {
    const { tools, items, store, messenger } = await setup();
    const p = await call(tools, "propose_changes", { summary_bg: "Лате 3,50", summary_en: "Latte 3.50", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }] });
    const c = await call(tools, "cancel_change_set", { change_set_id: p.change_set_id });
    expect(c).toEqual({ change_set_id: p.change_set_id, status: "cancelled" });
    expect((await store.getChangeSet(p.change_set_id as string)).status).toBe("cancelled");
    expect(messenger.edits[0].text).toContain("❌");
    expect(await call(tools, "cancel_change_set", { change_set_id: p.change_set_id })).toEqual({ error: 'Change set is "cancelled"; only proposed or scheduled sets can be cancelled.' });
    await call(tools, "propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa out", changes: [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: null }] });
    const l = await call(tools, "list_changes", { limit: 5 });
    const sets = l.change_sets as { status: string; summary_en: string; undoable: boolean }[];
    expect(sets.map((s) => s.status)).toEqual(["applied", "cancelled"]);
    expect(sets[0]).toMatchObject({ summary_en: "Banitsa out", undoable: true });
  });
});
```

- [ ] **Step 3: Run** `npx vitest run test/tools-core.test.ts` → FAIL.

- [ ] **Step 4: Write `src/agent/tool-schemas.ts`**

```ts
// src/agent/tool-schemas.ts
import { z } from "zod";
import { ROUNDINGS } from "../domain/pricing";
import { SITE_TEXT_KEYS, VENUE_TEXT_KEYS, WEEKDAYS } from "../domain/types";

const Id = z.string().min(1);
const Price = z.number().describe("EUR with at most two decimals, 0.10–500");
const Allergens = z.array(z.number().int().min(1).max(14)).describe("EU allergen codes 1–14 (see check_allergens)");
const Until = z.string().nullable().describe('"next_opening" (the tool resolves it from the opening hours), an ISO 8601 datetime with offset, or null = back on sale');
const Expiry = z.string().nullable().describe('"closing_today" (resolved by the tool), an ISO 8601 datetime with offset, or null = no expiry');

const DayHours = z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) }).nullable();
export const HoursSchema = z.object(Object.fromEntries(WEEKDAYS.map((d) => [d, DayHours])) as Record<(typeof WEEKDAYS)[number], typeof DayHours>);

export const NewItemSchema = z.object({
  category_id: Id,
  name_bg: z.string().min(1),
  name_en: z.string().min(1),
  desc_bg: z.string().describe("One short sentence in Bulgarian; may be empty"),
  desc_en: z.string().describe("One short sentence in English; may be empty"),
  price_eur: Price,
  allergens: Allergens,
  is_special: z.boolean().describe("true for a daily special (it disappears at special_expires_at)"),
  special_expires_at: Expiry,
  image_media_id: z.string().nullable().optional(),
});

export const ChangeInputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_price"), item_id: Id, price_eur: Price }),
  z.object({ op: z.literal("set_sold_out"), item_id: Id, until: Until }),
  z.object({ op: z.literal("add_item"), item: NewItemSchema }),
  z.object({
    op: z.literal("update_item"),
    item_id: Id,
    patch: z.object({ category_id: Id.optional(), name_bg: z.string().optional(), name_en: z.string().optional(), desc_bg: z.string().optional(), desc_en: z.string().optional(), price_eur: Price.optional(), allergens: Allergens.optional(), position: z.number().int().optional() }),
  }),
  z.object({ op: z.literal("remove_item"), item_id: Id }),
  z.object({ op: z.literal("set_item_image"), item_id: Id, media_id: z.string().nullable() }),
  z.object({ op: z.literal("set_cover_image"), media_id: z.string().nullable() }),
  z.object({ op: z.literal("set_logo_image"), media_id: z.string().nullable() }),
  z.object({ op: z.literal("add_gallery_image"), media_id: Id }),
  z.object({ op: z.literal("remove_gallery_image"), media_id: Id }),
  z.object({ op: z.literal("set_hours"), hours: HoursSchema }),
  z.object({ op: z.literal("add_holiday"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note_bg: z.string().min(1), note_en: z.string().min(1) }),
  z.object({ op: z.literal("remove_holiday"), holiday_id: Id }),
  z.object({ op: z.literal("add_announcement"), text_bg: z.string().min(1), text_en: z.string().min(1), expires_at: Expiry }),
  z.object({ op: z.literal("remove_announcement"), announcement_id: Id }),
  z.object({ op: z.literal("set_text"), key: z.enum([...SITE_TEXT_KEYS, ...VENUE_TEXT_KEYS]), text_bg: z.string(), text_en: z.string() }),
  z.object({ op: z.literal("set_theme"), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
]);
export type ChangeInput = z.infer<typeof ChangeInputSchema>;

export const ProposeSchema = z.object({
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Капучино 3,20 €“"),
  summary_en: z.string().min(1).describe("The same line in English"),
  changes: z.array(ChangeInputSchema).min(1).max(40),
});
export const ScheduleSchema = ProposeSchema.extend({
  apply_at: z.string().describe("ISO 8601 datetime with offset, in the future, e.g. 2026-12-24T08:00:00+02:00"),
});
export const BulkSchema = z.object({
  summary_bg: z.string().optional(),
  summary_en: z.string().optional(),
  category_id: z.string().optional().describe("Limit to one category (id from get_menu)"),
  name_contains: z.string().optional().describe("Limit to items whose BG or EN name contains this text (case-insensitive)"),
  percent: z.number().optional().describe("e.g. 10 for +10 %, -5 for -5 %"),
  delta_eur: z.number().optional().describe("e.g. 0.2 for +0.20 €"),
  rounding: z.enum(ROUNDINGS).describe('Round the new price to this step; "0.10" is the usual choice'),
});
export const CheckAllergensSchema = z.object({ name: z.string(), desc: z.string().optional(), declared: Allergens });
export const UndoSchema = z.object({ change_set_id: z.string().describe('An id from list_changes, or "last" for the most recent applied set') });
export const ListSchema = z.object({ limit: z.number().int().min(1).max(50).default(10) });
export const CancelSchema = z.object({ change_set_id: Id });
```

- [ ] **Step 5: Write `src/agent/tools.ts`** (part 1; part 2 adds the remaining tools in Task 11)

```ts
// src/agent/tools.ts
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Messenger } from "../bot/messenger";
import { invertChanges, planChanges, type PlanContext } from "../domain/changes";
import { isSoldOut, visibleItems } from "../domain/effective";
import { itemName, tr } from "../domain/format";
import { closingToday, nextOpening, todayStatus } from "../domain/hours";
import { renderPreview } from "../domain/preview";
import type { ChangeOp, ChangeSet, ChangeSource, Lang, Member, SiteState } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime, nowText } from "../time";
import { CancelSchema, ListSchema, ProposeSchema, type ChangeInput } from "./tool-schemas";

export interface AgentDeps {
  store: Store;
  venueId: string;
  chatId: number;
  member: Member;
  messenger: Messenger;
  now: () => Date;
  /** Deployment URL without a trailing slash, for public links. */
  baseUrl: string;
  /** From the ✏️ Change button: the proposal the next propose_changes/schedule_changes replaces. */
  correctionFor?: string | null;
  /** How this turn arrived; recorded on the change set. Default "text". */
  source?: ChangeSource;
}

const STAFF_OPS = new Set<ChangeOp["op"]>(["set_sold_out", "add_item"]);

export function requireRole(member: Member, ops: ChangeOp[]): void {
  if (member.role === "owner") return;
  for (const op of ops) {
    const ok = STAFF_OPS.has(op.op) && (op.op !== "add_item" || op.item.is_special);
    if (!ok) throw new Error(`"${op.op}" is only the owner's decision; staff may mark items sold out and add today's specials. Tell the owner to send this change.`);
  }
}

/** Replaces "next_opening" / "closing_today" with ISO instants from the venue's hours. */
export function resolveTokens(ops: ChangeInput[], site: SiteState, now: Date): ChangeOp[] {
  const { hours, tz } = site.venue;
  const opening = () => {
    const iso = nextOpening(hours, site.holidays, now, tz);
    if (!iso) throw new Error("The venue has no opening in the next 14 days (check get_site hours/holidays); give an explicit ISO datetime for until, or null.");
    return iso;
  };
  const closing = () => {
    const iso = closingToday(hours, site.holidays, now, tz);
    if (!iso) throw new Error("The venue is not open right now, so closing_today has no value; give an explicit ISO datetime with offset for the expiry, or null.");
    return iso;
  };
  return ops.map((op): ChangeOp => {
    if (op.op === "set_sold_out") return { ...op, until: op.until === "next_opening" ? opening() : op.until };
    if (op.op === "add_item") return { ...op, item: { ...op.item, special_expires_at: op.item.special_expires_at === "closing_today" ? closing() : op.item.special_expires_at } };
    if (op.op === "add_announcement") return { ...op, expires_at: op.expires_at === "closing_today" ? closing() : op.expires_at };
    return op as ChangeOp;
  });
}

/** The Telegram message for a proposal: preview, optional schedule line, and the question. */
export function proposalText(preview: string, lang: Lang, applyAt: string | null, tz: string): string {
  const when = applyAt ? `\n\n${tr(lang, "⏰ Ще се приложи на", "⏰ Will be applied on")} ${formatDateTime(applyAt, lang, tz)}` : "";
  return `${preview}${when}\n\n${tr(lang, "Да приложа ли?", "Apply this?")}`;
}

const NEXT_STEP: Record<ChangeSet["status"], string> = {
  proposed: "it is waiting for the owner's decision.",
  scheduled: "it will be applied at apply_at; cancel_change_set stops it.",
  applied: "undo can revert it.",
  rejected: "propose again if the owner wants a different version.",
  expired: "propose it again.",
  cancelled: "propose it again.",
  reverted: "it was undone already.",
};

export function makeTools(d: AgentDeps) {
  // Tools run one at a time per turn, even if the runner calls several at once.
  let queue: Promise<unknown> = Promise.resolve();
  const attempt = (fn: () => Promise<unknown>): Promise<string> => {
    const run = queue.then(async () => {
      try {
        return JSON.stringify(await fn());
      } catch (e) {
        return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
      }
    });
    queue = run;
    return run;
  };

  const lang = d.member.lang;
  const site = () => d.store.getSite(d.venueId);
  const ctx = (): PlanContext => ({ newId: () => crypto.randomUUID(), now: d.now().toISOString() });
  const previews = (s: SiteState, changes: ReturnType<typeof planChanges>) => ({
    preview_bg: renderPreview(s, changes, "bg", s.venue.tz),
    preview_en: renderPreview(s, changes, "en", s.venue.tz),
  });
  const mine = (p: { preview_bg: string; preview_en: string }) => (lang === "bg" ? p.preview_bg : p.preview_en);

  const getSet = async (id: string): Promise<ChangeSet> => {
    try {
      const cs = await d.store.getChangeSet(id);
      if (cs.venue_id !== d.venueId) throw new Error("not this venue");
      return cs;
    } catch {
      throw new Error(`change_set_id "${id}" not found; use an id from list_changes.`);
    }
  };

  /** Cancels a pending proposal (because the owner asked to change it) and edits its message. */
  const cancelPending = async (cs: ChangeSet, mark: string) => {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: d.now().toISOString() });
    if (cs.chat_id !== null && cs.tg_message_id !== null) await d.messenger.edit(cs.chat_id, cs.tg_message_id, `${mine(cs)}\n\n${mark}`);
  };

  /** One proposal per chat: replace it when the owner pressed ✏️, otherwise refuse. */
  const ensureNoPending = async () => {
    const pending = await d.store.findProposed(d.venueId, d.chatId);
    if (!pending) return;
    if (d.correctionFor && pending.id === d.correctionFor) {
      await cancelPending(pending, tr(lang, "✏️ Заменено с ново предложение.", "✏️ Replaced by a new proposal."));
      return;
    }
    throw new Error(`A proposal (${pending.id}: ${lang === "bg" ? pending.summary_bg : pending.summary_en}) is already waiting for a decision. Ask the owner to tap ✅/❌ on it, or call cancel_change_set("${pending.id}") if this message clearly supersedes it.`);
  };

  /** Shared by propose_changes and schedule_changes. */
  const propose = async (input: z.infer<typeof ProposeSchema>, applyAt: string | null) => {
    const s = await site();
    const ops = resolveTokens(input.changes, s, d.now());
    requireRole(d.member, ops);
    const changes = planChanges(s, ops, ctx());
    const p = previews(s, changes);
    const instant = applyAt === null && ops.every((o) => o.op === "set_sold_out");
    if (!instant) await ensureNoPending();
    const cs = await d.store.createChangeSet({
      venue_id: d.venueId, chat_id: d.chatId, summary_bg: input.summary_bg, summary_en: input.summary_en, ...p,
      source: d.source ?? "text", status: "proposed", apply_at: applyAt, changes,
    });
    if (instant) {
      await d.store.applyChangeSet(cs.id, d.now().toISOString());
      await d.messenger.send(d.chatId, `✅ ${mine(p).replace(/^• /gm, "")}`);
      const first = ops[0] as Extract<ChangeOp, { op: "set_sold_out" }>;
      return { change_set_id: cs.id, status: "applied", preview: mine(p), sold_out_until: first.until };
    }
    const messageId = await d.messenger.sendProposal(d.chatId, proposalText(mine(p), lang, applyAt, s.venue.tz), cs.id, lang);
    if (messageId !== null) await d.store.updateChangeSet(cs.id, { tg_message_id: messageId });
    return { change_set_id: cs.id, status: "proposed", preview: mine(p), apply_at: applyAt, next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
  };

  const getSite = betaZodTool({
    name: "get_site",
    description: "The venue's texts, hours, today's status, holidays, announcements, theme, images, the current time with its UTC offset, the member's language and role, and any pending proposal. Call this first when the request touches anything but the menu.",
    inputSchema: z.object({}),
    run: () =>
      attempt(async () => {
        const s = await site();
        const now = d.now();
        const pending = await d.store.findProposed(d.venueId, d.chatId);
        return {
          venue: {
            name: s.venue.name, slug: s.venue.slug, tz: s.venue.tz, default_lang: s.venue.default_lang,
            tagline_bg: s.venue.tagline_bg, tagline_en: s.venue.tagline_en, about_bg: s.venue.about_bg, about_en: s.venue.about_en,
            address: s.venue.address, phone: s.venue.phone, maps_url: s.venue.maps_url, instagram: s.venue.instagram,
            theme: s.venue.theme, has_cover: s.venue.cover_media_id !== null, has_logo: s.venue.logo_media_id !== null,
          },
          texts: Object.fromEntries(s.texts.map((t) => [t.key, { bg: t.text_bg, en: t.text_en }])),
          hours: s.venue.hours,
          today: todayStatus(s.venue.hours, s.holidays, now, s.venue.tz),
          holidays: s.holidays.map((h) => ({ id: h.id, date: h.date, note_bg: h.note_bg, note_en: h.note_en })),
          announcements: s.announcements.map((a) => ({ id: a.id, text_bg: a.text_bg, text_en: a.text_en, expires_at: a.expires_at })),
          gallery_count: s.media.filter((m) => m.is_gallery).length,
          media_ids: s.media.map((m) => m.id),
          now: nowText(now, s.venue.tz),
          now_iso: now.toISOString(),
          owner_lang: lang,
          member_role: d.member.role,
          public_url: `${d.baseUrl}/${s.venue.slug}`,
          pending_proposal: pending ? { id: pending.id, summary: lang === "bg" ? pending.summary_bg : pending.summary_en, apply_at: pending.apply_at } : null,
        };
      }),
  });

  const getMenu = betaZodTool({
    name: "get_menu",
    description: "Categories and active items with ids, names in both languages, prices, sold-out and special state, allergens and whether they have a photo. Use the ids in propose_changes.",
    inputSchema: z.object({}),
    run: () =>
      attempt(async () => {
        const s = await site();
        const nowMs = d.now().getTime();
        const items = s.items.filter((i) => i.active);
        return {
          categories: s.categories.filter((c) => c.active).sort((a, b) => a.position - b.position).map((c) => ({
            id: c.id, name_bg: c.name_bg, name_en: c.name_en,
            items: items.filter((i) => i.category_id === c.id).sort((a, b) => a.position - b.position).map((i) => ({
              id: i.id, name_bg: i.name_bg, name_en: i.name_en, desc_bg: i.desc_bg, desc_en: i.desc_en, price_eur: i.price_eur,
              allergens: i.allergens, sold_out: isSoldOut(i, nowMs), sold_out_until: i.sold_out_until,
              is_special: i.is_special, special_expires_at: i.special_expires_at, has_image: i.image_media_id !== null,
            })),
          })),
          visible_count: visibleItems(items, nowMs).length,
        };
      }),
  });

  const proposeChanges = betaZodTool({
    name: "propose_changes",
    description: "Validate a list of changes, snapshot before/after, and send the owner a preview with ✅ Apply / ✏️ Change / ❌ Cancel buttons. Sets made only of set_sold_out apply at once (they are undoable). Returns the preview text; do not repeat it.",
    inputSchema: ProposeSchema,
    run: (input) => attempt(() => propose(input, null)),
  });

  const cancelChangeSet = betaZodTool({
    name: "cancel_change_set",
    description: "Cancel a proposed or scheduled change set (for example when the owner's new message supersedes a pending proposal).",
    inputSchema: CancelSchema,
    run: (input) =>
      attempt(async () => {
        const cs = await getSet(input.change_set_id);
        if (cs.status !== "proposed" && cs.status !== "scheduled") throw new Error(`Change set is "${cs.status}"; only proposed or scheduled sets can be cancelled.`);
        await cancelPending(cs, tr(lang, "❌ Отказано.", "❌ Cancelled."));
        return { change_set_id: cs.id, status: "cancelled" };
      }),
  });

  const listChanges = betaZodTool({
    name: "list_changes",
    description: "Recent change sets for this venue, newest first, with status and whether undo can revert them.",
    inputSchema: ListSchema,
    run: (input) =>
      attempt(async () => {
        const sets = await d.store.listChangeSets(d.venueId, { limit: input.limit });
        return {
          change_sets: sets.map((cs) => ({
            id: cs.id, status: cs.status, source: cs.source, summary_bg: cs.summary_bg, summary_en: cs.summary_en,
            created_at: cs.created_at, applied_at: cs.applied_at, apply_at: cs.apply_at, undoable: cs.status === "applied",
            next: NEXT_STEP[cs.status],
          })),
        };
      }),
  });

  // Task 11 appends schedule_changes, propose_bulk_price_change, check_allergens, undo here.
  return [getSite, getMenu, proposeChanges, cancelChangeSet, listChanges, ...extraTools(d, { attempt, site, ctx, previews, mine, propose, getSet, ensureNoPending, lang })];
}

/** Hook for Task 11; returns [] until then. */
export interface ToolKit {
  attempt: (fn: () => Promise<unknown>) => Promise<string>;
  site: () => Promise<SiteState>;
  ctx: () => PlanContext;
  previews: (s: SiteState, changes: ReturnType<typeof planChanges>) => { preview_bg: string; preview_en: string };
  mine: (p: { preview_bg: string; preview_en: string }) => string;
  propose: (input: z.infer<typeof ProposeSchema>, applyAt: string | null) => Promise<unknown>;
  getSet: (id: string) => Promise<ChangeSet>;
  ensureNoPending: () => Promise<void>;
  lang: Lang;
}
function extraTools(_d: AgentDeps, _kit: ToolKit): ReturnType<typeof betaZodTool>[] {
  return [];
}
export { itemName as _itemName, invertChanges as _invertChanges }; // re-exports used by Task 11; remove when extraTools is filled in
```

Note for the implementer: `extraTools` is a seam so Task 11 can add tools in the same file without re-reading this whole block; Task 11 replaces its body and deletes the throwaway re-export line.

- [ ] **Step 6: Run** `npx vitest run test/tools-core.test.ts` → PASS. `npx tsc --noEmit` clean (if `betaZodTool` typing of a discriminated union errors, wrap `inputSchema: ProposeSchema` as-is and type `run`'s input via `z.infer`; do not weaken the schema).

- [ ] **Step 7: Commit**

```bash
git add src/agent/tools.ts src/agent/tool-schemas.ts test/tools-core.test.ts test/tool-call.ts
git commit -m "Agent tools: get_site, get_menu, propose_changes (instant sold-out, previews, buttons), cancel, list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Agent tools, part 2 (schedule, bulk prices, allergen check, undo) — most capable model

**Files:**
- Modify: `src/agent/tools.ts` (fill `extraTools`)
- Test: `test/tools-more.test.ts`

**Interfaces:**
- Consumes: `ToolKit` seam (Task 10), `bulkPrices` (Task 3), `allergenWarnings`/`allergenName` (Task 2), `invertChanges` (Task 4).
- Produces: tools `schedule_changes`, `propose_bulk_price_change`, `check_allergens`, `undo`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/tools-more.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup() {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember(1001))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example" };
  return { ...demo, messenger, deps, tools: makeTools(deps) };
}

describe("schedule_changes", () => {
  it("creates a proposal with apply_at and says so in the message", async () => {
    const { tools, store, messenger } = await setup();
    const r = await call(tools, "schedule_changes", { summary_bg: "Коледни почивни дни", summary_en: "Christmas closure", apply_at: "2026-12-20T08:00:00+02:00", changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }, { op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] });
    expect(r).toMatchObject({ status: "proposed", apply_at: "2026-12-20T06:00:00.000Z" });
    expect((await store.getChangeSet(r.change_set_id as string)).apply_at).toBe("2026-12-20T06:00:00.000Z");
    expect(messenger.sent[0].text).toContain("⏰ Ще се приложи на 20.12.2026, 08:00");
    expect(messenger.sent[0].text).toContain("• Почивен ден 24.12.2026: Бъдни вечер / Christmas Eve");
  });
  it("rejects a past or malformed apply_at", async () => {
    const { tools, items } = await setup();
    const past = await call(tools, "schedule_changes", { summary_bg: "x", summary_en: "x", apply_at: "2026-10-01T08:00:00+03:00", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3 }] });
    expect(past.error).toMatch(/in the future/);
    const bad = await call(tools, "schedule_changes", { summary_bg: "x", summary_en: "x", apply_at: "tomorrow 8am", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3 }] });
    expect(bad.error).toMatch(/ISO 8601/);
  });
});

describe("propose_bulk_price_change", () => {
  it("computes rounded prices for a category and proposes set_price ops", async () => {
    const { tools, categories, store, messenger } = await setup();
    const r = await call(tools, "propose_bulk_price_change", { category_id: categories.Coffee.id, percent: 10, rounding: "0.10" });
    const rows = r.rows as { name_en: string; old_eur: number; new_eur: number }[];
    expect(rows).toEqual([
      { item_id: expect.any(String), name_bg: "Еспресо", name_en: "Espresso", old_eur: 1.8, new_eur: 2.0 },
      { item_id: expect.any(String), name_bg: "Капучино", name_en: "Cappuccino", old_eur: 2.9, new_eur: 3.2 },
      { item_id: expect.any(String), name_bg: "Лате", name_en: "Latte", old_eur: 3.2, new_eur: 3.5 },
      { item_id: expect.any(String), name_bg: "Чай", name_en: "Tea", old_eur: 2.0, new_eur: 2.2 },
    ]);
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes).toHaveLength(4);
    expect(cs.summary_bg).toBe("Цени +10 % (Кафе), закръглени до 0.10 €");
    expect(cs.summary_en).toBe("Prices +10 % (Coffee), rounded to €0.10");
    expect(messenger.sent[0].text.split("\n")[0]).toBe("• Еспресо: 1,80 € → 2,00 €");
  });
  it("filters by name, skips unchanged prices, and errors when nothing matches", async () => {
    const { tools } = await setup();
    const r = await call(tools, "propose_bulk_price_change", { name_contains: "сандвич", delta_eur: 0.5, rounding: "none", summary_bg: "Сандвичите +0,50", summary_en: "Sandwiches +0.50" });
    expect((r.rows as unknown[]).length).toBe(2);
    const none = await call(tools, "propose_bulk_price_change", { name_contains: "pizza", percent: 5, rounding: "none" });
    expect(none.error).toMatch(/No active items match/);
  });
});

describe("check_allergens", () => {
  it("returns suggestions and warnings with names in both languages", async () => {
    const { tools } = await setup();
    const r = await call(tools, "check_allergens", { name: "Кроасан с масло", declared: [1] });
    expect(r).toEqual({ suggested: [1, 7], warnings: [{ code: 7, keyword: "масло", name_bg: "Мляко", name_en: "Milk" }], ok: false, note: "Keyword-based and advisory: mention the warnings in the preview and let the owner decide." });
    expect((await call(tools, "check_allergens", { name: "Fresh orange juice", declared: [] })).ok).toBe(true);
  });
});

describe("undo", () => {
  it("proposes the inverse of the last applied set and, once approved, marks it reverted", async () => {
    const { tools, store, items, messenger, venue, deps } = await setup();
    const p = await call(tools, "propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] });
    await store.applyChangeSet(p.change_set_id as string, T0.toISOString());
    const u = await call(tools, "undo", { change_set_id: "last" });
    expect(u).toMatchObject({ status: "proposed", undoes: p.change_set_id, preview: "• Капучино: 3,20 € → 2,90 €" });
    const undoSet = await store.getChangeSet(u.change_set_id as string);
    expect(undoSet).toMatchObject({ source: "undo", undoes_id: p.change_set_id, summary_bg: "Отмяна: Капучино 3,20 €", summary_en: "Undo: Cappuccino €3.20" });
    expect(messenger.last().setId).toBe(undoSet.id);
    await store.applyChangeSet(undoSet.id, deps.now().toISOString());
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    expect((await store.getChangeSet(p.change_set_id as string)).status).toBe("reverted");
  });
  it("refuses when nothing is applied, when the set is not applied, and for staff", async () => {
    const base = await setup();
    expect((await call(base.tools, "undo", { change_set_id: "last" })).error).toMatch(/Nothing to undo/);
    const p = await call(base.tools, "propose_changes", { summary_bg: "x", summary_en: "x", changes: [{ op: "set_price", item_id: base.items.Latte.id, price_eur: 3.5 }] });
    expect((await call(base.tools, "undo", { change_set_id: p.change_set_id })).error).toMatch(/"proposed"/);
    const staff = (await base.store.findMember(1002))!;
    const staffTools = makeTools({ ...base.deps, chatId: 1002, member: staff });
    expect((await call(staffTools, "undo", { change_set_id: "last" })).error).toMatch(/only the owner/);
  });
  it("skips auto sets when looking for the last one", async () => {
    const { tools, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const real = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Истинска", summary_en: "Real", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Tea.id, price_eur: 2.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await store.applyChangeSet(real.id, T0.toISOString());
    const auto = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "авто", summary_en: "auto", preview_bg: "p", preview_en: "p", source: "auto", status: "proposed", changes: [] });
    await store.applyChangeSet(auto.id, "2026-10-09T09:01:00.000Z");
    const u = await call(tools, "undo", { change_set_id: "last" });
    expect(u.undoes).toBe(real.id);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run test/tools-more.test.ts` → FAIL (tools missing).

- [ ] **Step 3: Fill in `extraTools` in `src/agent/tools.ts`** (replace the stub and remove the throwaway re-export line)

```ts
// src/agent/tools.ts — replace `function extraTools(...) { return []; }` with:
import { allergenName, allergenWarnings, suggestAllergens } from "../domain/allergens";
import { bulkPrices } from "../domain/pricing";
import { categoryName } from "../domain/format";
import { BulkSchema, CheckAllergensSchema, ScheduleSchema, UndoSchema } from "./tool-schemas";
// (move these imports to the top of the file)

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

function extraTools(d: AgentDeps, k: ToolKit) {
  const scheduleChanges = betaZodTool({
    name: "schedule_changes",
    description: "Like propose_changes, but the set is applied at apply_at (ISO 8601 with offset, in the future) after the owner approves. The owner gets a reminder 24 h before. Use for holidays, seasonal prices, announcements that start later.",
    inputSchema: ScheduleSchema,
    run: (input) =>
      k.attempt(async () => {
        if (!ISO_WITH_OFFSET.test(input.apply_at) || Number.isNaN(Date.parse(input.apply_at))) throw new Error("apply_at must be an ISO 8601 datetime with offset, e.g. 2026-12-24T08:00:00+02:00.");
        const applyAt = new Date(input.apply_at).toISOString();
        if (Date.parse(applyAt) <= d.now().getTime()) throw new Error("apply_at must be in the future; for an immediate change use propose_changes.");
        return k.propose(input, applyAt);
      }),
  });

  const bulk = betaZodTool({
    name: "propose_bulk_price_change",
    description: "Change many prices at once by a percentage or a fixed amount, with rounding. The tool does the arithmetic and sends the owner a table preview. Filter by category_id and/or name_contains; no filter = every active item.",
    inputSchema: BulkSchema,
    run: (input) =>
      k.attempt(async () => {
        const s = await k.site();
        const needle = input.name_contains?.toLowerCase();
        const cat = input.category_id ? s.categories.find((c) => c.id === input.category_id) : undefined;
        if (input.category_id && !cat) throw new Error(`category_id "${input.category_id}" not found; use an id from get_menu.`);
        const targets = s.items.filter((i) => i.active && !i.is_special && (!cat || i.category_id === cat.id) && (!needle || i.name_bg.toLowerCase().includes(needle) || i.name_en.toLowerCase().includes(needle)));
        if (targets.length === 0) throw new Error("No active items match that filter; check get_menu.");
        const rows = bulkPrices(targets, { percent: input.percent, delta_eur: input.delta_eur, rounding: input.rounding });
        const changed = rows.filter((r) => r.new_eur !== r.old_eur);
        if (changed.length === 0) throw new Error("Every price would stay the same after rounding; choose a finer rounding or a bigger change.");
        const amount = input.percent !== undefined ? `${input.percent > 0 ? "+" : ""}${input.percent} %` : `${(input.delta_eur as number) > 0 ? "+" : ""}${(input.delta_eur as number).toFixed(2)} €`;
        const scope = cat ? { bg: ` (${categoryName(cat, "bg")})`, en: ` (${categoryName(cat, "en")})` } : needle ? { bg: ` („${input.name_contains}“)`, en: ` (“${input.name_contains}”)` } : { bg: "", en: "" };
        const round = input.rounding === "none" ? { bg: "", en: "" } : { bg: `, закръглени до ${input.rounding} €`, en: `, rounded to €${input.rounding}` };
        const summary_bg = input.summary_bg ?? `Цени ${amount}${scope.bg}${round.bg}`;
        const summary_en = input.summary_en ?? `Prices ${amount}${scope.en}${round.en}`;
        const result = (await k.propose({ summary_bg, summary_en, changes: changed.map((r) => ({ op: "set_price" as const, item_id: r.item_id, price_eur: r.new_eur })) }, null)) as Record<string, unknown>;
        return { ...result, rows };
      }),
  });

  const checkAllergens = betaZodTool({
    name: "check_allergens",
    description: "Keyword check of a dish name/description against the 14 EU allergens. Returns suggested codes and warnings for suggested-but-undeclared ones. Call it before add_item or a rename; mention warnings in your reply.",
    inputSchema: CheckAllergensSchema,
    run: (input) =>
      k.attempt(async () => {
        const text = `${input.name} ${input.desc ?? ""}`;
        const warnings = allergenWarnings(input.declared, text).map((w) => ({ ...w, name_bg: allergenName(w.code, "bg"), name_en: allergenName(w.code, "en") }));
        return { suggested: suggestAllergens(text), warnings, ok: warnings.length === 0, note: "Keyword-based and advisory: mention the warnings in the preview and let the owner decide." };
      }),
  });

  const undo = betaZodTool({
    name: "undo",
    description: 'Propose reverting an applied change set ("last" = the most recent applied one that was not automatic). The owner approves with the buttons; the inverse is applied as a new set.',
    inputSchema: UndoSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("undo is only the owner's decision; tell the owner.");
        let target: ChangeSet | undefined;
        if (input.change_set_id === "last") {
          target = (await d.store.listChangeSets(d.venueId, { status: ["applied"], limit: 50 })).find((cs) => cs.source !== "auto");
          if (!target) throw new Error("Nothing to undo: no applied change set yet.");
        } else {
          target = await k.getSet(input.change_set_id);
          if (target.status !== "applied") throw new Error(`Change set is "${target.status}"; only applied sets can be undone. ${NEXT_STEP[target.status]}`);
        }
        await k.ensureNoPending();
        const s = await k.site();
        const changes = invertChanges(target.changes);
        const p = k.previews(s, changes);
        const cs = await d.store.createChangeSet({
          venue_id: d.venueId, chat_id: d.chatId, summary_bg: `Отмяна: ${target.summary_bg}`, summary_en: `Undo: ${target.summary_en}`, ...p,
          source: "undo", status: "proposed", undoes_id: target.id, changes,
        });
        const messageId = await d.messenger.sendProposal(d.chatId, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
        if (messageId !== null) await d.store.updateChangeSet(cs.id, { tg_message_id: messageId });
        return { change_set_id: cs.id, status: "proposed", undoes: target.id, preview: k.mine(p), next: "The owner decides with the buttons." };
      }),
  });

  return [scheduleChanges, bulk, checkAllergens, undo];
}
```

Also add `source` to the `ToolKit` seam if `k.propose` needs it (it does not: `propose` closes over `d`). Keep `renderPreview` of the undo against the **current** state so the preview shows "3,20 € → 2,90 €".

- [ ] **Step 4: Run** `npx vitest run test/tools-more.test.ts test/tools-core.test.ts` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts test/tools-more.test.ts
git commit -m "Agent tools: schedule, bulk price change, allergen check, undo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Prompt, conversation memory and the run loop — most capable model

**Files:**
- Create: `src/agent/prompt.ts`, `src/agent/memory.ts`, `src/agent/run.ts`
- Test: `test/memory.test.ts`, `test/run.test.ts`

**Interfaces:**
- Consumes: `makeTools`, `AgentDeps` (Tasks 10–11), `Config.Effort` (Task 7), `Store` conversations (Task 6).
- Produces: `SYSTEM_PROMPT`, `userMessage(ctx: UserMessageContext): string`; `loadMemory(store, venueId, chatId, now): Promise<{ text: string; correctionFor: string | null }>`, `appendMemory(store, venueId, chatId, turn, now)`, `setCorrection(store, venueId, chatId, setId, now)`, `MEMORY_TURNS = 8`, `MEMORY_TTL_MS`; `ImageInput { data: string; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }`, `TurnInput { text; source; image?; mediaId? }`, `AgentConfig { model; effort; apiKey? }`, `pickEffort(base, { hasImage, text })`, `runTurn(deps, input, cfg, client?)`.

- [ ] **Step 1: Write the failing memory tests**

```ts
// test/memory.test.ts
import { describe, expect, it } from "vitest";
import { appendMemory, loadMemory, MEMORY_TURNS, setCorrection } from "@/src/agent/memory";
import { InMemoryStore } from "@/src/store/memory";

const T = (min: number) => new Date(Date.parse("2026-10-09T09:00:00.000Z") + min * 60_000);

describe("conversation memory", () => {
  it("is empty at first and renders the last 8 turns as text", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    expect(await loadMemory(s, v.id, 1, T(0))).toEqual({ text: "", correctionFor: null });
    for (let i = 1; i <= 10; i++) await appendMemory(s, v.id, 1, { at: T(i).toISOString(), owner: `msg ${i}`, agent: `reply ${i}`, outcome: i % 2 ? "applied" : undefined }, T(i));
    const m = await loadMemory(s, v.id, 1, T(11));
    const lines = m.text.split("\n");
    expect(lines[0]).toBe("Recent conversation (oldest first):");
    expect(m.text).not.toContain("msg 2\n");
    expect(m.text).toContain("Owner: msg 3");
    expect(m.text).toContain("Agent: reply 10");
    expect(m.text).toContain("Outcome: applied");
    expect((await s.getConversation(v.id, 1))?.turns).toHaveLength(MEMORY_TURNS);
  });
  it("forgets after 30 minutes", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await appendMemory(s, v.id, 1, { at: T(0).toISOString(), owner: "a", agent: "b" }, T(0));
    expect((await loadMemory(s, v.id, 1, T(29))).text).toContain("Owner: a");
    expect((await loadMemory(s, v.id, 1, T(31))).text).toBe("");
  });
  it("keeps the correction marker until the next turn is appended", async () => {
    const s = new InMemoryStore();
    const v = await s.createVenue({ slug: "m", name: "M" });
    await setCorrection(s, v.id, 1, "set-1", T(0));
    expect((await loadMemory(s, v.id, 1, T(1))).correctionFor).toBe("set-1");
    await appendMemory(s, v.id, 1, { at: T(1).toISOString(), owner: "a", agent: "b" }, T(1));
    expect((await loadMemory(s, v.id, 1, T(2))).correctionFor).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `src/agent/memory.ts`**

```ts
// src/agent/memory.ts
import type { ConversationTurn } from "../domain/types";
import type { Store } from "../store/types";

export const MEMORY_TURNS = 8;
export const MEMORY_TTL_MS = 30 * 60_000;

export function renderMemory(turns: ConversationTurn[]): string {
  if (turns.length === 0) return "";
  const lines = ["Recent conversation (oldest first):"];
  for (const t of turns) {
    lines.push(`Owner: ${t.owner}`);
    lines.push(`Agent: ${t.agent}`);
    if (t.outcome) lines.push(`Outcome: ${t.outcome}`);
  }
  return lines.join("\n");
}

/** Plain-text memory for the next user message. Expired memory is dropped (and cleared in the store). */
export async function loadMemory(store: Store, venueId: string, chatId: number, now: Date): Promise<{ text: string; correctionFor: string | null }> {
  const c = await store.getConversation(venueId, chatId);
  if (!c) return { text: "", correctionFor: null };
  if (now.getTime() - Date.parse(c.updated_at) > MEMORY_TTL_MS) {
    await store.setConversation(venueId, chatId, { turns: [], correction_for: null, updated_at: now.toISOString() });
    return { text: "", correctionFor: null };
  }
  return { text: renderMemory(c.turns), correctionFor: c.correction_for };
}

export async function appendMemory(store: Store, venueId: string, chatId: number, turn: ConversationTurn, now: Date): Promise<void> {
  const c = await store.getConversation(venueId, chatId);
  const fresh = c && now.getTime() - Date.parse(c.updated_at) <= MEMORY_TTL_MS ? c.turns : [];
  await store.setConversation(venueId, chatId, { turns: [...fresh, turn].slice(-MEMORY_TURNS), correction_for: null, updated_at: now.toISOString() });
}

export async function setCorrection(store: Store, venueId: string, chatId: number, setId: string | null, now: Date): Promise<void> {
  const c = await store.getConversation(venueId, chatId);
  await store.setConversation(venueId, chatId, { turns: c?.turns ?? [], correction_for: setId, updated_at: now.toISOString() });
}
```

- [ ] **Step 3: Run** `npx vitest run test/memory.test.ts` → PASS.

- [ ] **Step 4: Write `src/agent/prompt.ts`**

```ts
// src/agent/prompt.ts
import type { Lang, Role } from "../domain/types";

export const SYSTEM_PROMPT = `You manage the website of one café or restaurant on behalf of its owner, who talks to you on Telegram in Bulgarian or English, by text, voice note (already transcribed) or photo. You act only through your tools; nothing changes on the site except through propose_changes, schedule_changes, propose_bulk_price_change or undo, and the owner approves every proposal with buttons (sold-out marks apply at once).

How to work:
1. Read first. Call get_menu for anything about dishes, prices or availability; call get_site for hours, holidays, texts, images, announcements, theme, or when you need the current time. Use only ids these tools returned.
2. Understand casual speech. "Капучиното става три и двайсет" means the cappuccino price becomes 3.20 €. "Баницата свърши" means the cheese banitsa is sold out until the next opening (until: "next_opening"). "Затворени сме на 24 и 25 декември" means two holidays. A photo of a specials board means add_item with is_special true and special_expires_at "closing_today" for each dish you can read, with its price. "Това е новата снимка на капучиното" with a photo means set_item_image with the media_id you were given. "Смени корицата" with a photo means set_cover_image. "Върни ..." usually means undo.
3. One proposal per message, with every change the owner asked for in it. Pick the closest matching item by name in either language; if two items could be meant, ask one short question instead of guessing. If a category is unclear for a new dish, ask. Never invent ingredients, prices or allergens.
4. Languages: every text you store needs both Bulgarian (…_bg) and English (…_en). When the owner gives one language, write the other yourself: same meaning, natural tone, no literal word-for-word translation. Keep names of dishes as the owner wrote them in their language. Prices are EUR with two decimals.
5. Numbers and time: the tools do arithmetic (propose_bulk_price_change) and resolve "next_opening" and "closing_today". For explicit times write ISO 8601 with the UTC offset shown in the Now line. Spoken Bulgarian numbers: "три и двайсет" = 3.20, "две и петдесет" = 2.50, "четири и половина" = 4.50, "пет лева" still means 5.00 € here (the menu is in euro).
6. New dishes: call check_allergens with the name and description before add_item, declare the suggested allergens unless the owner says otherwise, and mention any warning in one short sentence after proposing.
7. Pending proposals: get_site shows one if it exists. If the owner's message is a correction to it, your propose_changes replaces it automatically. If the owner clearly wants something else, call cancel_change_set first. If they are just chatting, answer briefly and leave it.
8. Errors from tools are instructions: read the message, fix the call, try once more. Status-aware messages say what to do next.

Replying: the preview with buttons is sent by the tool, so after a proposal reply with at most one short sentence in the owner's language (for example a warning, or the time a sold-out item returns), or nothing. For questions or chit-chat reply briefly and warmly in the owner's language. No markdown, no emojis except the ones in the previews, no English to a Bulgarian owner.`;

export interface UserMessageContext {
  venueName: string;
  slug: string;
  nowText: string;
  lang: Lang;
  role: Role;
  memory: string;
  correctionFor: string | null;
  mediaId?: string;
  text: string;
  source: "text" | "voice" | "photo";
}

export function userMessage(c: UserMessageContext): string {
  const parts = [
    `Venue: ${c.venueName} (slug ${c.slug}).`,
    `Now: ${c.nowText}.`,
    `Owner language: ${c.lang === "bg" ? "Bulgarian" : "English"}. Member role: ${c.role}.`,
  ];
  if (c.memory) parts.push("", c.memory);
  if (c.correctionFor) parts.push("", `The owner tapped ✏️ Change on proposal ${c.correctionFor}: this message corrects it; propose the corrected version (it replaces the old one).`);
  if (c.mediaId) parts.push("", `The attached photo was stored as media_id: ${c.mediaId}. Use that id for image changes.`);
  parts.push("", c.source === "voice" ? "Transcribed voice note from the owner:" : c.source === "photo" ? "Caption sent with the photo (may be empty):" : "Message from the owner:", c.text);
  return parts.join("\n");
}
```

- [ ] **Step 5: Write the failing run tests**

```ts
// test/run.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentDeps } from "@/src/agent/tools";
import { pickEffort, runTurn } from "@/src/agent/run";
import { appendMemory } from "@/src/agent/memory";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

/** A fake Anthropic client: records the params, optionally runs scripted tool calls, returns a final message. */
function fakeClient(script: { tool: string; input: unknown }[] = [], final: { stop_reason: string; text: string } = { stop_reason: "end_turn", text: "Готово." }) {
  const calls: Record<string, unknown>[] = [];
  const toolResults: string[] = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params: Record<string, unknown>) {
          calls.push(params);
          const run = (async () => {
            const tools = params.tools as { name: string; run: (i: unknown) => Promise<string> }[];
            for (const step of script) toolResults.push(await tools.find((t) => t.name === step.tool)!.run(step.input));
            return { stop_reason: final.stop_reason, content: [{ type: "text", text: final.text }] };
          })();
          return { then: run.then.bind(run) };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls, toolResults };
}

async function setup() {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember(1001))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example" };
  return { ...demo, messenger, deps };
}

describe("pickEffort", () => {
  it("raises effort for images, bulk and scheduling cues", () => {
    expect(pickEffort("medium", { hasImage: false, text: "Капучиното става 3,20" })).toBe("medium");
    expect(pickEffort("medium", { hasImage: true, text: "" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "Вдигни всички кафета с 10%" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "From Monday the latte is 3.50" })).toBe("high");
    expect(pickEffort("low", { hasImage: false, text: "затворени сме утре" })).toBe("high");
    expect(pickEffort("high", { hasImage: false, text: "hi" })).toBe("high");
  });
});

describe("runTurn", () => {
  it("sends the right params, memory and image block, relays the final text and stores memory", async () => {
    const { deps, messenger, store, venue } = await setup();
    await appendMemory(store, venue.id, 1001, { at: T0.toISOString(), owner: "здравей", agent: "Здравейте!" }, T0);
    const { client, calls } = fakeClient([], { stop_reason: "end_turn", text: "Готово, върнах я." });
    const out = await runTurn(deps, { text: "това е новата корица", source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: "m-1" }, { model: "claude-opus-5-5", effort: "medium" }, client);
    expect(out).toBe("Готово, върнах я.");
    const p = calls[0];
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "high" }, tool_choice: { type: "auto", disable_parallel_tool_use: true }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect((p.tools as unknown[]).length).toBe(9);
    const msg = (p.messages as { content: { type: string; text?: string; source?: { data: string } }[] }[])[0];
    expect(msg.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(msg.content[1].text).toContain("Owner: здравей");
    expect(msg.content[1].text).toContain("media_id: m-1");
    expect(msg.content[1].text).toContain("GMT+03:00");
    expect(messenger.sent[0]).toMatchObject({ chatId: 1001, text: "Готово, върнах я." });
    const conv = await store.getConversation(venue.id, 1001);
    expect(conv?.turns).toHaveLength(2);
    expect(conv?.turns[1]).toMatchObject({ owner: "[photo] това е новата корица", agent: "Готово, върнах я." });
  });
  it("records the proposal outcome and does not relay an empty final text", async () => {
    const { deps, messenger, store, venue, items } = await setup();
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "капучиното става три и двайсет", source: "voice" }, { model: "m", effort: "medium" }, client);
    expect(messenger.sent).toHaveLength(1); // only the proposal
    expect(messenger.sent[0].setId).toBeDefined();
    const conv = await store.getConversation(venue.id, 1001);
    expect(conv?.turns[0].outcome).toBe("proposed: Капучино 3,20 € (waiting for the owner's decision)");
  });
  it("tells the owner when the model refuses or errors", async () => {
    const { deps, messenger } = await setup();
    const { client } = fakeClient([], { stop_reason: "refusal", text: "" });
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, client)).toBe("refused");
    expect(messenger.sent[0].text).toBe("Не мога да изпълня това. Опитайте с друга формулировка.");
    const boom = { beta: { messages: { toolRunner() { throw new Error("network down"); } } } } as unknown as Anthropic;
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, boom)).toBe("error");
    expect(messenger.sent[1].text).toBe("Възникна грешка. Опитайте отново след малко.");
  });
  it("passes correctionFor from memory into the tools", async () => {
    const { deps, store, venue, items } = await setup();
    const { setCorrection } = await import("@/src/agent/memory");
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const old = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", tg_message_id: 7, changes: planChanges(site, [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }], { newId: () => "n", now: T0.toISOString() }) });
    await setCorrection(store, venue.id, 1001, old.id, T0);
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.4 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "не, 3,40", source: "text" }, { model: "m", effort: "medium" }, client);
    expect((await store.getChangeSet(old.id)).status).toBe("cancelled");
    expect(await store.findProposed(venue.id, 1001)).not.toBeNull();
  });
});
```

- [ ] **Step 6: Implement `src/agent/run.ts`**

```ts
// src/agent/run.ts
import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "../config";
import { tr } from "../domain/format";
import type { ChangeSource } from "../domain/types";
import { nowText } from "../time";
import { appendMemory, loadMemory } from "./memory";
import { SYSTEM_PROMPT, userMessage } from "./prompt";
import { makeTools, type AgentDeps } from "./tools";

export interface ImageInput {
  data: string; // base64
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}
export interface TurnInput {
  text: string;
  source: Extract<ChangeSource, "text" | "voice" | "photo">;
  image?: ImageInput;
  mediaId?: string;
}
export interface AgentConfig {
  model: string;
  effort: Effort;
  apiKey?: string;
}

/** Bulk and scheduling cues in BG/EN; image turns are always high. */
const HIGH_CUES = /всички|всичк|процент|%|вдигни|намали|увеличи|all the|every|bulk|raise|increase|lower|reduce|утре|tomorrow|от понеделник|от вторник|от сряда|от четвъртък|от петък|от събота|от неделя|from monday|from tuesday|from wednesday|from thursday|from friday|from saturday|from sunday|next week|следващата седмица|насрочи|schedule|в \d{1,2}[:.]\d{2}|at \d{1,2}(:\d{2})?\s?(am|pm)?\b.*(tomorrow|on )|декември|януари|december|january/i;

export function pickEffort(base: Effort, input: { hasImage: boolean; text: string }): Effort {
  if (base === "high" || input.hasImage) return "high";
  return HIGH_CUES.test(input.text) ? "high" : base;
}

/** One owner message → one agent turn. Never throws; tells the owner on refusal/error. Returns the final text, "refused" or "error". */
export async function runTurn(deps: AgentDeps, input: TurnInput, cfg: AgentConfig, client?: Anthropic): Promise<string> {
  const now = deps.now();
  const venue = await deps.store.getVenue(deps.venueId);
  const memory = await loadMemory(deps.store, deps.venueId, deps.chatId, now);
  const lang = deps.member.lang;
  const text = userMessage({
    venueName: venue.name, slug: venue.slug, nowText: nowText(now, venue.tz), lang, role: deps.member.role,
    memory: memory.text, correctionFor: memory.correctionFor, mediaId: input.mediaId, text: input.text, source: input.source,
  });
  const content = [
    ...(input.image ? [{ type: "image" as const, source: { type: "base64" as const, media_type: input.image.media_type, data: input.image.data } }] : []),
    { type: "text" as const, text },
  ];
  const tools = makeTools({ ...deps, correctionFor: memory.correctionFor, source: input.source });
  const ownerLine = `${input.source === "voice" ? "[voice] " : input.source === "photo" ? "[photo] " : ""}${input.text}`.trim();

  const closeOut = async (reply: string, outcome?: string) => {
    if (reply) await deps.messenger.send(deps.chatId, reply);
    await appendMemory(deps.store, deps.venueId, deps.chatId, { at: now.toISOString(), owner: ownerLine, agent: reply || "(no reply)", outcome }, now);
  };

  let final: { stop_reason: string | null; content: { type: string; text?: string }[] };
  try {
    const anthropic = client ?? new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : undefined);
    final = await anthropic.beta.messages.toolRunner({
      model: cfg.model,
      max_tokens: 16000,
      max_iterations: 30,
      output_config: { effort: pickEffort(cfg.effort, { hasImage: !!input.image, text: input.text }) },
      // One tool call at a time: proposals must be sequential and the queue in makeTools expects it.
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      tools,
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    console.error("[agent] turn failed:", e instanceof Error ? e.message : e);
    await closeOut(tr(lang, "Възникна грешка. Опитайте отново след малко.", "Something went wrong. Please try again in a moment."), "error");
    return "error";
  }

  if (final.stop_reason === "refusal") {
    await closeOut(tr(lang, "Не мога да изпълня това. Опитайте с друга формулировка.", "I can't do that one. Try putting it differently."), "refused");
    return "refused";
  }
  const reply = final.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("\n").trim();
  const pending = await deps.store.findProposed(deps.venueId, deps.chatId);
  const outcome = pending ? `proposed: ${lang === "bg" ? pending.summary_bg : pending.summary_en} (waiting for the owner's decision)` : undefined;
  await closeOut(reply, outcome);
  return reply;
}
```

- [ ] **Step 7: Run** `npx vitest run test/run.test.ts test/memory.test.ts` → PASS. If the SDK's `toolRunner` type rejects `fallbacks: "default"` or `betas`, check `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.ts` for the exact field names (`BetaFallbacksParam`) and keep the semantics; do not drop the option.

- [ ] **Step 8: Commit**

```bash
git add src/agent/prompt.ts src/agent/memory.ts src/agent/run.ts test/memory.test.ts test/run.test.ts
git commit -m "Agent: bilingual system prompt, 30-minute conversation memory, run loop with effort routing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Telegram bot: commands, text, approval buttons

**Files:**
- Create: `src/bot/copy.ts`, `src/bot/approvals.ts`, `src/bot/bot.ts`
- Test: `test/tg.ts` (helpers), `test/approvals.test.ts`, `test/bot.test.ts`

**Interfaces:**
- Consumes: `Store`, `Messenger`, `setCorrection` (Task 12), `ImageInput` (Task 12), `proposalKeyboard` (Task 9).
- Produces: `copy(lang)` strings; `parseCallback(data)`, `handleDecision(d, chatId, decision, setId)`; `RunRequest { venueId; chatId; member; text; source; image?; mediaId? }`, `BotDeps { token; store; messenger; baseUrl; now; startRun; transcribe; download; botInfo? }`, `createBot(d): Bot`, `langFromCode(code?)`. Photo/voice handlers are added in Task 14 via `registerMediaHandlers(bot, d)` (export the hook here).

- [ ] **Step 1: Write `src/bot/copy.ts`**

```ts
// src/bot/copy.ts
import type { Lang } from "../domain/types";

export function langFromCode(code?: string): Lang {
  return (code ?? "").toLowerCase().startsWith("bg") ? "bg" : "en";
}

const BG = {
  noAccess: "Този бот управлява сайта на конкретно заведение. Изпратете /start <код> с кода, който получихте от нас.",
  badCode: "Кодът е невалиден, изтекъл или вече използван. Поискайте нов от нас.",
  welcome: (name: string, adminUrl: string, publicUrl: string) =>
    `Свързахте се като собственик на ${name}.\n\nКак работи:\n1. Пишете или пращате гласово: „Капучиното става 3,20“, „Баницата свърши“, „Затворени сме на 24 декември“.\n2. Получавате преглед и го потвърждавате с ✅.\n3. Сайтът се обновява веднага; /undo връща последната промяна.\n\nСайт: ${publicUrl}\nТабло (пазете линка, той е вашият ключ): ${adminUrl}`,
  welcomeStaff: (name: string, publicUrl: string) =>
    `Свързахте се като персонал на ${name}. Можете да отбелязвате изчерпани продукти и да добавяте днешните предложения.\n\nСайт: ${publicUrl}`,
  welcomeBack: (name: string, adminUrl: string) => `Вече сте свързани с ${name}. Табло: ${adminUrl}`,
  help: "Пишете какво искате да промените, на български или английски. Примери:\n• „Капучиното става 3,20“\n• „Баницата свърши“\n• „Добави шопска салата 7,50“\n• „Затворени сме на 24 и 25 декември“\n• снимка на дъската с предложенията\n• снимка с текст „това е новата корица“\n\nКоманди: /menu линкове към сайта, /lang bg|en език, /undo връща последната промяна.",
  langSet: "Езикът е български.",
  langUsage: "Използвайте /lang bg или /lang en.",
  menu: (publicUrl: string, adminUrl: string | null) => `Сайтът: ${publicUrl}\nМеню: ${publicUrl}/menu${adminUrl ? `\nQR код и табло: ${adminUrl}` : ""}`,
  changePrompt: "Напишете какво да променя в предложението.",
  notYours: "Това предложение не е от този чат.",
  applied: "✅ Приложено",
  scheduled: (when: string) => `⏰ Насрочено за ${when}`,
  cancelled: "❌ Отказано",
  status: {
    proposed: "Чака решение.",
    scheduled: "Насрочено.",
    applied: "Вече е приложено.",
    rejected: "Отхвърлено.",
    expired: "Изтекло: не беше потвърдено в рамките на 2 часа.",
    cancelled: "Отказано.",
    reverted: "Отменено с по-късна промяна.",
  },
  voiceUnavailable: "Гласовите съобщения не са включени на този сървър. Моля, напишете го.",
  voiceFailed: "Не успях да разпозная записа. Опитайте отново или го напишете.",
  heard: (text: string) => `🎤 Чух: „${text}“`,
  photoFailed: "Не успях да изтегля снимката. Опитайте отново.",
  photoTooBig: "Снимката е над 5 MB. Изпратете я като снимка, не като файл, или по-малка.",
  error: "Възникна грешка. Опитайте отново.",
};

const EN: typeof BG = {
  noAccess: "This bot manages one venue's website. Send /start <code> with the code you received from us.",
  badCode: "That code is invalid, expired or already used. Ask us for a new one.",
  welcome: (name, adminUrl, publicUrl) =>
    `You are linked as the owner of ${name}.\n\nHow it works:\n1. Type or send a voice note: “Cappuccino is 3.20 now”, “Banitsa is sold out”, “We're closed on 24 December”.\n2. You get a preview and confirm it with ✅.\n3. The site updates right away; /undo reverts the last change.\n\nSite: ${publicUrl}\nDashboard (keep this link, it is your key): ${adminUrl}`,
  welcomeStaff: (name, publicUrl) => `You are linked as staff of ${name}. You can mark items sold out and add today's specials.\n\nSite: ${publicUrl}`,
  welcomeBack: (name, adminUrl) => `You are already linked to ${name}. Dashboard: ${adminUrl}`,
  help: "Tell me what to change, in English or Bulgarian. Examples:\n• “Cappuccino is 3.20 now”\n• “Banitsa is sold out”\n• “Add shopska salad 7.50”\n• “We're closed on 24 and 25 December”\n• a photo of the specials board\n• a photo captioned “this is the new cover”\n\nCommands: /menu site links, /lang bg|en language, /undo reverts the last change.",
  langSet: "Language set to English.",
  langUsage: "Use /lang bg or /lang en.",
  menu: (publicUrl, adminUrl) => `Site: ${publicUrl}\nMenu: ${publicUrl}/menu${adminUrl ? `\nQR code and dashboard: ${adminUrl}` : ""}`,
  changePrompt: "Tell me what to change in the proposal.",
  notYours: "That proposal is not from this chat.",
  applied: "✅ Applied",
  scheduled: (when) => `⏰ Scheduled for ${when}`,
  cancelled: "❌ Cancelled",
  status: {
    proposed: "Waiting for a decision.",
    scheduled: "Scheduled.",
    applied: "Already applied.",
    rejected: "Rejected.",
    expired: "Expired: not confirmed within 2 hours.",
    cancelled: "Cancelled.",
    reverted: "Reverted by a later change.",
  },
  voiceUnavailable: "Voice notes are not enabled on this server. Please type it.",
  voiceFailed: "I couldn't transcribe that. Try again or type it.",
  heard: (text) => `🎤 Heard: “${text}”`,
  photoFailed: "I couldn't download the photo. Please try again.",
  photoTooBig: "The photo is over 5 MB. Send it as a photo, not a file, or a smaller one.",
  error: "Something went wrong. Please try again.",
};

export function copy(lang: Lang) {
  return lang === "bg" ? BG : EN;
}
```

- [ ] **Step 2: Write the Telegram test helpers**

```ts
// test/tg.ts
import type { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

export const BOT_INFO: UserFromGetMe = { id: 1, is_bot: true, first_name: "Site", username: "site_manager_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };

let n = 1;
const from = (chatId: number, lang: string) => ({ id: chatId, is_bot: false, first_name: "T", language_code: lang });
const chat = (chatId: number) => ({ id: chatId, type: "private" as const, first_name: "T" });

export function textUpdate(chatId: number, text: string, lang = "bg"): Update {
  const cmd = text.startsWith("/") ? [{ type: "bot_command" as const, offset: 0, length: text.split(" ")[0].length }] : undefined;
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), text, entities: cmd } } as Update;
}
export function callbackUpdate(chatId: number, data: string, messageId: number, lang = "bg"): Update {
  return { update_id: n++, callback_query: { id: `cq${n}`, from: from(chatId, lang), chat_instance: "ci", data, message: { message_id: messageId, date: 0, chat: chat(chatId), text: "preview" } } } as Update;
}
export function photoUpdate(chatId: number, caption?: string, lang = "bg"): Update {
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), caption, photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 90 }, { file_id: "big", file_unique_id: "b", width: 1280, height: 960 }] } } as Update;
}
export function voiceUpdate(chatId: number, lang = "bg"): Update {
  return { update_id: n++, message: { message_id: n++, date: 0, chat: chat(chatId), from: from(chatId, lang), voice: { file_id: "v1", file_unique_id: "v", duration: 3, mime_type: "audio/ogg" } } } as Update;
}

/** Intercepts every Bot API call; returns canned results and records the calls. */
export function captureApi(bot: Bot) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  let msgId = 500;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result: unknown =
      method === "sendMessage" ? { message_id: msgId++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "private" }, text: (payload as { text: string }).text }
      : method === "getFile" ? { file_id: (payload as { file_id: string }).file_id, file_unique_id: "u", file_path: `files/${(payload as { file_id: string }).file_id}.bin` }
      : true;
    return { ok: true, result } as never;
  });
  return { calls, texts: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.payload.text as string) };
}
```

- [ ] **Step 3: Write the failing approvals tests**

```ts
// test/approvals.test.ts
import { describe, expect, it } from "vitest";
import { loadMemory } from "@/src/agent/memory";
import { handleDecision, parseCallback } from "@/src/bot/approvals";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function proposal(applyAt: string | null = null) {
  const demo = await makeDemo();
  const site = await demo.store.getSite(demo.venue.id);
  const cs = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "• Cappuccino: €2.90 → €3.20", source: "text", status: "proposed", apply_at: applyAt, tg_message_id: 42, changes: planChanges(site, [{ op: "set_price", item_id: demo.items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
  const messenger = new FakeMessenger();
  return { ...demo, cs, messenger, d: { store: demo.store, messenger, now: () => T0 } };
}

describe("parseCallback", () => {
  it("parses cs:<decision>:<id> and rejects the rest", () => {
    expect(parseCallback("cs:apply:abc")).toEqual({ decision: "apply", setId: "abc" });
    expect(parseCallback("cs:nope:abc")).toBeNull();
    expect(parseCallback("hello")).toBeNull();
  });
});

describe("handleDecision", () => {
  it("applies and edits the message in the member's language", async () => {
    const { d, cs, store, venue, items } = await proposal();
    const r = await handleDecision(d, 1001, "apply", cs.id);
    expect(r).toEqual({ edit: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено", toast: "✅ Приложено" });
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    const again = await handleDecision(d, 1001, "apply", cs.id);
    expect(again).toEqual({ edit: "• Капучино: 2,90 € → 3,20 €\n\nВече е приложено.", toast: "Вече е приложено." });
  });
  it("schedules instead of applying when apply_at is in the future", async () => {
    const { d, cs, store } = await proposal("2026-12-20T06:00:00.000Z");
    const r = await handleDecision(d, 1001, "apply", cs.id);
    expect(r.edit).toBe("• Капучино: 2,90 € → 3,20 €\n\n⏰ Насрочено за 20.12.2026, 08:00");
    expect(await store.getChangeSet(cs.id)).toMatchObject({ status: "scheduled", decided_at: T0.toISOString() });
  });
  it("cancels", async () => {
    const { d, cs, store } = await proposal();
    expect(await handleDecision(d, 1001, "cancel", cs.id)).toEqual({ edit: "• Капучино: 2,90 € → 3,20 €\n\n❌ Отказано", toast: "❌ Отказано" });
    expect((await store.getChangeSet(cs.id)).status).toBe("cancelled");
  });
  it("marks the next message as a correction on change", async () => {
    const { d, cs, store, venue } = await proposal();
    expect(await handleDecision(d, 1001, "change", cs.id)).toEqual({ reply: "Напишете какво да променя в предложението.", toast: "✏️" });
    expect((await loadMemory(store, venue.id, 1001, T0)).correctionFor).toBe(cs.id);
    expect((await store.getChangeSet(cs.id)).status).toBe("proposed");
  });
  it("ignores other chats and unknown ids", async () => {
    const { d, cs } = await proposal();
    expect(await handleDecision(d, 1002, "apply", cs.id)).toEqual({ toast: "That proposal is not from this chat." });
    expect(await handleDecision(d, 1001, "apply", "missing")).toEqual({ toast: "Това предложение не е от този чат." });
  });
});
```

- [ ] **Step 4: Implement `src/bot/approvals.ts`**

```ts
// src/bot/approvals.ts
import { setCorrection } from "../agent/memory";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";
import { copy } from "./copy";
import type { Messenger } from "./messenger";

export type Decision = "apply" | "change" | "cancel";

export function parseCallback(data: string): { decision: Decision; setId: string } | null {
  const m = /^cs:(apply|change|cancel):([A-Za-z0-9-]+)$/.exec(data);
  return m ? { decision: m[1] as Decision, setId: m[2] } : null;
}

export interface DecisionDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
}
export interface DecisionResult {
  /** New text for the proposal message (buttons removed). */
  edit?: string;
  /** A fresh message to send. */
  reply?: string;
  /** Short callback-query answer. */
  toast?: string;
}

/** Answer the callback first (the caller does), then run this, then edit the message with `edit`. */
export async function handleDecision(d: DecisionDeps, chatId: number, decision: Decision, setId: string): Promise<DecisionResult> {
  const member = await d.store.findMember(chatId);
  const lang: Lang = member?.lang ?? "bg";
  const c = copy(lang);
  let cs;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { toast: c.notYours };
  }
  if (cs.chat_id !== chatId || !member || member.venue_id !== cs.venue_id) return { toast: c.notYours };
  const preview = lang === "bg" ? cs.preview_bg : cs.preview_en;
  const venue = await d.store.getVenue(cs.venue_id);
  const now = d.now();

  if (cs.status !== "proposed") return { edit: `${preview}\n\n${c.status[cs.status]}`, toast: c.status[cs.status] };

  if (decision === "change") {
    await setCorrection(d.store, cs.venue_id, chatId, cs.id, now);
    return { reply: c.changePrompt, toast: "✏️" };
  }
  if (decision === "cancel") {
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: now.toISOString() });
    return { edit: `${preview}\n\n${c.cancelled}`, toast: c.cancelled };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: now.toISOString() });
    const line = c.scheduled(formatDateTime(cs.apply_at, lang, venue.tz));
    return { edit: `${preview}\n\n${line}`, toast: line };
  }
  const result = await d.store.applyChangeSet(cs.id, now.toISOString());
  if (result === "skipped") {
    const fresh = await d.store.getChangeSet(cs.id);
    return { edit: `${preview}\n\n${c.status[fresh.status]}`, toast: c.status[fresh.status] };
  }
  return { edit: `${preview}\n\n${c.applied}`, toast: c.applied };
}
```

- [ ] **Step 5: Run** `npx vitest run test/approvals.test.ts` → PASS.

- [ ] **Step 6: Write the failing bot tests**

```ts
// test/bot.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type BotDeps, type RunRequest } from "@/src/bot/bot";
import { planChanges } from "@/src/domain/changes";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, callbackUpdate, captureApi, textUpdate } from "./tg";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup() {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const messenger = new FakeMessenger();
  const deps: BotDeps = {
    token: "t", store: demo.store, messenger, baseUrl: "https://site.example", now: () => T0,
    startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([1]), contentType: "image/jpeg" }), botInfo: BOT_INFO,
  };
  const bot = createBot(deps);
  const api = captureApi(bot);
  return { ...demo, runs, bot, api, deps };
}

describe("bot", () => {
  it("rejects unknown chats in their language and links them with a valid code", async () => {
    const { bot, api, store, venue } = await setup();
    await bot.handleUpdate(textUpdate(2000, "/start", "en"));
    expect(api.texts()[0]).toMatch(/^This bot manages one venue/);
    await bot.handleUpdate(textUpdate(2000, "/start WRONGCOD", "en"));
    expect(api.texts()[1]).toMatch(/invalid, expired/);
    const code = await store.createInvite(venue.id, "owner", "2026-10-10T00:00:00.000Z");
    await bot.handleUpdate(textUpdate(2000, `/start ${code}`, "bg"));
    const token = await store.getAdminToken(venue.id);
    expect(api.texts()[2]).toContain(`Табло (пазете линка, той е вашият ключ): https://site.example/admin/agala?key=${token}`);
    expect(api.texts()[2]).toContain("Сайт: https://site.example/agala");
    expect(await store.findMember(2000)).toMatchObject({ role: "owner", lang: "bg" });
    await bot.handleUpdate(textUpdate(2000, "hello"));
    expect(api.texts()).toHaveLength(3);
  });
  it("handles /lang, /help, /menu and /undo", async () => {
    const { bot, api, runs, store } = await setup();
    await bot.handleUpdate(textUpdate(1001, "/lang en"));
    expect(api.texts().at(-1)).toBe("Language set to English.");
    expect((await store.findMember(1001))?.lang).toBe("en");
    await bot.handleUpdate(textUpdate(1001, "/lang"));
    expect(api.texts().at(-1)).toBe("Use /lang bg or /lang en.");
    await bot.handleUpdate(textUpdate(1001, "/help"));
    expect(api.texts().at(-1)).toMatch(/^Tell me what to change/);
    await bot.handleUpdate(textUpdate(1001, "/menu"));
    expect(api.texts().at(-1)).toMatch(/^Site: https:\/\/site.example\/agala\nMenu: https:\/\/site.example\/agala\/menu\nQR code and dashboard: https:\/\/site.example\/admin\/agala\?key=/);
    await bot.handleUpdate(textUpdate(1001, "/undo"));
    expect(runs.at(-1)).toMatchObject({ chatId: 1001, text: "Undo the last change.", source: "text" });
  });
  it("starts a run for a member's text and shows typing", async () => {
    const { bot, api, runs, venue } = await setup();
    await bot.handleUpdate(textUpdate(1001, "Капучиното става 3,20"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ venueId: venue.id, chatId: 1001, text: "Капучиното става 3,20", source: "text" });
    expect(runs[0].member.role).toBe("owner");
    expect(api.calls.some((c) => c.method === "sendChatAction")).toBe(true);
    expect(api.texts()).toEqual([]);
  });
  it("answers the callback first, then applies and edits the message", async () => {
    const { bot, api, store, venue, items } = await setup();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "• Капучино: 2,90 € → 3,20 €", preview_en: "p", source: "text", status: "proposed", tg_message_id: 42, changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }) });
    await bot.handleUpdate(callbackUpdate(1001, `cs:apply:${cs.id}`, 42));
    const methods = api.calls.map((c) => c.method);
    expect(methods.indexOf("answerCallbackQuery")).toBeLessThan(methods.indexOf("editMessageText"));
    const edit = api.calls.find((c) => c.method === "editMessageText")!.payload;
    expect(edit).toMatchObject({ chat_id: 1001, message_id: 42, text: "• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено" });
    expect((await store.getChangeSet(cs.id)).status).toBe("applied");
    await bot.handleUpdate(callbackUpdate(1001, `cs:apply:${cs.id}`, 42));
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits).toHaveLength(2);
    expect(edits[1].payload.text).toBe("• Капучино: 2,90 € → 3,20 €\n\nВече е приложено.");
  });
  it("sends the change prompt on ✏️", async () => {
    const { bot, api, store, venue } = await setup();
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", tg_message_id: 43, changes: [] });
    await bot.handleUpdate(callbackUpdate(1001, `cs:change:${cs.id}`, 43));
    expect(api.texts().at(-1)).toBe("Напишете какво да променя в предложението.");
    expect(api.calls.some((c) => c.method === "editMessageText")).toBe(false);
  });
});
```

- [ ] **Step 7: Implement `src/bot/bot.ts`**

```ts
// src/bot/bot.ts
import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { ImageInput } from "../agent/run";
import type { Lang, Member } from "../domain/types";
import type { Store } from "../store/types";
import { handleDecision, parseCallback } from "./approvals";
import { copy, langFromCode } from "./copy";
import type { Messenger } from "./messenger";

export interface RunRequest {
  venueId: string;
  chatId: number;
  member: Member;
  text: string;
  source: "text" | "voice" | "photo";
  image?: ImageInput;
  mediaId?: string;
}

export interface BotDeps {
  token: string;
  store: Store;
  messenger: Messenger;
  baseUrl: string;
  now: () => Date;
  /** Schedules the agent turn (after() on Vercel, a floating promise in dev-bot). Must not throw. */
  startRun: (r: RunRequest) => void;
  /** null when STT is not configured. */
  transcribe: ((bytes: Uint8Array, lang: Lang) => Promise<string>) | null;
  /** Downloads a Telegram file by file_path; the URL (with the bot token) stays inside. */
  download: (filePath: string) => Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Tests pass this to skip getMe. */
  botInfo?: UserFromGetMe;
}

const INVITE_TTL_MS = 7 * 24 * 3_600_000;
export { INVITE_TTL_MS };

export function adminUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/admin/${slug}?key=${token}`;
}
export function publicUrl(baseUrl: string, slug: string): string {
  return `${baseUrl}/${slug}`;
}

/** Resolves the member for a chat, or replies with the no-access hint and returns null. */
export async function requireMember(d: BotDeps, ctx: Context): Promise<Member | null> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return null;
  const member = await d.store.findMember(chatId);
  if (member) return member;
  await ctx.reply(copy(langFromCode(ctx.from?.language_code)).noAccess);
  return null;
}

export function createBot(d: BotDeps): Bot {
  const bot = new Bot(d.token, d.botInfo ? { botInfo: d.botInfo } : undefined);

  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    const uiLang = langFromCode(ctx.from?.language_code);
    const existing = await d.store.findMember(chatId);
    if (existing) {
      const venue = await d.store.getVenue(existing.venue_id);
      const c = copy(existing.lang);
      if (existing.role === "owner") await ctx.reply(c.welcomeBack(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id))));
      else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
      return;
    }
    const code = (ctx.match ?? "").trim().toUpperCase();
    if (!code) {
      await ctx.reply(copy(uiLang).noAccess);
      return;
    }
    const member = await d.store.redeemInvite(code, chatId, uiLang, d.now().toISOString());
    if (!member) {
      await ctx.reply(copy(uiLang).badCode);
      return;
    }
    const venue = await d.store.getVenue(member.venue_id);
    const c = copy(member.lang);
    if (member.role === "owner") await ctx.reply(c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug)));
    else await ctx.reply(c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
  });

  bot.command("lang", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg !== "bg" && arg !== "en") {
      await ctx.reply(copy(member.lang).langUsage);
      return;
    }
    await d.store.setMemberLang(member.venue_id, member.tg_chat_id, arg);
    await ctx.reply(copy(arg).langSet);
  });

  bot.command("help", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (member) await ctx.reply(copy(member.lang).help);
  });

  bot.command("menu", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const venue = await d.store.getVenue(member.venue_id);
    const admin = member.role === "owner" ? adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)) : null;
    await ctx.reply(copy(member.lang).menu(publicUrl(d.baseUrl, venue.slug), admin));
  });

  bot.command("undo", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member, text: "Undo the last change.", source: "text" });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  });

  bot.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return; // unknown command
    const member = await requireMember(d, ctx);
    if (!member) return;
    // Start first: a failed acknowledgement must not lose the message.
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member, text: ctx.message.text, source: "text" });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  });

  bot.on("callback_query:data", async (ctx) => {
    const parsed = parseCallback(ctx.callbackQuery.data);
    const chatId = ctx.chat?.id;
    if (!parsed || chatId === undefined) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return;
    }
    // Answer first so the client stops spinning, then do the work, then edit the message.
    await ctx.answerCallbackQuery().catch(() => undefined);
    const r = await handleDecision({ store: d.store, messenger: d.messenger, now: d.now }, chatId, parsed.decision, parsed.setId);
    const messageId = ctx.callbackQuery.message?.message_id;
    if (r.edit && messageId !== undefined) await d.messenger.edit(chatId, messageId, r.edit);
    if (r.reply) await ctx.reply(r.reply);
  });

  registerMediaHandlers(bot, d);

  bot.catch(async (err) => {
    console.error("bot error:", err.error instanceof Error ? err.error.message : err.error);
    const lang = langFromCode(err.ctx.from?.language_code);
    await err.ctx.reply(copy(lang).error).catch(() => undefined);
  });
  return bot;
}

/** Photo, image-document and voice handlers (Task 14 fills this in). */
export function registerMediaHandlers(_bot: Bot, _d: BotDeps): void {}
```

- [ ] **Step 8: Run** `npx vitest run test/bot.test.ts` → PASS. If grammY's `handleUpdate` complains about `botInfo`, pass it exactly as `BOT_INFO`.

- [ ] **Step 9: Commit**

```bash
git add src/bot/copy.ts src/bot/approvals.ts src/bot/bot.ts test/tg.ts test/approvals.test.ts test/bot.test.ts
git commit -m "Bot: /start with invites, /lang /help /menu /undo, text turns, approval buttons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Photos and voice notes

**Files:**
- Create: `src/bot/media.ts`, `src/bot/voice.ts`
- Modify: `src/bot/bot.ts` (`registerMediaHandlers` body, move it to `src/bot/media.ts` and import it)
- Test: `test/media.test.ts`, `test/voice.test.ts`, `test/bot-media.test.ts`

**Interfaces:**
- Produces: `downloadTelegramFile(token, filePath, fetchFn?)`, `MAX_IMAGE_BYTES`, `imageMediaType(contentType, filePath)`, `registerMediaHandlers(bot, d)`; `makeTranscriber({ apiKey, baseUrl, model }, clientFactory?)`, `Transcriber`.

- [ ] **Step 1: Write the failing media tests**

```ts
// test/media.test.ts
import { describe, expect, it } from "vitest";
import { downloadTelegramFile, imageMediaType, MAX_IMAGE_BYTES } from "@/src/bot/media";

describe("downloadTelegramFile", () => {
  it("fetches the file URL built from the token and never puts the URL in an error", async () => {
    const urls: string[] = [];
    const ok = (async (url: string) => {
      urls.push(url);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    const r = await downloadTelegramFile("SECRET", "photos/a.jpg", ok);
    expect(urls).toEqual(["https://api.telegram.org/file/botSECRET/photos/a.jpg"]);
    expect(r).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
    const bad = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(downloadTelegramFile("SECRET", "photos/a.jpg", bad)).rejects.toThrow(/^download failed \(HTTP 404\)$/);
  });
  it("rejects files over the limit", async () => {
    const big = (async () => new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { status: 200, headers: { "content-type": "image/jpeg" } })) as unknown as typeof fetch;
    await expect(downloadTelegramFile("S", "x", big)).rejects.toThrow(/too large/);
  });
});

describe("imageMediaType", () => {
  it("prefers the header, falls back to the extension, defaults to jpeg", () => {
    expect(imageMediaType("image/png", "x.bin")).toBe("image/png");
    expect(imageMediaType("application/octet-stream", "photos/x.webp")).toBe("image/webp");
    expect(imageMediaType("application/octet-stream", "photos/x")).toBe("image/jpeg");
    expect(imageMediaType("application/pdf", "doc.pdf")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `src/bot/media.ts`** (download + handlers)

```ts
// src/bot/media.ts
import type { Bot } from "grammy";
import type { ImageInput } from "../agent/run";
import type { BotDeps } from "./bot";
import { requireMember } from "./bot";
import { copy } from "./copy";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The URL carries the bot token: it is built here, used once, and never logged or put in an error. */
export async function downloadTelegramFile(token: string, filePath: string, fetchFn: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetchFn(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${buf.byteLength} bytes)`);
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

const IMAGE_TYPES: ImageInput["media_type"][] = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function imageMediaType(contentType: string, filePath: string): ImageInput["media_type"] | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if ((IMAGE_TYPES as string[]).includes(ct)) return ct as ImageInput["media_type"];
  if (ct.startsWith("image/")) return "image/jpeg";
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg" || ext === undefined || !filePath.includes(".")) return "image/jpeg";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function registerMediaHandlers(bot: Bot, d: BotDeps): void {
  const handleImage = async (ctx: Parameters<Parameters<Bot["on"]>[1]>[0], fileId: string, caption: string | undefined) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const c = copy(member.lang);
    let media_type: ImageInput["media_type"] | null;
    let bytes: Uint8Array;
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      bytes = dl.bytes;
      media_type = imageMediaType(dl.contentType, file.file_path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[bot] image download failed: ${msg}`);
      await ctx.reply(/too large/.test(msg) ? c.photoTooBig : c.photoFailed);
      return;
    }
    if (!media_type) {
      await ctx.reply(c.photoFailed);
      return;
    }
    const media = await d.store.saveMedia(member.venue_id, bytes, media_type);
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member, text: caption ?? "", source: "photo", image: { data: toBase64(bytes), media_type }, mediaId: media.id });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  };

  bot.on("message:photo", (ctx) => handleImage(ctx, ctx.message.photo.at(-1)!.file_id, ctx.message.caption));
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return;
    await handleImage(ctx, doc.file_id, ctx.message.caption);
  });

  const handleVoice = async (ctx: Parameters<Parameters<Bot["on"]>[1]>[0], fileId: string) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const c = copy(member.lang);
    if (!d.transcribe) {
      await ctx.reply(c.voiceUnavailable);
      return;
    }
    let text: string;
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      text = (await d.transcribe(dl.bytes, member.lang)).trim();
    } catch (e) {
      console.error(`[bot] voice failed: ${e instanceof Error ? e.message : String(e)}`);
      await ctx.reply(c.voiceFailed);
      return;
    }
    if (!text) {
      await ctx.reply(c.voiceFailed);
      return;
    }
    d.startRun({ venueId: member.venue_id, chatId: member.tg_chat_id, member, text, source: "voice" });
    await ctx.reply(c.heard(text)).catch(() => undefined);
  };
  bot.on("message:voice", (ctx) => handleVoice(ctx, ctx.message.voice.file_id));
  bot.on("message:audio", (ctx) => handleVoice(ctx, ctx.message.audio.file_id));
}
```

Then in `src/bot/bot.ts`: delete the stub `registerMediaHandlers`, add `import { registerMediaHandlers } from "./media";` (circular import between `bot.ts` and `media.ts` is fine because both only use each other's exports at call time; if TypeScript or the bundler complains, move `requireMember` into a new `src/bot/members.ts` imported by both).

- [ ] **Step 3: Write the failing voice test and implement `src/bot/voice.ts`**

```ts
// test/voice.test.ts
import { describe, expect, it } from "vitest";
import { makeTranscriber } from "@/src/bot/voice";

describe("makeTranscriber", () => {
  it("sends the bytes as an ogg file with the model and language, trims the result", async () => {
    const seen: Record<string, unknown>[] = [];
    const factory = (cfg: { apiKey: string; baseURL: string }) => {
      expect(cfg).toEqual({ apiKey: "k", baseURL: "https://api.groq.com/openai/v1" });
      return { audio: { transcriptions: { create: async (p: Record<string, unknown>) => { seen.push(p); return { text: "  Капучиното става три и двайсет " }; } } } };
    };
    const t = makeTranscriber({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1", model: "whisper-large-v3" }, factory as never);
    expect(await t(new Uint8Array([1, 2]), "bg")).toBe("Капучиното става три и двайсет");
    expect(seen[0]).toMatchObject({ model: "whisper-large-v3", language: "bg" });
    expect((seen[0].file as File).name).toBe("voice.ogg");
  });
});
```

```ts
// src/bot/voice.ts
import OpenAI, { toFile } from "openai";
import type { Lang } from "../domain/types";

export type Transcriber = (bytes: Uint8Array, lang: Lang) => Promise<string>;

interface SttClient {
  audio: { transcriptions: { create(p: { file: File; model: string; language: string }): Promise<{ text: string }> } };
}

const defaultFactory = (cfg: { apiKey: string; baseURL: string }): SttClient => new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL }) as unknown as SttClient;

/** Any OpenAI-compatible transcription endpoint (Groq by default). */
export function makeTranscriber(cfg: { apiKey: string; baseUrl: string; model: string }, factory: (c: { apiKey: string; baseURL: string }) => SttClient = defaultFactory): Transcriber {
  const client = factory({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
  return async (bytes, lang) => {
    const file = await toFile(bytes, "voice.ogg", { type: "audio/ogg" });
    const r = await client.audio.transcriptions.create({ file, model: cfg.model, language: lang });
    return (r.text ?? "").trim();
  };
}
```

- [ ] **Step 4: Write the failing bot media tests**

```ts
// test/bot-media.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type BotDeps, type RunRequest } from "@/src/bot/bot";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, captureApi, photoUpdate, voiceUpdate } from "./tg";

const T0 = new Date("2026-10-09T09:00:00.000Z");

async function setup(over: Partial<BotDeps> = {}) {
  const demo = await makeDemo();
  const runs: RunRequest[] = [];
  const deps: BotDeps = {
    token: "t", store: demo.store, messenger: new FakeMessenger(), baseUrl: "https://site.example", now: () => T0,
    startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array([9, 9]), contentType: "image/jpeg" }), botInfo: BOT_INFO, ...over,
  };
  const bot = createBot(deps);
  return { ...demo, runs, bot, api: captureApi(bot) };
}

describe("photos", () => {
  it("downloads the largest size, stores it and starts a photo run with the media id", async () => {
    const { bot, api, runs, store, venue } = await setup();
    await bot.handleUpdate(photoUpdate(1001, "това е новата корица"));
    expect(api.calls.find((c) => c.method === "getFile")?.payload).toEqual({ file_id: "big" });
    expect(runs[0]).toMatchObject({ source: "photo", text: "това е новата корица", image: { media_type: "image/jpeg", data: Buffer.from([9, 9]).toString("base64") } });
    const media = (await store.getSite(venue.id)).media;
    expect(media).toHaveLength(1);
    expect(runs[0].mediaId).toBe(media[0].id);
  });
  it("tells the owner when the download fails, without the URL", async () => {
    const { bot, api, runs } = await setup({ download: async () => { throw new Error("download failed (HTTP 500)"); } });
    await bot.handleUpdate(photoUpdate(1001));
    expect(runs).toHaveLength(0);
    expect(api.texts()[0]).toBe("Не успях да изтегля снимката. Опитайте отново.");
  });
});

describe("voice", () => {
  it("says voice is unavailable without a transcriber", async () => {
    const { bot, api } = await setup();
    await bot.handleUpdate(voiceUpdate(1001));
    expect(api.texts()[0]).toBe("Гласовите съобщения не са включени на този сървър. Моля, напишете го.");
  });
  it("echoes what it heard and starts a voice run", async () => {
    const { bot, api, runs } = await setup({ transcribe: async (_b, lang) => `heard in ${lang}` });
    await bot.handleUpdate(voiceUpdate(1001));
    expect(runs[0]).toMatchObject({ source: "voice", text: "heard in bg" });
    expect(api.texts()[0]).toBe("🎤 Чух: „heard in bg“");
  });
});
```

- [ ] **Step 5: Run** `npx vitest run test/media.test.ts test/voice.test.ts test/bot-media.test.ts test/bot.test.ts` → PASS; `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/bot/media.ts src/bot/voice.ts src/bot/bot.ts test/media.test.ts test/voice.test.ts test/bot-media.test.ts
git commit -m "Bot: photos to storage with image blocks, voice notes through an OpenAI-compatible STT

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Server wiring: deps, memory-store mode, webhook and tick routes, dev bot, webhook script

**Files:**
- Create: `src/server/deps.ts`, `src/server/telegram.ts`, `src/server/tick.ts`, `app/api/telegram/route.ts`, `app/api/tick/route.ts`, `vercel.json`, `scripts/dev-bot.mts`, `scripts/set-webhook.mts`
- Modify: `package.json` (add `"dev:offline": "SITE_MANAGER_STORE=memory next dev"`), `next.config.ts` (images)
- Test: `test/server-telegram.test.ts`, `test/server-tick.test.ts`, `test/server-deps.test.ts`

**Interfaces:**
- Produces: `ServerDeps { config; store; messenger; bot; handleRun(r: RunRequest): Promise<void>; isMemory: boolean }`, `makeServerDeps(opts: { defer; env?; store?; transcribe?; client? })`, `getServerDeps(defer)` (process singleton; `SITE_MANAGER_STORE=memory` → `InMemoryStore` seeded with the demo venue, owner chat from `DEMO_OWNER_CHAT_ID` if set, admin link logged once); `handleTelegramRequest(req, deps)`, `handleTickRequest(req, deps, now?)`.

- [ ] **Step 1: Write the failing deps/telegram/tick tests**

```ts
// test/server-deps.test.ts
import { describe, expect, it } from "vitest";
import { makeServerDeps } from "@/src/server/deps";

describe("makeServerDeps (memory mode)", () => {
  it("seeds the demo venue and a demo owner, and never needs secrets", async () => {
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory", DEMO_OWNER_CHAT_ID: "777" }, log: (s) => logs.push(s) });
    expect(deps.isMemory).toBe(true);
    const venue = await deps.store.getVenueBySlug("agala");
    expect(venue?.name).toBe("Кафене „Ъгъла“");
    expect((await deps.store.getSite(venue!.id)).items.length).toBe(12);
    expect(await deps.store.findMember(777)).toMatchObject({ role: "owner" });
    expect(logs.join("\n")).toMatch(/admin link: http:\/\/localhost:3000\/admin\/agala\?key=/);
  });
});
```

```ts
// test/server-telegram.test.ts
import { describe, expect, it } from "vitest";
import { createBot, type RunRequest } from "@/src/bot/bot";
import { handleTelegramRequest } from "@/src/server/telegram";
import { FakeMessenger, makeDemo } from "./helpers";
import { BOT_INFO, captureApi, textUpdate } from "./tg";

describe("handleTelegramRequest", () => {
  it("rejects a missing or wrong secret and accepts a valid update", async () => {
    const demo = await makeDemo();
    const runs: RunRequest[] = [];
    const bot = createBot({ token: "t", store: demo.store, messenger: new FakeMessenger(), baseUrl: "http://x", now: () => new Date(), startRun: (r) => runs.push(r), transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }), botInfo: BOT_INFO });
    captureApi(bot);
    const deps = { config: { telegramWebhookSecret: "s3cret" }, bot };
    const body = JSON.stringify(textUpdate(1001, "здрасти"));
    const mk = (headers: Record<string, string>) => new Request("http://localhost/api/telegram", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
    expect((await handleTelegramRequest(mk({}), deps)).status).toBe(401);
    expect((await handleTelegramRequest(mk({ "x-telegram-bot-api-secret-token": "wrong" }), deps)).status).toBe(401);
    const ok = await handleTelegramRequest(mk({ "x-telegram-bot-api-secret-token": "s3cret" }), deps);
    expect(ok.status).toBe(200);
    expect(runs).toHaveLength(1);
  });
});
```

```ts
// test/server-tick.test.ts
import { describe, expect, it } from "vitest";
import { handleTickRequest } from "@/src/server/tick";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("handleTickRequest", () => {
  it("authorises by header, bearer token or admin key, and scopes by venue for a key", async () => {
    const demo = await makeDemo();
    const other = await demo.store.createVenue({ slug: "other", name: "Other" });
    const a = await demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
    const b = await demo.store.createChangeSet({ venue_id: other.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "scheduled", apply_at: "2026-10-09T08:00:00.000Z", changes: [] });
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
```

- [ ] **Step 2: Implement `src/server/deps.ts`**

```ts
// src/server/deps.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Bot } from "grammy";
import { runTurn } from "../agent/run";
import { createBot, type RunRequest } from "../bot/bot";
import { downloadTelegramFile } from "../bot/media";
import { TelegramMessenger, type Messenger } from "../bot/messenger";
import { makeTranscriber, type Transcriber } from "../bot/voice";
import { loadConfig, type Config } from "../config";
import { seedDemo } from "../seed/demo";
import { InMemoryStore } from "../store/memory";
import { SupabaseStore } from "../store/supabase";
import type { Store } from "../store/types";
import { runTick } from "../tick";

export interface ServerDeps {
  config: Config;
  store: Store;
  messenger: Messenger;
  bot: Bot;
  /** Per-venue tick, then the agent turn. Logs and swallows errors. */
  handleRun: (r: RunRequest) => Promise<void>;
  isMemory: boolean;
}

export interface DepsOptions {
  /** Runs a background job after the response (after() on Vercel; a floating promise elsewhere). */
  defer: (fn: () => Promise<void>) => void;
  env?: Record<string, string | undefined>;
  store?: Store;
  transcribe?: Transcriber | null;
  client?: Anthropic;
  log?: (line: string) => void;
}

export async function makeServerDeps(o: DepsOptions): Promise<ServerDeps> {
  const env = o.env ?? process.env;
  const isMemory = env.SITE_MANAGER_STORE === "memory";
  const config = loadConfig(env, { lenient: isMemory });
  const log = o.log ?? ((s: string) => console.log(s));

  let store = o.store;
  if (!store) {
    if (isMemory) {
      const mem = new InMemoryStore();
      const { venue } = await seedDemo(mem, config.demoVenueSlug);
      const chat = Number(env.DEMO_OWNER_CHAT_ID);
      if (Number.isInteger(chat) && chat > 0) await mem.upsertMember({ venue_id: venue.id, tg_chat_id: chat, role: "owner", lang: "bg" });
      log(`[memory store] demo venue "${venue.slug}" seeded; admin link: ${config.publicBaseUrl}/admin/${venue.slug}?key=${await mem.getAdminToken(venue.id)}`);
      store = mem;
    } else {
      store = new SupabaseStore(config.supabaseUrl, config.supabaseServiceKey);
    }
  }
  const s = store;
  const transcribe = o.transcribe !== undefined ? o.transcribe : config.sttApiKey ? makeTranscriber({ apiKey: config.sttApiKey, baseUrl: config.sttBaseUrl, model: config.sttModel }) : null;

  const handleRun = async (r: RunRequest) => {
    try {
      await runTick({ store: s, messenger, now: new Date(), venueId: r.venueId });
    } catch (e) {
      console.error("[tick] per-webhook tick failed:", e instanceof Error ? e.message : e);
    }
    try {
      await runTurn(
        { store: s, venueId: r.venueId, chatId: r.chatId, member: r.member, messenger, now: () => new Date(), baseUrl: config.publicBaseUrl },
        { text: r.text, source: r.source, image: r.image, mediaId: r.mediaId },
        { model: config.agentModel, effort: config.agentEffort, apiKey: config.anthropicApiKey || undefined },
        o.client,
      );
    } catch (e) {
      console.error("[agent] run failed:", e instanceof Error ? e.message : e);
    }
  };

  const bot = createBot({
    token: config.telegramToken || "memory-mode-no-token",
    store: s,
    messenger: null as unknown as Messenger, // replaced below (the messenger needs bot.api)
    baseUrl: config.publicBaseUrl,
    now: () => new Date(),
    startRun: (r) => o.defer(() => handleRun(r)),
    transcribe,
    download: (filePath) => downloadTelegramFile(config.telegramToken, filePath),
  });
  const messenger = new TelegramMessenger(bot.api);
  // createBot captured `d.messenger` by reference through `d`; set it now.
  (bot as unknown as { __deps?: { messenger: Messenger } }).__deps = { messenger };
  return { config, store: s, messenger, bot, handleRun, isMemory };
}
```

Important: `createBot` reads `d.messenger` lazily at callback time, so build the deps object once, pass it to `createBot`, then assign `deps.messenger = new TelegramMessenger(bot.api)` on that same object. Implement it that way (a mutable `botDeps` object) and drop the `__deps` trick above:

```ts
  const botDeps: BotDeps = { token: ..., store: s, messenger: undefined as unknown as Messenger, ... };
  const bot = createBot(botDeps);
  const messenger = new TelegramMessenger(bot.api);
  botDeps.messenger = messenger;
```

Add the singleton:

```ts
let cached: Promise<ServerDeps> | null = null;
/** One set of deps per server process (Vercel function instance or dev server). */
export function getServerDeps(defer: DepsOptions["defer"]): Promise<ServerDeps> {
  cached ??= makeServerDeps({ defer });
  return cached;
}
```

- [ ] **Step 3: Implement `src/server/telegram.ts` and `src/server/tick.ts`**

```ts
// src/server/telegram.ts
import { webhookCallback, type Bot } from "grammy";

const handlers = new WeakMap<Bot, (req: Request) => Promise<Response>>();

/** Verifies Telegram's secret header, then hands the update to grammY. The bot's handlers only schedule work, so this returns fast. */
export async function handleTelegramRequest(req: Request, deps: { config: { telegramWebhookSecret: string }; bot: Bot }): Promise<Response> {
  const secret = deps.config.telegramWebhookSecret;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("unauthorized", { status: 401 });
  let handler = handlers.get(deps.bot);
  if (!handler) {
    handler = webhookCallback(deps.bot, "std/http", { timeoutMilliseconds: 25_000, onTimeout: "return" }) as unknown as (req: Request) => Promise<Response>;
    handlers.set(deps.bot, handler);
  }
  try {
    return await handler(req);
  } catch (e) {
    console.error("[telegram] webhook failed:", e instanceof Error ? e.message : e);
    return new Response("ok", { status: 200 }); // never make Telegram retry
  }
}
```

```ts
// src/server/tick.ts
import type { Messenger } from "../bot/messenger";
import type { Store } from "../store/types";
import { runTick } from "../tick";

/** Auth: x-tick-secret header, Authorization: Bearer <TICK_SECRET> (Vercel Cron with CRON_SECRET), or ?key=<admin token> (one venue). */
export async function handleTickRequest(req: Request, deps: { config: { tickSecret: string }; store: Store; messenger: Messenger }, now = new Date()): Promise<Response> {
  const url = new URL(req.url);
  const secret = deps.config.tickSecret;
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const global = !!secret && (req.headers.get("x-tick-secret") === secret || bearer === secret);
  let venueId: string | undefined;
  if (!global) {
    const key = url.searchParams.get("key");
    const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
    if (!venue) return new Response("unauthorized", { status: 401 });
    venueId = venue.id;
  }
  const report = await runTick({ store: deps.store, messenger: deps.messenger, now, venueId });
  return Response.json({ ok: true, at: now.toISOString(), ...report });
}
```

- [ ] **Step 4: Write the routes, `vercel.json`, `next.config.ts`**

```ts
// app/api/telegram/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleTelegramRequest } from "@/src/server/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleTelegramRequest(req, deps);
}
```

```ts
// app/api/tick/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleTickRequest } from "@/src/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleTickRequest(req, deps);
}
export const GET = handle;
export const POST = handle;
```

```json
// vercel.json
{ "crons": [{ "path": "/api/tick", "schedule": "0 3 * * *" }] }
```

```ts
// next.config.ts
import type { NextConfig } from "next";

const supabaseHost = (() => {
  try {
    return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co" },
      ...(supabaseHost ? [{ protocol: "https" as const, hostname: supabaseHost }] : []),
    ],
  },
};
export default nextConfig;
```

- [ ] **Step 5: Write `scripts/dev-bot.mts` and `scripts/set-webhook.mts`**

```ts
// scripts/dev-bot.mts
// Long polling for local development. Never run while a webhook is set (Telegram allows one or the other):
//   npm run telegram:set-webhook -- --delete   then   npm run bot:dev
import { makeServerDeps } from "../src/server/deps";

const deps = await makeServerDeps({ defer: (fn) => void fn().catch((e) => console.error("[run]", e instanceof Error ? e.message : e)) });
if (!deps.config.telegramToken) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env.local (npm run env:set -- TELEGRAM_BOT_TOKEN)");
const info = await deps.bot.api.getWebhookInfo();
if (info.url) throw new Error(`A webhook is set (${info.url}). Run: npm run telegram:set-webhook -- --delete`);
console.log(`[bot:dev] polling as @${(await deps.bot.api.getMe()).username}; store=${deps.isMemory ? "memory" : "supabase"}; base=${deps.config.publicBaseUrl}`);
setInterval(() => void deps.handleRun, 0); // keep the event loop explicit
await deps.bot.start({ onStart: () => console.log("[bot:dev] started; Ctrl-C to stop") });
```

(Drop the `setInterval` line; `bot.start()` keeps the process alive on its own.)

```ts
// scripts/set-webhook.mts
// npm run telegram:set-webhook -- https://your-deployment.vercel.app   |   npm run telegram:set-webhook -- --delete
import { Api } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
if (!token || !secret) throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in .env.local");
const api = new Api(token);
const arg = process.argv[2]?.trim();
if (arg === "--delete") {
  await api.deleteWebhook({ drop_pending_updates: true });
  console.log("webhook deleted; bot:dev (long polling) can run now");
} else {
  const base = (arg || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("Give the https deployment URL: npm run telegram:set-webhook -- https://<deployment>");
  await api.setWebhook(`${base}/api/telegram`, { secret_token: secret, drop_pending_updates: true, allowed_updates: ["message", "callback_query"] });
  console.log(`webhook set to ${base}/api/telegram`);
}
const info = await api.getWebhookInfo();
console.log(`url=${info.url || "(none)"} pending=${info.pending_update_count}${info.last_error_message ? ` last_error=${info.last_error_message}` : ""}`);
```

Add to `package.json` scripts: `"dev:offline": "SITE_MANAGER_STORE=memory next dev"`.

- [ ] **Step 6: Run** `npx vitest run test/server-deps.test.ts test/server-telegram.test.ts test/server-tick.test.ts` → PASS; `npx tsc --noEmit` clean; `npx next build` → green (routes compile; no env needed because config loads lazily per request). Then, with `.env.local` filled: `npm run telegram:set-webhook -- --delete` is **not** run now (nothing is deployed); instead run `npm run bot:dev` for 20 s in the background, confirm it prints "polling as @…", stop it. Record the result in the commit body (or "skipped: no TELEGRAM_BOT_TOKEN").

- [ ] **Step 7: Commit**

```bash
git add src/server app/api vercel.json next.config.ts scripts/dev-bot.mts scripts/set-webhook.mts package.json test/server-*.test.ts
git commit -m "Server: deps with memory-store mode, Telegram webhook with after(), tick endpoint, cron, dev bot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: i18n layer, global styles, fonts, root layout, landing page

**Files:**
- Create: `src/i18n/dicts.ts`, `src/i18n/index.tsx`, `app/not-found.tsx`, `app/components/Landing.tsx`
- Modify: `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Test: `test/i18n.test.ts` (dictionary completeness)

**Interfaces:**
- Produces: `MessageKey`, `DICTS`, `LangProvider({ defaultLang, children })`, `useLang() → { lang, setLang, t, locale }`, `LangToggle`, `SITE_NAME = "Site Manager"`. CSS tokens: `--color-paper`, `--color-paper-deep`, `--color-card`, `--color-ink`, `--color-ink-soft`, `--color-accent` (defaults to leaf green; venue pages override `--accent`), `--color-amber`, `--color-clay`, animations `rise`, `flash`, `line-in`.

- [ ] **Step 1: Write the dictionary test**

```ts
// test/i18n.test.ts
import { describe, expect, it } from "vitest";
import { DICTS } from "@/src/i18n/dicts";

describe("dictionaries", () => {
  it("have the same keys in both languages and no empty strings", () => {
    const en = Object.keys(DICTS.en).sort();
    const bg = Object.keys(DICTS.bg).sort();
    expect(bg).toEqual(en);
    for (const k of en) {
      expect(DICTS.en[k as keyof typeof DICTS.en].length, `en ${k}`).toBeGreaterThan(0);
      expect(DICTS.bg[k as keyof typeof DICTS.bg].length, `bg ${k}`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Write `src/i18n/dicts.ts`** (landing, site chrome, admin; both languages must read naturally)

```ts
// src/i18n/dicts.ts
export const SITE_NAME = "Site Manager";

const en = {
  "lang.group": "Language",
  "nav.demo": "See the demo café",
  // Landing
  "landing.title": "Site Manager: your café's website, run from Telegram",
  "landing.eyebrow": "For cafés and small restaurants",
  "landing.h1": "Your café's website, managed by chat.",
  "landing.lead": "We build your site and give you a Telegram bot. Text it, send a voice note or a photo, in Bulgarian or English, and the site changes: prices, sold-out dishes, today's specials, hours, holidays, photos. Every change is previewed, approved with one tap, logged and undoable.",
  "landing.cta": "Open the demo café →",
  "landing.ctaNote": "A fictional café, Кафене „Ъгъла“, that we change live during the demo.",
  "landing.how": "How it works",
  "landing.step1.title": "You message the bot",
  "landing.step1.body": "“Капучиното става 3,20”, a voice note, or a photo of the specials board.",
  "landing.step2.title": "You see the change before it goes live",
  "landing.step2.body": "The bot shows exactly what will change, in your language. ✅ Apply, ✏️ Change, or ❌ Cancel.",
  "landing.step3.title": "The site updates in seconds",
  "landing.step3.body": "Sold-out dishes grey out and come back on their own. Specials expire at closing. Everything is in a log you can undo.",
  "landing.what": "What the bot can do",
  "landing.feat1": "Prices and texts, one dish or all of them at once, with rounding",
  "landing.feat2": "Sold out until tomorrow's opening, automatically back",
  "landing.feat3": "Today's specials from a photo of the board",
  "landing.feat4": "Opening hours, holidays and announcements, scheduled in advance",
  "landing.feat5": "Cover, logo, dish and gallery photos",
  "landing.feat6": "New dishes with bilingual descriptions and an allergen check",
  "landing.price": "25 € a month per venue",
  "landing.priceNote": "Website hosting and the agent, setup included.",
  "landing.evidence": "Before we had a product, four venues told us what they would pay a month: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 €.",
  "landing.built": "Built for the “AI That Does the Work” hackathon with Claude. The AI reads casual Bulgarian, voice and handwriting; we built the site, the content model, the approval step, the scheduler, the log and the multi-venue plumbing.",
  "landing.footer": "Site Manager · a website your café runs from Telegram",
  // Public site
  "site.menu": "Menu",
  "site.home": "Home",
  "site.openUntil": "Open until {time}",
  "site.opensAt": "Opens today at {time}",
  "site.closedToday": "Closed today",
  "site.closedUntil": "Closed · opens {when}",
  "site.specials": "Today's specials",
  "site.specialUntil": "until {time}",
  "site.highlights": "From the menu",
  "site.fullMenu": "See the full menu →",
  "site.about": "About us",
  "site.hours": "Opening hours",
  "site.closedDay": "closed",
  "site.holidays": "Upcoming closures",
  "site.findUs": "Find us",
  "site.map": "Open in Maps",
  "site.call": "Call",
  "site.gallery": "Gallery",
  "site.soldOut": "Sold out",
  "site.soldOutUntil": "Sold out until {when}",
  "site.allergens": "Allergens",
  "site.allergenLegend": "Allergen codes (EU 1169/2011)",
  "site.updated": "updated",
  "site.poweredBy": "Site by Site Manager",
  "site.noItems": "The menu is being prepared.",
  "site.draft": "Draft preview, not live",
  "site.draftApply": "Apply",
  "site.draftReject": "Reject",
  "site.draftBack": "Back to the dashboard",
  "site.draftApplied": "Applied. This page now shows the live site.",
  // Admin
  "admin.title": "Dashboard",
  "admin.invalid": "This link is not valid. Ask the bot for a new one with /menu.",
  "admin.qr": "QR code for the menu",
  "admin.qrNote": "Print it for the tables. It opens {url}.",
  "admin.pending": "Waiting for your decision",
  "admin.none": "Nothing here right now.",
  "admin.apply": "Apply",
  "admin.reject": "Reject",
  "admin.cancel": "Cancel",
  "admin.undo": "Undo",
  "admin.preview": "Preview on the site",
  "admin.scheduled": "Scheduled",
  "admin.scheduledFor": "applies on {when}",
  "admin.log": "Change log",
  "admin.soldOut": "Sold out right now",
  "admin.backAt": "back {when}",
  "admin.links": "Links",
  "admin.site": "Public site",
  "admin.menuLink": "Menu page",
  "admin.source.text": "text",
  "admin.source.voice": "voice",
  "admin.source.photo": "photo",
  "admin.source.dashboard": "dashboard",
  "admin.source.auto": "automatic",
  "admin.source.undo": "undo",
  "admin.status.proposed": "proposed",
  "admin.status.scheduled": "scheduled",
  "admin.status.applied": "applied",
  "admin.status.rejected": "rejected",
  "admin.status.expired": "expired",
  "admin.status.cancelled": "cancelled",
  "admin.status.reverted": "reverted",
  "admin.busy": "Working…",
  "admin.failed": "That did not work. Try again.",
};
export type MessageKey = keyof typeof en;

const bg: Record<MessageKey, string> = {
  "lang.group": "Език",
  "nav.demo": "Вижте демо кафенето",
  "landing.title": "Site Manager: сайтът на вашето кафене, управляван от Telegram",
  "landing.eyebrow": "За кафенета и малки ресторанти",
  "landing.h1": "Сайтът на вашето кафене, управляван с едно съобщение.",
  "landing.lead": "Правим ви сайт и ви даваме Telegram бот. Пишете му, пратете гласово или снимка, на български или английски, и сайтът се променя: цени, изчерпани ястия, днешни предложения, работно време, почивни дни, снимки. Всяка промяна се вижда предварително, потвърждава се с едно докосване, записва се и може да се върне.",
  "landing.cta": "Отворете демо кафенето →",
  "landing.ctaNote": "Измислено кафене, Кафене „Ъгъла“, което променяме на живо по време на демото.",
  "landing.how": "Как работи",
  "landing.step1.title": "Пишете на бота",
  "landing.step1.body": "„Капучиното става 3,20“, гласово съобщение или снимка на дъската с предложенията.",
  "landing.step2.title": "Виждате промяната, преди да е на сайта",
  "landing.step2.body": "Ботът показва точно какво ще се промени, на вашия език. ✅ Приложи, ✏️ Промени или ❌ Откажи.",
  "landing.step3.title": "Сайтът се обновява за секунди",
  "landing.step3.body": "Изчерпаните ястия посивяват и се връщат сами. Предложенията изтичат при затваряне. Всичко е в дневник, който може да се върне назад.",
  "landing.what": "Какво може ботът",
  "landing.feat1": "Цени и текстове, едно ястие или всички наведнъж, със закръгляне",
  "landing.feat2": "Изчерпано до утрешното отваряне, връща се автоматично",
  "landing.feat3": "Днешните предложения от снимка на дъската",
  "landing.feat4": "Работно време, почивни дни и съобщения, насрочени предварително",
  "landing.feat5": "Корица, лого, снимки на ястия и галерия",
  "landing.feat6": "Нови ястия с описания на два езика и проверка за алергени",
  "landing.price": "25 € на месец за обект",
  "landing.priceNote": "Хостинг на сайта и агентът, настройката е включена.",
  "landing.evidence": "Преди да имаме продукт, четири заведения ни казаха колко биха плащали на месец: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 €.",
  "landing.built": "Създадено за хакатона „AI That Does the Work“ с Claude. Изкуственият интелект разбира разговорен български, глас и почерк; ние направихме сайта, модела на съдържанието, стъпката за одобрение, насрочването, дневника и инфраструктурата за много обекти.",
  "landing.footer": "Site Manager · сайт, който кафенето ви управлява от Telegram",
  "site.menu": "Меню",
  "site.home": "Начало",
  "site.openUntil": "Отворено до {time}",
  "site.opensAt": "Отваря днес в {time}",
  "site.closedToday": "Днес е почивен ден",
  "site.closedUntil": "Затворено · отваря {when}",
  "site.specials": "Специални предложения днес",
  "site.specialUntil": "до {time}",
  "site.highlights": "От менюто",
  "site.fullMenu": "Вижте цялото меню →",
  "site.about": "За нас",
  "site.hours": "Работно време",
  "site.closedDay": "почивен ден",
  "site.holidays": "Предстоящи почивни дни",
  "site.findUs": "Къде сме",
  "site.map": "Отвори в картата",
  "site.call": "Обади се",
  "site.gallery": "Галерия",
  "site.soldOut": "Изчерпано",
  "site.soldOutUntil": "Изчерпано до {when}",
  "site.allergens": "Алергени",
  "site.allergenLegend": "Кодове на алергените (ЕС 1169/2011)",
  "site.updated": "обновено",
  "site.poweredBy": "Сайт от Site Manager",
  "site.noItems": "Менюто се подготвя.",
  "site.draft": "Чернова, не е публикувана",
  "site.draftApply": "Приложи",
  "site.draftReject": "Отхвърли",
  "site.draftBack": "Обратно към таблото",
  "site.draftApplied": "Приложено. Страницата вече показва живия сайт.",
  "admin.title": "Табло",
  "admin.invalid": "Този линк не е валиден. Поискайте нов от бота с /menu.",
  "admin.qr": "QR код за менюто",
  "admin.qrNote": "Разпечатайте го за масите. Отваря {url}.",
  "admin.pending": "Чакат вашето решение",
  "admin.none": "В момента няма нищо.",
  "admin.apply": "Приложи",
  "admin.reject": "Отхвърли",
  "admin.cancel": "Откажи",
  "admin.undo": "Върни",
  "admin.preview": "Преглед на сайта",
  "admin.scheduled": "Насрочени",
  "admin.scheduledFor": "прилага се на {when}",
  "admin.log": "Дневник на промените",
  "admin.soldOut": "Изчерпани в момента",
  "admin.backAt": "връща се {when}",
  "admin.links": "Линкове",
  "admin.site": "Публичен сайт",
  "admin.menuLink": "Страница с менюто",
  "admin.source.text": "текст",
  "admin.source.voice": "глас",
  "admin.source.photo": "снимка",
  "admin.source.dashboard": "табло",
  "admin.source.auto": "автоматично",
  "admin.source.undo": "връщане",
  "admin.status.proposed": "предложено",
  "admin.status.scheduled": "насрочено",
  "admin.status.applied": "приложено",
  "admin.status.rejected": "отхвърлено",
  "admin.status.expired": "изтекло",
  "admin.status.cancelled": "отказано",
  "admin.status.reverted": "върнато",
  "admin.busy": "Изпълнява се…",
  "admin.failed": "Не се получи. Опитайте отново.",
};

export const DICTS = { en, bg } as const;
```

- [ ] **Step 3: Write `src/i18n/index.tsx`** (client; adapted from the donation repo: URL `?lang=`, localStorage, `document.documentElement.lang`; no `useSearchParams` so no Suspense boundary is needed)

```tsx
// src/i18n/index.tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "../domain/types";
import { DICTS, type MessageKey } from "./dicts";

const STORAGE_KEY = "site-manager.lang";
type Vars = Record<string, string | number>;

function interpolate(s: string, vars?: Vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
function isLang(v: unknown): v is Lang {
  return v === "bg" || v === "en";
}
function readOverride(): Lang | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (isLang(fromUrl)) {
      window.localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  locale: string;
}
const LangContext = createContext<LangContextValue | null>(null);

/** `defaultLang` is the server-known default (venue default_lang or "en" for the landing); the visitor's choice overrides it after mount. */
export function LangProvider({ defaultLang, children }: { defaultLang: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(defaultLang);
  useEffect(() => {
    const o = readOverride();
    if (o) setLangState(o);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      const url = new URL(window.location.href);
      if (url.searchParams.has("lang")) {
        url.searchParams.set("lang", next);
        window.history.replaceState(window.history.state, "", url);
      }
    } catch {
      // storage blocked: the choice just won't survive a reload
    }
  }, []);
  const value = useMemo<LangContextValue>(() => ({ lang, setLang, t: (k, v) => interpolate(DICTS[lang][k], v), locale: lang === "bg" ? "bg-BG" : "en-GB" }), [lang, setLang]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used inside <LangProvider>");
  return ctx;
}

/** EN / БГ segmented control; each language named in itself. */
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang, t } = useLang();
  const options: { value: Lang; label: string; name: string }[] = [
    { value: "bg", label: "БГ", name: "български" },
    { value: "en", label: "EN", name: "English" },
  ];
  return (
    <div role="group" aria-label={t("lang.group")} className={`inline-flex shrink-0 rounded-full bg-card p-1 ring-1 ring-ink/10 ${className}`}>
      {options.map((o) => {
        const active = lang === o.value;
        return (
          <button key={o.value} type="button" lang={o.value} aria-pressed={active} onClick={() => setLang(o.value)}
            className={`min-h-8 min-w-10 rounded-full px-2.5 text-sm font-semibold transition-colors ${active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5 hover:text-ink"}`}>
            {o.label}
            <span className="sr-only">, {o.name}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Replace `app/globals.css`** (tokens, fonts via CSS variables set by `next/font`, animations, reduced motion, projector scale)

```css
@import "tailwindcss";

@theme {
  --color-paper: #faf7f2;
  --color-paper-deep: #f1ebe1;
  --color-card: #fffdf9;
  --color-ink: #1d2a24;
  --color-ink-soft: #4b5a53;
  --color-accent: var(--accent, #2f6b4f);
  --color-accent-soft: color-mix(in oklab, var(--accent, #2f6b4f) 14%, white);
  --color-amber: #8f5c10;
  --color-amber-soft: #fbf0dc;
  --color-clay: #a4442c;
  --color-clay-soft: #f7e4dc;
  --font-sans: var(--font-onest), ui-sans-serif, system-ui, sans-serif;
  --font-display: var(--font-literata), ui-serif, Georgia, serif;
  --animate-rise: rise 520ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
  --animate-flash: flash 2.2s ease-out both;
  --animate-line-in: line-in 700ms cubic-bezier(0.2, 0.7, 0.2, 1) both;

  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  /* Held for ~1.5 s, then fades: readable as "this just changed" from the back of a room. */
  @keyframes flash { 0%, 65% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes line-in { 0% { opacity: 0; transform: translateX(-8px); background-color: var(--color-amber-soft); } 40% { opacity: 1; transform: none; background-color: var(--color-amber-soft); } 100% { background-color: transparent; } }
}

html { -webkit-text-size-adjust: 100%; }
body { background: var(--color-paper); color: var(--color-ink); font-family: var(--font-sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
h1, h2, h3, .font-display { font-family: var(--font-display); font-variation-settings: "opsz" 48; }
/* Faint tinted grain so the off-white does not read as flat on a projector. */
body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background-image: radial-gradient(1200px 600px at 85% -10%, color-mix(in oklab, var(--accent, #2f6b4f) 9%, transparent), transparent 60%),
    radial-gradient(900px 500px at -10% 110%, rgb(183 121 31 / 0.06), transparent 60%); }
:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; border-radius: 6px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}
@media (min-width: 1600px) { html { font-size: 112.5%; } }
```

- [ ] **Step 5: Replace `app/layout.tsx`, write `app/page.tsx`, `app/components/Landing.tsx`, `app/not-found.tsx`**

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { Literata, Onest } from "next/font/google";
import "./globals.css";

const literata = Literata({ subsets: ["latin", "cyrillic"], variable: "--font-literata", display: "swap", axes: ["opsz"] });
const onest = Onest({ subsets: ["latin", "cyrillic"], variable: "--font-onest", display: "swap" });

export const metadata: Metadata = {
  title: "Site Manager",
  description: "A café website its owner runs from Telegram.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bg" className={`${literata.variable} ${onest.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx
import { LangProvider } from "@/src/i18n";
import { Landing } from "./components/Landing";

export default function Page() {
  return (
    <LangProvider defaultLang="en">
      <Landing demoSlug={process.env.DEMO_VENUE_SLUG?.trim() || "agala"} />
    </LangProvider>
  );
}
```

```tsx
// app/components/Landing.tsx
"use client";
import Link from "next/link";
import { LangToggle, useLang } from "@/src/i18n";
import { SITE_NAME } from "@/src/i18n/dicts";

export function Landing({ demoSlug }: { demoSlug: string }) {
  const { t } = useLang();
  const steps = [1, 2, 3] as const;
  const feats = [1, 2, 3, 4, 5, 6] as const;
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-display text-lg font-semibold">{SITE_NAME}</span>
        <LangToggle />
      </header>
      <section className="animate-rise pt-8 sm:pt-16">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent">{t("landing.eyebrow")}</p>
        <h1 className="mt-3 text-4xl font-semibold leading-tight sm:text-6xl">{t("landing.h1")}</h1>
        <p className="mt-5 max-w-2xl text-lg text-ink-soft">{t("landing.lead")}</p>
        <div className="mt-8 flex flex-col items-start gap-2">
          <Link href={`/${demoSlug}`} className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:brightness-110">{t("landing.cta")}</Link>
          <span className="text-sm text-ink-soft">{t("landing.ctaNote")}</span>
        </div>
      </section>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">{t("landing.how")}</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {steps.map((n) => (
            <li key={n} className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
              <span className="font-display text-3xl text-accent">{n}</span>
              <h3 className="mt-2 text-lg font-semibold">{t(`landing.step${n}.title`)}</h3>
              <p className="mt-1 text-ink-soft">{t(`landing.step${n}.body`)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">{t("landing.what")}</h2>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {feats.map((n) => (
            <li key={n} className="flex gap-3 rounded-2xl bg-paper-deep px-4 py-3"><span aria-hidden="true" className="text-accent">●</span><span>{t(`landing.feat${n}`)}</span></li>
          ))}
        </ul>
      </section>
      <section className="mt-16 rounded-3xl bg-ink p-6 text-paper sm:p-10">
        <p className="font-display text-3xl font-semibold sm:text-4xl">{t("landing.price")}</p>
        <p className="mt-2 text-paper/80">{t("landing.priceNote")}</p>
        <p className="mt-6 border-t border-paper/20 pt-6 text-paper/90">{t("landing.evidence")}</p>
      </section>
      <section className="mt-12 text-ink-soft">
        <p>{t("landing.built")}</p>
      </section>
      <footer className="mt-16 text-sm text-ink-soft">{t("landing.footer")}</footer>
    </main>
  );
}
```

```tsx
// app/not-found.tsx
import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-semibold">Page not found · Страницата не е намерена</h1>
      <Link href="/" className="mt-6 text-accent underline">Site Manager</Link>
    </main>
  );
}
```

- [ ] **Step 5b: Lovable landing (user's decision 2026-10-10: the public landing is built in Lovable as a hackathon requirement)**

1. In `app/page.tsx`, before rendering `<Landing>`, read `process.env.NEXT_PUBLIC_LANDING_URL?.trim()`; when it is a non-empty `https://` URL, `redirect(url)` (from `next/navigation`). Otherwise render the Next.js landing as the fallback. Add `NEXT_PUBLIC_LANDING_URL=` with a comment ("the Lovable landing; when set, / redirects there") to `.env.example` and `.env.local`.
2. Create `docs/lovable/LANDING-PROMPT.md`: a prompt pack the user pastes into Lovable. Contents, in this order: (a) one paragraph telling Lovable what to build: a single-page bilingual (BG/EN toggle, default EN, remember the choice) marketing landing for "Site Manager", mobile-first, no backend, no forms, no contact section, one primary button "Open the demo café →" linking to `{{DEMO_URL}}` (the user replaces it with `<PUBLIC_BASE_URL>/agala`), and a small footer line "Landing built with Lovable · product by Site Manager"; (b) the exact copy for every section in both languages, taken verbatim from `src/i18n/dicts.ts` keys `landing.*` (eyebrow, h1, lead, cta, ctaNote, how + 3 steps, what + 6 features, price, priceNote, evidence, built, footer), presented as two columns or two blocks per section; (c) design tokens: paper `#faf7f2`, paper-deep `#f1ebe1`, card `#fffdf9`, ink `#1d2a24`, ink-soft `#4b5a53`, accent `#2f6b4f`, amber `#8f5c10`; fonts Literata (display, headings) and Onest (body) from Google Fonts with Cyrillic subsets; rounded-3xl cards, generous whitespace, WCAG AA contrast; a dark ink "price" block; (d) rules: no testimonials or logos that are not in the copy, no stock photos of people, no invented numbers, keep the four venue names and amounts exactly; (e) after it is published: paste the Lovable URL into `NEXT_PUBLIC_LANDING_URL` (Vercel env + `.env.local`) so `/` redirects there, and put `<PUBLIC_BASE_URL>/agala` into the demo button.
3. `test/i18n.test.ts` gains nothing; the README (Task 19) gets a "Landing page (Lovable)" subsection pointing at the prompt pack.

- [ ] **Step 6: Verify**

Run: `npx vitest run test/i18n.test.ts` → PASS; `npx tsc --noEmit`; `npx next build` → green (fonts download at build; if the network blocks Google Fonts, the build fails with a clear message: then switch to `next/font/local` with `@fontsource` files and note it). Then start `npx next dev -p 3100` in the background, `curl -s http://localhost:3100/ | grep -o "Your café's website, managed by chat."`, confirm, stop the server.

- [ ] **Step 7: Commit**

```bash
git add src/i18n app/globals.css app/layout.tsx app/page.tsx app/components/Landing.tsx app/not-found.tsx test/i18n.test.ts docs/lovable/LANDING-PROMPT.md .env.example
git commit -m "Web: bilingual i18n layer, design tokens and fonts, fallback landing, Lovable landing prompt pack

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Public site: home and menu with live updates and draft preview

**Files:**
- Create: `src/server/site.ts`, `src/lib/supabase-browser.ts`, `app/api/site/[slug]/route.ts`, `app/[slug]/page.tsx`, `app/[slug]/menu/page.tsx`, `app/[slug]/components/{SiteView,useLiveSite,SiteHeader,TodayStatus,Specials,MenuList,Highlights,AboutHours,Gallery,DraftBanner,SiteFooter}.tsx`
- Test: `test/site-server.test.ts`

**Interfaces:**
- Consumes: `getServerDeps` (Task 15), `applyChanges` (Task 4), `visibleItems`/`isSoldOut`/`liveAnnouncements` (Task 5), `todayStatus` (Task 1), `LangProvider` (Task 16).
- Produces: `loadSite(store, slug, opts?: { draftId?, key? }): Promise<{ state: SiteState; draft: DraftInfo | null } | null>` where `DraftInfo = { id; status; summary_bg; summary_en; preview_bg; preview_en }`; `GET /api/site/[slug]` → `{ state: SiteState; now: string }`; `useLiveSite(initial, slug, live: boolean)` → `{ state, now, changed: Set<string> }`; `SiteView({ state, slug, page: "home" | "menu", draft, live })`.

- [ ] **Step 1: Write the failing server test**

```ts
// test/site-server.test.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { loadSite } from "@/src/server/site";
import { makeDemo } from "./helpers";

describe("loadSite", () => {
  it("returns the live state, null for an unknown slug, and ignores draft without a valid key", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: "2026-10-09T09:00:00.000Z" }) });
    expect(await loadSite(store, "nope")).toBeNull();
    const live = await loadSite(store, "agala");
    expect(live?.draft).toBeNull();
    expect(live?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    const noKey = await loadSite(store, "agala", { draftId: cs.id, key: "wrong" });
    expect(noKey?.draft).toBeNull();
    const key = await store.getAdminToken(venue.id);
    const draft = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(draft?.draft).toMatchObject({ id: cs.id, status: "proposed", summary_en: "Cappuccino €3.20" });
    expect(draft?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    await store.applyChangeSet(cs.id, "2026-10-09T09:00:00.000Z");
    const applied = await loadSite(store, "agala", { draftId: cs.id, key });
    expect(applied?.draft).toMatchObject({ status: "applied" }); // banner says it is live now; state is not re-applied
    expect(applied?.state.items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
  });
});
```

- [ ] **Step 2: Implement `src/server/site.ts`, the browser client and the site route**

```ts
// src/server/site.ts
import { applyChanges } from "../domain/changes";
import type { SiteState } from "../domain/types";
import type { Store } from "../store/types";

export interface DraftInfo {
  id: string;
  status: string;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
}

/** Live state for a slug; with a valid admin key and a pending draft id, the state with that draft applied on top. */
export async function loadSite(store: Store, slug: string, opts: { draftId?: string | null; key?: string | null } = {}): Promise<{ state: SiteState; draft: DraftInfo | null } | null> {
  const venue = await store.getVenueBySlug(slug);
  if (!venue) return null;
  let state = await store.getSite(venue.id);
  let draft: DraftInfo | null = null;
  if (opts.draftId && opts.key) {
    const owner = await store.findVenueByAdminToken(opts.key);
    if (owner && owner.id === venue.id) {
      try {
        const cs = await store.getChangeSet(opts.draftId);
        if (cs.venue_id === venue.id) {
          draft = { id: cs.id, status: cs.status, summary_bg: cs.summary_bg, summary_en: cs.summary_en, preview_bg: cs.preview_bg, preview_en: cs.preview_en };
          if (cs.status === "proposed" || cs.status === "scheduled") {
            try {
              state = applyChanges(state, cs.changes);
            } catch (e) {
              console.error("[site] draft apply failed:", e instanceof Error ? e.message : e);
            }
          }
        }
      } catch {
        draft = null;
      }
    }
  }
  return { state, draft };
}
```

```ts
// src/lib/supabase-browser.ts
"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Only NEXT_PUBLIC_* here: this file ships to the browser.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const realtimeConfigured = !!url && !!anon;
let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  if (!realtimeConfigured) return null;
  client ??= createClient(url as string, anon as string, { auth: { persistSession: false } });
  return client;
}
```

```ts
// app/api/site/[slug]/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { loadSite } from "@/src/server/site";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/site/[slug]">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const site = await loadSite(deps.store, slug);
  if (!site) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ state: site.state, now: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
```

- [ ] **Step 3: Pages**

```tsx
// app/[slug]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { getServerDeps } from "@/src/server/deps";
import { loadSite } from "@/src/server/site";
import { SiteView } from "./components/SiteView";

export const dynamic = "force-dynamic";

async function load(slug: string, sp: Record<string, string | string[] | undefined>) {
  const deps = await getServerDeps((fn) => after(fn));
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return loadSite(deps.store, slug, { draftId: one(sp.draft), key: one(sp.key) });
}

export async function generateMetadata(props: PageProps<"/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const site = await load(slug, {});
  return site ? { title: site.state.venue.name, description: site.state.venue.default_lang === "bg" ? site.state.venue.tagline_bg : site.state.venue.tagline_en } : { title: "Site Manager" };
}

export default async function Page(props: PageProps<"/[slug]">) {
  const { slug } = await props.params;
  const site = await load(slug, await props.searchParams);
  if (!site) notFound();
  return (
    <LangProvider defaultLang={site.state.venue.default_lang}>
      <SiteView state={site.state} slug={slug} page="home" draft={site.draft} live={site.draft === null} />
    </LangProvider>
  );
}
```

`app/[slug]/menu/page.tsx` is identical with `page="menu"` and `PageProps<"/[slug]/menu">`; share `load` by moving it to `app/[slug]/load.ts`.

- [ ] **Step 4: Components** (client; mobile-first; the accent is set as a CSS variable on the wrapper)

```tsx
// app/[slug]/components/useLiveSite.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { SiteState } from "@/src/domain/types";
import { supabaseBrowser } from "@/src/lib/supabase-browser";

const TABLES = ["items", "categories", "venues", "holidays", "announcements", "site_texts", "media"];

function signature(s: SiteState): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of s.items) m.set(i.id, JSON.stringify([i.name_bg, i.name_en, i.desc_bg, i.desc_en, i.price_eur, i.allergens, i.image_media_id, i.sold_out_until, i.is_special, i.special_expires_at, i.active]));
  m.set("venue", JSON.stringify(s.venue));
  return m;
}

/** Polls every 5 s and refetches on realtime events (when configured). `changed` holds ids whose content just changed, for the flash. */
export function useLiveSite(initial: SiteState, slug: string, live: boolean) {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [changed, setChanged] = useState<Map<string, number>>(new Map());
  const seq = useRef(0);
  const prev = useRef(signature(initial));

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const load = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(`/api/site/${slug}`, { cache: "no-store" });
        if (!res.ok || mine !== seq.current || stop) return; // a newer request already started; drop this stale response
        const data = (await res.json()) as { state: SiteState };
        const sig = signature(data.state);
        const at = Date.now();
        const diff = new Map<string, number>();
        for (const [id, v] of sig) if (prev.current.get(id) !== v) diff.set(id, at);
        prev.current = sig;
        if (diff.size) setChanged((c) => new Map([...c, ...diff]));
        setState(data.state);
      } catch {
        // keep the last good state; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), 5000); // safety net if realtime is off
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 250);
    };
    const sb = supabaseBrowser();
    const channel = sb ? TABLES.reduce((ch, table) => ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `venue_id=eq.${initial.venue.id}` }, refresh), sb.channel(`site-${initial.venue.id}`)).subscribe() : null;
    return () => {
      stop = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.clearTimeout(timer);
      if (sb && channel) void sb.removeChannel(channel);
    };
  }, [slug, live, initial.venue.id]);

  return { state, now, changed };
}
```

`venues` has `id`, not `venue_id`: subscribe to it with `filter: \`id=eq.${initial.venue.id}\`` (special-case the table name in the reduce).

```tsx
// app/[slug]/components/SiteView.tsx
"use client";
import type { SiteState } from "@/src/domain/types";
import type { DraftInfo } from "@/src/server/site";
import { DraftBanner } from "./DraftBanner";
import { Gallery } from "./Gallery";
import { AboutHours } from "./AboutHours";
import { Highlights } from "./Highlights";
import { MenuList } from "./MenuList";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { Specials } from "./Specials";
import { TodayStatus } from "./TodayStatus";
import { useLiveSite } from "./useLiveSite";

export function SiteView({ state: initial, slug, page, draft, live }: { state: SiteState; slug: string; page: "home" | "menu"; draft: DraftInfo | null; live: boolean }) {
  const { state, now, changed } = useLiveSite(initial, slug, live);
  const accent = /^#[0-9a-f]{6}$/i.test(state.venue.theme.accent) ? state.venue.theme.accent : "#2f6b4f";
  return (
    <div style={{ "--accent": accent } as React.CSSProperties} className="flex min-h-full flex-col">
      {draft && <DraftBanner draft={draft} slug={slug} />}
      <SiteHeader state={state} slug={slug} page={page} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 sm:px-6">
        <TodayStatus state={state} now={now} />
        {page === "home" ? (
          <>
            <Specials state={state} now={now} changed={changed} />
            <Highlights state={state} now={now} slug={slug} changed={changed} />
            <AboutHours state={state} now={now} />
            <Gallery state={state} />
          </>
        ) : (
          <MenuList state={state} now={now} changed={changed} />
        )}
      </main>
      <SiteFooter state={state} />
    </div>
  );
}
```

Write the remaining components with these responsibilities (each a small client component using `useLang()`; prices via `formatPrice`; names via `itemName`/`categoryName`; images via `next/image` with `fill`/`sizes` from `media.public_url`, or a neutral tile `bg-paper-deep` when there is no image):

- `SiteHeader`: cover image (`venue.cover_media_id` → media `public_url`) as a 40vh hero with the logo circle, name (`font-display`), tagline in the current language, `LangToggle`, nav links Home / Menu. Without a cover: a solid accent-tinted band.
- `TodayStatus`: `todayStatus(hours, holidays, new Date(now), tz)` → "Open until 18:00" / "Opens today at 08:00" / "Closed today" / "Closed · opens 12.10.2026, 08:00"; a holiday note when `holiday` is set; live announcements (`liveAnnouncements`) as amber chips.
- `Specials`: `visibleItems` ∩ `is_special` → cards "Today's specials" with "until 18:00" from `special_expires_at` in the venue tz (`localTime`); hidden when none. Changed ids get the `animate-flash` overlay (`key={changed.get(id)}` so it re-triggers).
- `Highlights`: first 4 visible non-special items with images first, link "See the full menu →".
- `MenuList`: categories in order, each with its visible items: name, description (current language), price, allergen codes as small chips with `title` = name, sold-out badge (`isSoldOut`) with "Sold out until 10.10.2026, 09:00" and `opacity-50 line-through` on the price; the allergen legend at the end listing only codes used on this menu. Empty menu → `site.noItems`.
- `AboutHours`: about text, hours table (`weekdayLabel`, today's row bold), upcoming holidays (date ≥ today), address with map link, phone `tel:`, Instagram link.
- `Gallery`: `media.is_gallery` sorted by position; hidden when empty.
- `DraftBanner`: sticky top bar "Draft preview, not live · {summary}" with Apply / Reject buttons that `POST /api/admin/{slug}?key={key}` with `{ action, change_set_id }` (key read from `window.location.search`), then `router.replace(\`/${slug}\`)`; when `draft.status !== "proposed"` show the status instead of buttons and the "Back to the dashboard" link.
- `SiteFooter`: footer_note text, "Site by Site Manager" link to `/`.

- [ ] **Step 5: Verify**

`npx vitest run test/site-server.test.ts` → PASS; `npx tsc --noEmit`; `npx next build` green. Then `SITE_MANAGER_STORE=memory npx next dev -p 3100` in the background and check with curl: `/agala` contains "Кафене „Ъгъла“" and "Отворено до" or "Затворено" (depending on the clock), `/agala/menu` contains "Капучино" and "2,90 €", `/nope` returns 404, `/api/site/agala` returns JSON with 12 items. Open the preview in the browser pane (`preview_start` with a `.claude/launch.json` entry `{"name":"offline","runtimeExecutable":"npm","runtimeArgs":["run","dev:offline"],"port":3000}`) and take one screenshot of `/agala` at mobile width and one of `/agala/menu`; fix anything that looks broken (overflow, unreadable contrast) before committing.

- [ ] **Step 6: Commit**

```bash
git add src/server/site.ts src/lib/supabase-browser.ts app/api/site app/[slug] test/site-server.test.ts .claude/launch.json
git commit -m "Web: public café site (home, menu) with live updates, read-time availability and draft preview

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Owner dashboard (approvals, drafts, schedule, log, undo, QR)

**Files:**
- Create: `src/server/admin.ts`, `app/api/admin/[slug]/route.ts`, `app/admin/[slug]/page.tsx`, `app/admin/[slug]/components/AdminPanel.tsx`
- Test: `test/admin-server.test.ts`

**Interfaces:**
- Produces: `adminOverview(store, venue, now): Promise<AdminOverview>` with `{ venue: { id, slug, name, tz, default_lang }, now, public_url, pending: ChangeSet[], scheduled: ChangeSet[], log: ChangeSet[], sold_out: { id, name_bg, name_en, sold_out_until }[] }`; `adminAction(d: { store; messenger; now; baseUrl }, venue, action: "apply" | "reject" | "cancel" | "undo", setId): Promise<{ ok: boolean; status?: string; change_set_id?: string; error?: string }>`; `GET /api/admin/[slug]?key=` → overview or 401; `POST /api/admin/[slug]?key=` body `{ action, change_set_id }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/admin-server.test.ts
import { describe, expect, it } from "vitest";
import { planChanges } from "@/src/domain/changes";
import { adminAction, adminOverview } from "@/src/server/admin";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("admin", () => {
  it("builds the overview and applies, rejects, cancels and undoes with the Telegram message edited", async () => {
    const { store, venue, items } = await makeDemo();
    const messenger = new FakeMessenger();
    const d = { store, messenger, now: () => T0, baseUrl: "https://site.example" };
    const site = await store.getSite(venue.id);
    const mk = (status: "proposed" | "scheduled", price: number, applyAt: string | null = null) =>
      store.createChangeSet({ venue_id: venue.id, chat_id: 1001, summary_bg: `Капучино ${price}`, summary_en: `Cappuccino ${price}`, preview_bg: "p", preview_en: "p", source: "text", status, apply_at: applyAt, tg_message_id: 42, changes: planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: price }], { newId: () => "n", now: T0.toISOString() }) });
    const p1 = await mk("proposed", 3.2);
    const p2 = await mk("proposed", 3.3);
    const s1 = await mk("scheduled", 3.4, "2026-12-01T08:00:00.000Z");
    const o = await adminOverview(store, venue, T0, "https://site.example");
    expect(o.public_url).toBe("https://site.example/agala");
    expect(o.pending.map((x) => x.id)).toEqual([p2.id, p1.id]);
    expect(o.scheduled.map((x) => x.id)).toEqual([s1.id]);
    expect(o.log).toEqual([]);

    expect(await adminAction(d, venue, "apply", p1.id)).toEqual({ ok: true, status: "applied", change_set_id: p1.id });
    expect(messenger.edits[0]).toMatchObject({ chatId: 1001, messageId: 42 });
    expect(messenger.edits[0].text).toContain("✅");
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(3.2);
    expect(await adminAction(d, venue, "reject", p2.id)).toEqual({ ok: true, status: "rejected", change_set_id: p2.id });
    expect(await adminAction(d, venue, "cancel", s1.id)).toEqual({ ok: true, status: "cancelled", change_set_id: s1.id });
    expect(await adminAction(d, venue, "apply", p2.id)).toEqual({ ok: false, error: 'Change set is "rejected".' });

    const u = await adminAction(d, venue, "undo", p1.id);
    expect(u.ok).toBe(true);
    expect((await store.getSite(venue.id)).items.find((i) => i.id === items.Cappuccino.id)?.price_eur).toBe(2.9);
    expect((await store.getChangeSet(p1.id)).status).toBe("reverted");
    const after = await adminOverview(store, venue, T0, "https://site.example");
    expect(after.log.map((x) => x.status)).toEqual(["applied", "cancelled", "rejected", "reverted"]);
    expect(after.log[0]).toMatchObject({ source: "undo", undoes_id: p1.id });
  });
  it("lists sold-out items with return times", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "", summary_en: "", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: planChanges(site, [{ op: "set_sold_out", item_id: items["Cheese banitsa"].id, until: "2026-10-10T06:00:00.000Z" }], { newId: () => "n", now: T0.toISOString() }) });
    await store.applyChangeSet(cs.id, T0.toISOString());
    const o = await adminOverview(store, venue, T0);
    expect(o.sold_out).toEqual([{ id: items["Cheese banitsa"].id, name_bg: "Баница със сирене", name_en: "Cheese banitsa", sold_out_until: "2026-10-10T06:00:00.000Z" }]);
  });
});
```

- [ ] **Step 2: Implement `src/server/admin.ts`**

```ts
// src/server/admin.ts
import type { Messenger } from "../bot/messenger";
import { invertChanges } from "../domain/changes";
import { isSoldOut } from "../domain/effective";
import { renderPreview } from "../domain/preview";
import type { ChangeSet, Venue } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";

export interface AdminOverview {
  venue: Pick<Venue, "id" | "slug" | "name" | "tz" | "default_lang">;
  now: string;
  public_url: string;
  pending: ChangeSet[];
  scheduled: ChangeSet[];
  log: ChangeSet[];
  sold_out: { id: string; name_bg: string; name_en: string; sold_out_until: string }[];
}

export async function adminOverview(store: Store, venue: Venue, now: Date, baseUrl = ""): Promise<AdminOverview> {
  const [pending, scheduled, log, site] = await Promise.all([
    store.listChangeSets(venue.id, { status: ["proposed"], limit: 20 }),
    store.listChangeSets(venue.id, { status: ["scheduled"], limit: 50 }),
    store.listChangeSets(venue.id, { status: ["applied", "reverted", "rejected", "expired", "cancelled"], limit: 50 }),
    store.getSite(venue.id),
  ]);
  const nowMs = now.getTime();
  return {
    venue: { id: venue.id, slug: venue.slug, name: venue.name, tz: venue.tz, default_lang: venue.default_lang },
    now: now.toISOString(),
    public_url: `${baseUrl}/${venue.slug}`,
    pending,
    scheduled: [...scheduled].sort((a, b) => (a.apply_at ?? "").localeCompare(b.apply_at ?? "")),
    log,
    sold_out: site.items.filter((i) => i.active && isSoldOut(i, nowMs)).map((i) => ({ id: i.id, name_bg: i.name_bg, name_en: i.name_en, sold_out_until: i.sold_out_until as string })),
  };
}

export type AdminActionName = "apply" | "reject" | "cancel" | "undo";
export interface AdminDeps {
  store: Store;
  messenger: Messenger;
  now: () => Date;
  baseUrl: string;
}

async function editTelegram(d: AdminDeps, cs: ChangeSet, mark: { bg: string; en: string }) {
  if (cs.chat_id === null || cs.tg_message_id === null) return;
  const member = await d.store.findMember(cs.chat_id);
  const lang = member?.lang ?? "bg";
  await d.messenger.edit(cs.chat_id, cs.tg_message_id, `${lang === "bg" ? cs.preview_bg : cs.preview_en}\n\n${lang === "bg" ? mark.bg : mark.en}`);
}

/** The owner's dashboard decisions. The owner's key is the authority, so "apply" applies at once (or schedules a future apply_at). */
export async function adminAction(d: AdminDeps, venue: Venue, action: AdminActionName, setId: string): Promise<{ ok: boolean; status?: string; change_set_id?: string; error?: string }> {
  let cs: ChangeSet;
  try {
    cs = await d.store.getChangeSet(setId);
  } catch {
    return { ok: false, error: "Change set not found." };
  }
  if (cs.venue_id !== venue.id) return { ok: false, error: "Change set not found." };
  const now = d.now();
  const nowIso = now.toISOString();
  if (action === "undo") {
    if (cs.status !== "applied") return { ok: false, error: `Change set is "${cs.status}".` };
    const site = await d.store.getSite(venue.id);
    const changes = invertChanges(cs.changes);
    const undo = await d.store.createChangeSet({
      venue_id: venue.id, chat_id: cs.chat_id, summary_bg: `Отмяна: ${cs.summary_bg}`, summary_en: `Undo: ${cs.summary_en}`,
      preview_bg: renderPreview(site, changes, "bg", venue.tz), preview_en: renderPreview(site, changes, "en", venue.tz),
      source: "undo", status: "proposed", undoes_id: cs.id, changes,
    });
    await d.store.applyChangeSet(undo.id, nowIso);
    if (cs.chat_id !== null) await d.messenger.send(cs.chat_id, (await d.store.findMember(cs.chat_id))?.lang === "en" ? `↩️ Reverted from the dashboard: ${cs.summary_en}` : `↩️ Отменено от таблото: ${cs.summary_bg}`);
    return { ok: true, status: "applied", change_set_id: undo.id };
  }
  if (action === "cancel") {
    if (cs.status !== "proposed" && cs.status !== "scheduled") return { ok: false, error: `Change set is "${cs.status}".` };
    await d.store.updateChangeSet(cs.id, { status: "cancelled", decided_at: nowIso });
    await editTelegram(d, cs, { bg: "❌ Отказано от таблото.", en: "❌ Cancelled from the dashboard." });
    return { ok: true, status: "cancelled", change_set_id: cs.id };
  }
  if (cs.status !== "proposed") return { ok: false, error: `Change set is "${cs.status}".` };
  if (action === "reject") {
    await d.store.updateChangeSet(cs.id, { status: "rejected", decided_at: nowIso });
    await editTelegram(d, cs, { bg: "❌ Отхвърлено от таблото.", en: "❌ Rejected from the dashboard." });
    return { ok: true, status: "rejected", change_set_id: cs.id };
  }
  if (cs.apply_at && Date.parse(cs.apply_at) > now.getTime()) {
    await d.store.updateChangeSet(cs.id, { status: "scheduled", decided_at: nowIso });
    await editTelegram(d, cs, { bg: `⏰ Насрочено от таблото за ${formatDateTime(cs.apply_at, "bg", venue.tz)}`, en: `⏰ Scheduled from the dashboard for ${formatDateTime(cs.apply_at, "en", venue.tz)}` });
    return { ok: true, status: "scheduled", change_set_id: cs.id };
  }
  const r = await d.store.applyChangeSet(cs.id, nowIso);
  if (r === "skipped") return { ok: false, error: `Change set is "${(await d.store.getChangeSet(cs.id)).status}".` };
  await editTelegram(d, cs, { bg: "✅ Приложено от таблото.", en: "✅ Applied from the dashboard." });
  return { ok: true, status: "applied", change_set_id: cs.id };
}
```

- [ ] **Step 3: Route and page**

```ts
// app/api/admin/[slug]/route.ts
import { after } from "next/server";
import { adminAction, adminOverview, type AdminActionName } from "@/src/server/admin";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

async function auth(req: Request, slug: string) {
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return { deps, venue: null };
  return { deps, venue };
}

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string };
  const actions: AdminActionName[] = ["apply", "reject", "cancel", "undo"];
  if (!actions.includes(body.action as AdminActionName) || typeof body.change_set_id !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  const r = await adminAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, body.action as AdminActionName, body.change_set_id);
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
```

```tsx
// app/admin/[slug]/page.tsx
import { after } from "next/server";
import { LangProvider } from "@/src/i18n";
import { adminOverview } from "@/src/server/admin";
import { getServerDeps } from "@/src/server/deps";
import { AdminPanel } from "./components/AdminPanel";
import { InvalidKey } from "./components/InvalidKey";

export const dynamic = "force-dynamic";

export default async function Page(props: PageProps<"/admin/[slug]">) {
  const { slug } = await props.params;
  const sp = await props.searchParams;
  const key = (Array.isArray(sp.key) ? sp.key[0] : sp.key) ?? "";
  const deps = await getServerDeps((fn) => after(fn));
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) {
    return (
      <LangProvider defaultLang="bg"><InvalidKey /></LangProvider>
    );
  }
  const overview = await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl);
  return (
    <LangProvider defaultLang={venue.default_lang}>
      <AdminPanel slug={slug} adminKey={key} initial={overview} />
    </LangProvider>
  );
}
```

`InvalidKey`: a client component showing `admin.invalid` with the `LangToggle`.

`AdminPanel` (client): polls `GET /api/admin/${slug}?key=` every 3 s with the same sequence guard as `useLiveSite`; sections in this order: header (venue name, `LangToggle`), **Waiting for your decision** (each pending set: summary, preview as `<pre class="whitespace-pre-wrap">`, source chip, buttons Apply / Reject / "Preview on the site" → `/${slug}?draft=${id}&key=${key}` opened in a new tab), **Scheduled** (summary, "applies on {when}", Cancel), **Sold out right now** (name, "back {when}"), **Change log** (summary, status chip, source, time, expandable before → after per change rendered from `preview_*`, Undo button only for `applied`), **QR code** (`QRCodeSVG` from `qrcode.react`, `value={public_url}/menu`, size 200, with `admin.qrNote`), **Links** (site, menu). Buttons POST and then refetch immediately; disable the button while busy; show `admin.failed` on a non-OK response. Times with `formatDateTime(iso, lang, venue.tz)`.

- [ ] **Step 4: Verify**

`npx vitest run test/admin-server.test.ts` → PASS; `npx tsc --noEmit`; `npx next build` green. Offline run: `SITE_MANAGER_STORE=memory npx next dev -p 3100`, read the admin link from the dev server log, `curl` it and check "Табло"/"Dashboard" renders and `/admin/agala?key=wrong` renders the invalid-key page. In the browser pane: open the admin link, create a proposal through the API (there is no bot in memory mode without Telegram) by calling the offline e2e script from Task 19 **or** by temporarily POSTing to nothing; simplest: after Task 19's `e2e-offline` exists, re-check. For now, screenshot the dashboard with the demo data (log empty, QR visible) at mobile width.

- [ ] **Step 5: Commit**

```bash
git add src/server/admin.ts app/api/admin app/admin test/admin-server.test.ts
git commit -m "Web: owner dashboard with approvals, draft preview links, schedule, log with undo, QR

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Venue scripts, offline e2e, smoke, README, final checks

**Files:**
- Create: `scripts/venue-create.mts`, `scripts/demo-reset.mts`, `scripts/e2e-offline.mts`, `scripts/smoke.mts`
- Modify: `README.md` (replace the scaffold README), `package.json` (`e2e` script already points to `scripts/e2e-offline.mts`)

- [ ] **Step 1: `scripts/venue-create.mts`**

```ts
// npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg [--seed demo] [--tz Europe/Sofia]
// Prints the owner invite code, a staff invite code and the admin link ONCE. Keep them.
import { DEMO_VENUE, seedDemo } from "../src/seed/demo";
import { makeServerDeps } from "../src/server/deps";
import { INVITE_TTL_MS } from "../src/bot/bot";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const slug = args.get("slug");
const name = args.get("name");
if (!slug || !name) throw new Error('Usage: npm run venue:create -- --name "Name" --slug my-cafe [--lang bg|en] [--seed demo]');
const lang = args.get("lang") === "en" ? "en" : "bg";

const deps = await makeServerDeps({ defer: (fn) => void fn() });
if (await deps.store.getVenueBySlug(slug)) throw new Error(`slug "${slug}" already exists (use npm run demo:reset to wipe the demo venue's content)`);
const venue = args.get("seed") === "demo"
  ? (await seedDemo(deps.store, slug)).venue
  : await deps.store.createVenue({ ...DEMO_VENUE, slug, name, default_lang: lang, tagline_bg: "", tagline_en: "", about_bg: "", about_en: "", address: "", phone: "", maps_url: "", instagram: "", tz: args.get("tz") || "Europe/Sofia" });
if (args.get("seed") === "demo" && venue.name !== name) await deps.store.createVenue; // demo keeps its own name; the flag wins
const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
const owner = await deps.store.createInvite(venue.id, "owner", expires);
const staff = await deps.store.createInvite(venue.id, "staff", expires);
const token = await deps.store.getAdminToken(venue.id);
console.log(`venue ${venue.slug} created (${venue.id})`);
console.log(`site:        ${deps.config.publicBaseUrl}/${venue.slug}`);
console.log(`admin link:  ${deps.config.publicBaseUrl}/admin/${venue.slug}?key=${token}`);
console.log(`owner code:  /start ${owner}   (valid 7 days, one use)`);
console.log(`staff code:  /start ${staff}   (valid 7 days, one use)`);
```

(Delete the nonsense `if (... ) await deps.store.createVenue;` line; with `--seed demo` the demo name is used and `--name` is ignored, say so in the usage text.)

- [ ] **Step 2: `scripts/demo-reset.mts`** — clears the demo venue's content and re-seeds the demo menu and texts, keeping members and the admin token; prints the counts. Uses `store.clearVenueContent(venue.id)` then re-inserts categories/items/texts with the same loop as `seedDemo` (extract `seedMenu(store, venueId)` from `seedDemo` so both share it). Also deletes the webhook? No. Also resets `cover_media_id`/`logo_media_id` (done by `clearVenueContent`).

- [ ] **Step 3: `scripts/e2e-offline.mts`** — the demo sequence against the memory store, no network:

```ts
// npm run e2e  — the demo flow offline: proposal → approve → applied; instant sold-out; schedule; undo; tick. Exit 1 on any mismatch.
import { makeTools } from "../src/agent/tools";
import { handleDecision } from "../src/bot/approvals";
import type { Messenger } from "../src/bot/messenger";
import { seedDemo } from "../src/seed/demo";
import { InMemoryStore } from "../src/store/memory";
import { runTick } from "../src/tick";
import { adminAction, adminOverview } from "../src/server/admin";

class ConsoleMessenger implements Messenger {
  lastSetId: string | null = null;
  async send(chatId: number, text: string) { console.log(`→ [${chatId}] ${text}`); return 1; }
  async sendProposal(chatId: number, text: string, setId: string) { this.lastSetId = setId; console.log(`→ [${chatId}] ${text}\n   [✅ Приложи] [✏️ Промени] [❌ Откажи]`); return 2; }
  async edit(chatId: number, messageId: number, text: string) { console.log(`✎ [${chatId}#${messageId}] ${text.split("\n").pop()}`); }
}

const store = new InMemoryStore();
const { venue, items } = await seedDemo(store);
await store.upsertMember({ venue_id: venue.id, tg_chat_id: 1, role: "owner", lang: "bg" });
const member = (await store.findMember(1))!;
const messenger = new ConsoleMessenger();
let now = new Date("2026-10-09T09:00:00.000Z");
const tools = makeTools({ store, venueId: venue.id, chatId: 1, member, messenger, now: () => now, baseUrl: "http://localhost:3000" });
const call = async (name: string, input: unknown) => { const t = tools.find((x) => x.name === name)!; return JSON.parse(await (t.run as (i: unknown) => Promise<string>)(t.inputSchema.parse(input))); };
const assert = (cond: unknown, msg: string) => { if (!cond) { console.error(`FAIL ${msg}`); process.exit(1); } console.log(`PASS ${msg}`); };
const price = async (id: string) => (await store.getSite(venue.id)).items.find((i) => i.id === id)!.price_eur;
const cap = items.find((i) => i.name_en === "Cappuccino")!;
const ban = items.find((i) => i.name_en === "Cheese banitsa")!;

console.log("\n1. „Капучиното става 3,20“");
const p = await call("propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: cap.id, price_eur: 3.2 }] });
assert(p.status === "proposed" && (await price(cap.id)) === 2.9, "proposal sent, nothing applied yet");
await handleDecision({ store, messenger, now: () => now }, 1, "apply", p.change_set_id);
assert((await price(cap.id)) === 3.2, "✅ applies the price");

console.log("\n2. „Баницата свърши“");
const so = await call("propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa sold out", changes: [{ op: "set_sold_out", item_id: ban.id, until: "next_opening" }] });
assert(so.status === "applied" && so.sold_out_until === "2026-10-10T06:00:00.000Z", "sold out instantly until tomorrow 09:00");

console.log("\n3. Снимка на дъската → специални предложения");
const sp = await call("propose_changes", { summary_bg: "Днешни предложения", summary_en: "Today's specials", changes: [{ op: "add_item", item: { category_id: items[0].category_id, name_bg: "Супа топчета", name_en: "Meatball soup", desc_bg: "", desc_en: "", price_eur: 4.5, allergens: [1, 3], is_special: true, special_expires_at: "closing_today" } }] });
await handleDecision({ store, messenger, now: () => now }, 1, "apply", sp.change_set_id);
assert((await store.getSite(venue.id)).items.some((i) => i.is_special && i.name_bg === "Супа топчета"), "special on the menu until closing");

console.log("\n4. „Затворени сме на 24 и 25 декември“ (scheduled)");
const sc = await call("schedule_changes", { summary_bg: "Коледни почивни дни", summary_en: "Christmas closure", apply_at: "2026-12-20T08:00:00+02:00", changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }, { op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] });
await handleDecision({ store, messenger, now: () => now }, 1, "apply", sc.change_set_id);
assert((await store.getChangeSet(sc.change_set_id)).status === "scheduled", "approved → scheduled");

console.log("\n5. „Върни цената на капучиното“");
const u = await call("undo", { change_set_id: p.change_set_id });
await handleDecision({ store, messenger, now: () => now }, 1, "apply", u.change_set_id);
assert((await price(cap.id)) === 2.9 && (await store.getChangeSet(p.change_set_id)).status === "reverted", "undo reverts and marks the original");

console.log("\n6. Bulk: „Вдигни всички кафета с 10%“");
const coffee = (await store.getSite(venue.id)).categories[0];
const b = await call("propose_bulk_price_change", { category_id: coffee.id, percent: 10, rounding: "0.10" });
assert(Array.isArray(b.rows) && b.rows.length === 4, "table preview with 4 rows");
const dash = await adminAction({ store, messenger, now: () => now, baseUrl: "http://x" }, venue, "apply", b.change_set_id);
assert(dash.ok && (await price(cap.id)) === 3.2, "dashboard approval applies the bulk change");

console.log("\n7. Next morning: the tick writes the auto set and applies the scheduled set at its time");
now = new Date("2026-10-10T06:30:00.000Z");
const t1 = await runTick({ store, messenger, now });
assert(t1.auto.length === 2, "banitsa back in stock + special expired, logged as auto sets");
now = new Date("2026-12-20T06:30:00.000Z");
const t2 = await runTick({ store, messenger, now });
assert(t2.applied.includes(sc.change_set_id) && (await store.getSite(venue.id)).holidays.length === 2, "scheduled holidays applied on time");

const o = await adminOverview(store, venue, now, "http://x");
console.log(`\nlog: ${o.log.map((s) => `${s.status}:${s.summary_en}`).join(" | ")}`);
console.log("\nOFFLINE E2E OK");
```

- [ ] **Step 4: `scripts/smoke.mts`** (live; needs keys) — loads deps (Supabase), finds the demo venue and its first owner member (`store.listChangeSets` is not needed; add `listMembers(venueId)` to `Store` if required, or require `--chat <id>`), prints which model/effort it will use, then runs `runTurn` with `--text` (default "Капучиното става 3,20") and the `TelegramMessenger` (so the preview really arrives on the phone) or a console messenger with `--dry`. Exits 0 when the turn returns anything but "error".

- [ ] **Step 5: README** — replace the scaffold README with these sections, in this order; write them for a reader who has never seen the repo: 
  1. **Site Manager** one-paragraph pitch (what it is, what the owner does, what the AI does), the price line (25 €/venue/month) and the evidence line (four venues, 20–70 €, named), link to the design spec.
  2. **Demo** (2 minutes): the eight steps from the spec, as a table "You say / What happens".
  3. **How it works**: change sets, approval policy, read-time effectiveness and the tick, bilingual content, allergens, multi-venue; the architecture block from the spec.
  4. **Run locally**: `npm install`, `.env.local` from `.env.example` (table of every key: name, where to get it, required?), `npm run env:set`, offline mode (`npm run dev:offline` and `npm run e2e`), real mode (`npm run db:apply`, `npm run check:rls`, `npm run venue:create -- --name … --slug agala --lang bg --seed demo`, `npm run dev` + `npm run bot:dev`, `/start <code>` on the phone).
  4b. **Landing page (Lovable)**: the public landing is built in Lovable from `docs/lovable/LANDING-PROMPT.md` (hackathon requirement); after publishing, set `NEXT_PUBLIC_LANDING_URL` so `/` redirects there; the Next.js `/` is the fallback.
  5. **Deploy to Vercel** step by step: `vercel login`, `vercel link`, `vercel env add` for each key (or the dashboard), set `CRON_SECRET` equal to `TICK_SECRET`, `vercel --prod`, set `PUBLIC_BASE_URL` to the deployment URL and redeploy, `npm run telegram:set-webhook -- https://<deployment>`, check `curl -H "x-tick-secret: …" https://<deployment>/api/tick`, note Hobby cron is daily (`vercel.json`) and Pro can use `*/5 * * * *` or `supabase/cron.sql`.
  6. **Demo-day checklist**: webhook set (or bot:dev running, never both), `npm run demo:reset`, phone on Telegram with the bot open, projector on `/agala`, admin page in a second tab, backup: typed messages if voice fails, `/undo`.
  7. **Security notes**: what the anon key can read, where the service key lives, admin link = key, webhook secret, no file-URL logging.
  8. **Known gaps** (from the spec) and **what is verified** (tests, build, offline e2e) vs **not verified** (fill in at the end).

- [ ] **Step 6: Final checks** (run all; paste outputs in the commit body)

```bash
npm test
npx tsc --noEmit
npm run lint
npm run e2e
npx next build
grep -rl "SUPABASE_SERVICE_ROLE\|service_role" .next/static && echo "LEAK" || echo "no service key in client bundle"
grep -rl "TELEGRAM_BOT_TOKEN\|api.telegram.org/file" .next/static && echo "LEAK" || echo "no bot token in client bundle"
grep -rn "src/config" app src/i18n src/lib/supabase-browser.ts app/[slug]/components app/admin/[slug]/components | grep -v "^app/api" && echo "config imported from a client path" || echo "config only on the server"
```

Then the live steps, each only if its keys are present (otherwise print "skipped: <key> missing" in the report):
- `npm run db:apply`, `npm run check:rls`
- `npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg --seed demo` (if the slug exists already, `npm run demo:reset` instead) → keep the printed codes for the report (the invite codes and admin link are secrets of the demo venue; put them in the final message to the user, not in git)
- `npm run smoke -- --dry` (real Anthropic call, console messenger)
- `npm run dev` + browser pane on `/agala` and the admin link: screenshot both.

- [ ] **Step 7: Commit**

```bash
git add scripts README.md src package.json
git commit -m "Scripts: venue create/reset, offline e2e, smoke; README with pitch, deploy guide and checklist

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push
```

---

## Deviations from the spec (decided while planning; see the final report)

- No SQL RPCs: the dashboard and the public site read through server route handlers backed by `Store`, so the whole web layer runs offline with the memory store (`SITE_MANAGER_STORE=memory`). The anon key is used only for realtime "refetch now" triggers and plain reads.
- Dashboard "apply" applies immediately (the owner's key is the authority) instead of waiting for the tick.
- `change_sets.undoes_id` added so an undo set knows its target; `conversations.correction_for` added for the ✏️ button.
- `seed.sql` dropped: the demo menu lives once, in `src/seed/demo.ts`, used by `venue:create --seed demo`, `demo:reset`, the memory mode and the tests.
- `/menu` in the bot sends the public link, the menu link and the dashboard link (where the QR lives) instead of a QR image.
- Speech-to-text is any OpenAI-compatible endpoint (`STT_*` keys, Groq by default), per the updated spec.
- Draft preview on the public pages (`?draft=&key=`) added at the user's request.
- The marketing landing is built in Lovable (hackathon requirement, user's decision 2026-10-10) from a prompt pack; the Next.js `/` is a fallback that redirects when `NEXT_PUBLIC_LANDING_URL` is set.
- TypeScript stays at 5.9 (create-next-app's pin) rather than 7.0.2; Tailwind uses `@tailwindcss/turbopack` (the create-next-app 16.4 default) instead of PostCSS.
