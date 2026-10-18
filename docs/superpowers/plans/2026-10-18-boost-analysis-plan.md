# Boost: plan from the analysis, every field changeable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claudia analyses the business before proposing an ad. Every field of the plan is prefilled from that analysis, and the owner can change any field with ✏️ or by text.

**Architecture:** This plan builds on branch build/boost-proposals (PR #21, head a9cfc62).
- `planBoost` (src/boost/plan.ts) derives radius, age and gender suggestions, and weekdays from the analysis inputs it already gets (OpenStreetMap places, Instagram follower profile, opening hours). Then it applies the owner's choices (`BoostOwnerChoices`) on top.
- The `propose_boost` tool accepts every field. On a ✏️ re-run it carries over the choices made earlier. The preview shows each field and says that anything can be changed. The progress label says Claudia is analysing.

**Tech Stack:** TypeScript, zod (tool schema), vitest. No new dependencies and no migration: the plan lives in the jsonb `after` of a `boost_plan` row.

**Spec:** The owner's words, 18 Oct 2026: "he should be able to change everything but we should make an analytic and propose a plan based on that analytic with some prefilled results and tell him analyzing the best plan for ad". Supporting material:
- the research note: InstaPay/Hackaton docs/research/2026-10-18-cafe-boost-audiences.md
- the first plan: docs/superpowers/plans/2026-10-18-boost-proposals.md

## Global Constraints

- No invented numbers. A number in a reason comes from OpenStreetMap, Meta or the business's own data. Analysis-derived choices are labelled `hypothesis`, and inputs that can't be read are `missing`.
- Age range and gender are **suggestions to Meta**. The preview says so ("предложение към Meta" / "suggested to Meta"). Only the minimum age is a hard limit.
- ✅ still only saves the plan. There are no Meta ads API calls and nothing is spent.
- Owner ranges:
  - radius 1–50 km (steps of 0.5)
  - age_min 18–65
  - age_max from age_min to 65, or none (65+)
  - budget 5–200 €
  - days 1–14
  - schedule: at least one weekday, from < to, in HH:MM format
- Claudia is for small businesses, not only cafés. New owner-facing copy names the business with `keep(venue.name)` instead of "кафенето" / "the café".
- src/domain must not import geo, social or boost. `BoostPlanData` in src/domain/types.ts restates the new fields.
- The owner's free words (`audience`, `place`) are kept as written (`keep()`) and never translated.

## Review Focus

1. **A ✏️ change of one field keeps every earlier owner choice.** Example: "5 км", then "30 €" gives 5 km and 30 €.
2. **"Claudia decides again"** (`reset`) brings back the analysis value for exactly the named fields.
3. **No Instagram data** (not connected, under 100 followers) gives no age or gender suggestion. The line is `missing`, never a guessed range.
4. **A business closed on some days** gets ads only on its open days. Hours that are unknown or 7/7 give no weekday limit.
5. **A different place** ("около НДК") that OpenStreetMap can't find gives a tool error asking for an address. The plan is never silently centred on the business.

---

### Task 1: The plan comes from the analysis; owner choices on top (pure)

**Files:**
- Modify: `src/boost/plan.ts`
- Modify: `src/domain/types.ts` (`BoostPlanData`; add `BoostOwnerChoices`)
- Modify: `src/agent/boost-tools.ts`, only the `planBoost` call. Map the existing `budget_eur` / `days` / `variant` inputs into `owner`, so the build stays green.
- Test: `test/boost-plan.test.ts`

**Interfaces:**
- Produces, in src/domain/types.ts:
  ```ts
  export interface BoostOwnerChoices {
    radiusKm?: number; place?: string; ageMin?: number; ageMax?: number | null; gender?: "all" | "women" | "men";
    audience?: string; schedule?: { days: Weekday[]; from: string; to: string } | null; budgetEur?: number; days?: number;
    goal?: "reach" | "profile_visits" | "website_visits"; placements?: "automatic" | "instagram" | "facebook"; variant?: "default" | "morning" | "weekend";
  }
  ```
  `BoostPlanData` gains the following fields. `ageMin` becomes `number`, and the `goal` and `placements` unions widen as above:
  - `ageMax: number | null` (suggestion)
  - `gender: "all" | "women" | "men"` (suggestion)
  - `audience: string | null`
  - `place: string | null`
  - `owner: BoostOwnerChoices` (what the owner set; drives the ✏️ carry-over and the "ваш избор" marks)
- Produces, in src/boost/plan.ts:
  - `BoostInput` loses `budgetEur` / `days` / `variant` and gains `owner: BoostOwnerChoices`.
  - `planBoost(input): BoostPlan | { error: "budget_range" | "days_range" | "radius_range" | "age_range" | "schedule" }`.
  - `BoostPlan` mirrors `BoostPlanData`.

**Analysis rules.** These apply when the owner hasn't set the field.

- **Area density** = the sum over all kinds of `summarise(places).counts[k].km1`.

  | Density | Radius | Hypothesis reason (bg / en) |
  |---|---|---|
  | ≥ 10 | 2 km | "гъст район — 2 км стигат" / "a busy area — 2 km is enough" |
  | 3–9 | 3 km | "смесен район — 3 км" / "a mixed area — 3 km" |
  | 0–2 (status ok) | 5 km | "малко обекти наоколо — по-широк радиус, 5 км" / "few places around — a wider radius, 5 km" |
  | surroundings missing | 3 km | no extra reason; the missing line already exists |

- **Variants scale the base radius:** morning = base × 0.75 and weekend = base × 1.5, each rounded to the nearest 0.5 km. For a busy area that gives 1.5 and 3, the same as today.
- **Age suggestion:**
  - Bands are Meta's age keys from `followers.age`, excluding "13-17", in Meta's order.
  - Pick the shortest contiguous run of bands whose shares sum to ≥ 0.6 of the total share of those bands. On a tie, pick the run with the higher sum.
  - `ageMin` is the run's lower bound, but at least 18.
  - `ageMax` is the upper bound, or null for "65+".
  - When there is no follower profile, no age data, or the run covers every band: `ageMin` 18, `ageMax` null.
  - The reason is a hypothesis: "най-много от последователите са 25–44 → предлагам 25–44 на Meta" / "most followers are 25–44 → suggesting 25–44 to Meta".
- **Gender suggestion:** "women" when F ≥ 0.75 of (F+M+U), "men" when M ≥ 0.75, else "all". Only a non-"all" result adds a hypothesis reason.
- **Weekdays (no variant, no owner schedule):**
  - The days with `hours[d].open !== ""`, when that is 1–6 days. The value is `{ days, from: "00:00", to: "23:59" }`.
  - Otherwise null.
  - The reason is a hypothesis: "в дните, в които сте отворени" / "on the days you're open".
- **Budget and days:** 20 € and 5 days, as today. Add a hypothesis reason: "20 € за 5 дни е малък тест — достатъчен Meta да научи кой реагира" / "20 € over 5 days is a small test — enough for Meta to learn who responds".
- **Owner choices replace the analysis value for their field** and add no hypothesis reason for that field.
  - An owner `variant` keeps the old behaviour: morning is cut to the open hours, weekend is Fri–Sun.
  - An owner `schedule` beats a variant.
  - Validate the ranges from Global Constraints and return the matching error.

- [ ] **Step 1: Write the failing tests** in test/boost-plan.test.ts:
  - `density ≥ 10 → 2 km; 3–9 → 3 km; 0–2 → 5 km; missing → 3 km`
  - `morning/weekend scale the base: busy area 1.5 / 3, sparse area 4 / 7.5`
  - `age run: {18-24:.1,25-34:.4,35-44:.3,45-54:.1,55-64:.05,65+:.05} → 25–44`, and a profile with every band equal → 18 / null
  - `no followers → ageMin 18, ageMax null, gender all, and no age or gender hypothesis`
  - `F .8 → women; F .6 → all`
  - `closed on Sunday → schedule mon–sat 00:00–23:59; open 7 days → null; hours unknown → null`
  - `owner choices win and are stored in plan.owner`, for example `{ radiusKm: 5, gender: "all", budgetEur: 30 }`
  - range errors: radius 0.5 and 51 → `radius_range`; ageMin 17 or ageMax < ageMin → `age_range`; empty days or from ≥ to → `schedule`
  - the existing exact-text tests are updated to the new reasons
- [ ] **Step 2:** Run `npx vitest run test/boost-plan.test.ts`. Expect the new tests to FAIL.
- [ ] **Step 3: Implement** in plan.ts and types.ts. In boost-tools.ts, pass `owner: { budgetEur: input.budget_eur, days: input.days, variant: input.variant }` with undefined fields dropped. Map the new errors in `rangeCheck` to one-sentence tool errors that name the allowed range.
- [ ] **Step 4:** Run `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Expect all to PASS.
- [ ] **Step 5: Commit:** `Boost: the plan comes from the analysis (area, followers, open days); owner choices on top`

### Task 2: The owner can change everything; the preview shows the analysis

**Files:**
- Modify: `src/agent/tool-schemas.ts` (`BoostSchema`)
- Modify: `src/agent/boost-tools.ts`
- Modify: `src/domain/boost-preview.ts`
- Modify: `src/agent/prompt.ts` (rule 17)
- Modify: `src/bot/progress.ts`
- Modify: `src/domain/types.ts` (`BoostPlanRow.place_label`)
- Test: `test/agent-boost-tool.test.ts`, `test/prompt.test.ts`, and the boost preview tests

**Interfaces:**
- Consumes `BoostOwnerChoices` and `planBoost` from Task 1.
- `BoostSchema` gains these optional fields, each described as "only when the owner says it":
  - `radius_km`: number
  - `place`: string, 1–120 characters ("around another place, e.g. НДК")
  - `age_min`: int
  - `age_max`: int, nullable (null = 65+)
  - `gender`: enum all / women / men
  - `audience`: string, 1–200 characters (the owner's words about who the customers are)
  - `weekdays`: array of mon…sun
  - `from` and `to`: HH:MM strings
  - `goal`: enum reach / profile_visits / website_visits
  - `placements`: enum automatic / instagram / facebook
  - `reset`: array of enum radius / place / age / gender / audience / schedule / budget / days / goal / placements (fields where the owner says "ти реши" ("you decide") and Claudia's analysis decides again)
- `BoostPlanRow` gains `place_label: string`: the business name, or the owner's place.

**Behaviour:**

- **Choices from the input:**
  - `weekdays` / `from` / `to` together make `schedule`. When only some are given, take the missing ones from the carried-over schedule, else from mon–sun 00:00–23:59.
  - `age_min` / `age_max` map to `ageMin` / `ageMax`.
- **✏️ carry-over:** on a ✏️ re-run (`d.correctionFor` names a boost_plan set of this venue), start from that row's `plan.owner`. Then drop the `reset` fields, then apply the new input on top. The post carry-over already exists; keep it.
- **`place`:**
  - Geocode it with `geocode()` (src/geo/osm.ts). When it isn't found, return the tool error: `I couldn't find "<place>" on the map; ask the owner for a street address near it.` Nothing is proposed.
  - When found, the row's `lat` / `lng` are that pin, and `place_label` is the owner's place text.
  - The area analysis stays the business's own, and adds a hypothesis reason: "районът е анализиран около <name>, рекламата е около <place>" / "the area was analysed around <name>, the ad is around <place>".
- **`goal` checks:**
  - `website_visits` needs the business to have a website (`site_url` or the published site URL the tool deps already know; use what exists). Without one, return the tool error: "This business has no website yet; offer reach or profile visits."
  - `placements: "facebook"` needs `d.social?.facebook === true`. Without it, return the tool error: "No Facebook Page is connected; offer Instagram or automatic."
- **Preview** (`boostPreviewLines`), in this order:
  1. `📣 Реклама: <caption>` / `📣 Ad: <caption>`
  2. `Къде: до 2 км от <place_label>` / `Where: within 2 km of <place_label>`
  3. `Кой: 18+ · предложение към Meta: 25–44 г., жени · клиенти: <audience>`. The second and third parts appear only when they apply. EN: `Who: 18+ · suggested to Meta: 25–44, women · customers: <audience>`.
  4. `Кога: …` (as today)
  5. `Бюджет: 20 € общо · Цел: <goal> · Показва се: <placements>`. Goal labels: reach = "хора наблизо" / "people nearby"; profile_visits = "посещения на профила" / "profile visits"; website_visits = "посещения на сайта" / "website visits". Placement labels: automatic = "автоматично (Instagram + Facebook)" / "automatic (Instagram + Facebook)"; instagram = "само Instagram" / "Instagram only"; facebook = "само Facebook" / "Facebook only".
  6. The `Обхват:` sentence moves to its own line.
  7. A value the owner chose is followed by ` ✎`.
  8. `Защо:` and the reasons (as today).
  9. `✏️ Всичко може да се промени: радиус, място, възраст, пол, клиенти, дни и часове, бюджет, цел, къде се показва.` / `✏️ You can change anything: radius, place, age, gender, customers, days and hours, budget, goal, where it shows.`
  10. The "only saves the plan" line (as today).

  Old rows without the new fields must still render: default `place_label` to "", which shows "до 2 км" with no place.
- **Progress label** for propose_boost: `🔎 Анализирам района, последователите и постовете за най-добрия план…` / `🔎 Analysing your area, followers and posts for the best ad plan…`.
- **Rule 17:**
  - Claudia's plan comes from her analysis. Pass a field only when the owner says it.
  - On a change, pass only the changed fields; earlier choices are kept.
  - Use `reset` when the owner wants Claudia to decide again.
  - Keep the existing variant words, the "never social_post for an ad" rule, and the "never state reach/cost" rule.
  - Update the tool description to match.

- [ ] **Step 1: Write the failing tests:**
  - the carry-over: "5 км" then "30 €" gives a plan with 5 km and 30 €, with `owner` holding both
  - `reset: ["radius"]` brings back the analysis radius
  - a place that isn't found gives the tool error, with no change set and no message
  - a found place: the row's lat/lng are its pin, and the preview shows "около"/place text
  - `website_visits` without a site → error; `placements: facebook` without a Page → error
  - the exact BG preview lines for a plan with an owner choice (✎) and suggestions; an EN regex test
  - an old row without the new fields renders
  - the progress label
  - rule 17 mentions `reset` and "only the changed fields"
- [ ] **Step 2:** Run them. Expect them to FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest run`, `npx tsc --noEmit` and `npm run lint`. Expect all to PASS.
- [ ] **Step 5: Commit:** `Boost: the owner can change every field; preview shows the analysis and says so; analysing label`
