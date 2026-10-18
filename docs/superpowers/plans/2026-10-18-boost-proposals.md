# Boost Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the owner says "пусни поста с реклама" ("boost this post"), Claudia studies who is around the café and who follows it, and proposes an ad: which post, where, who, when and how much, with her reasons. The owner approves with ✅.

- **Phase 1 (this plan):** the analysis and the proposal. On ✅ the plan is saved, and Claudia says plainly that it launches once ads are connected.
- **Phase 2 (after Meta business verification and App Review):** launching the ad, reporting results and stopping it. Phase 2 is outlined at the end and is not built now.

**Architecture:**

| Part | What it does | Where |
|---|---|---|
| Venue location | the café's address, geocoded once with OpenStreetMap Nominatim, then cached | new table `venue_surroundings` |
| What's nearby | universities, offices and government, parks, sights, theatres within 2 km, from the OpenStreetMap Overpass API, summarised and cached for 30 days | same table |
| Who follows | Instagram follower age, gender and city, plus recent posts' reach, saves, shares and views, through the insights permission the Instagram connect already requests | read live |
| Recommendation | a pure function: surroundings + hours + insights + the owner's words → a `BoostPlan` with every reason tagged fact, hypothesis or missing | `src/domain/boost.ts` |
| Proposal | a new agent tool `propose_boost` and change-set op `boost_plan`, through the usual ✅ / ✏️ / ❌ flow, with the post's picture shown first | agent tools |

**Tech Stack:** TypeScript, vitest, Next.js on Vercel, Supabase, Anthropic SDK agent tools, Graph API (`graph.instagram.com`), OpenStreetMap Nominatim and Overpass.

**Spec:**
- The owner's requests on 18 Oct 2026:
  - "prepare for us to have ad campaigns, be able to boost posts from Claudia"
  - "Claudia analyzes your perfect audience and proposes an ad"
  - "make a plan and after that build it"
  - "no student offer for now"
- The research note `docs/research/2026-10-18-cafe-boost-audiences.md` in the hackathon repo (copied in this branch as `docs/research/2026-10-18-cafe-boost-audiences.md`).
- Rules from the `ads` marketing skill:
  - target broad and let the creative carry audience knowledge;
  - label unavailable inputs MISSING, never estimate them;
  - draft first and act only on explicit approval;
  - no fixed kill rules.

## Global Constraints

- **No invented numbers.**
  - Reach, cost per view and follower shares appear only when they come from Meta's API or measured results.
  - Without Meta's data the proposal says "обхват: ще го видите, щом рекламите са свързани" ("reach: you'll see it once ads are connected"). It never shows a made-up range.
  - Every reason line carries `kind: "fact" | "hypothesis" | "missing"`, and only facts are stated as facts.
- **Defaults** (from the research note):

  | Setting | Default |
  |---|---|
  | Radius | pin on the café, 2 km |
  | Location expansion | off |
  | Age | minimum 18; no maximum, no gender, no interests |
  | Placements | automatic (Instagram + Facebook; Reels when the post is a video) |
  | Goal | `reach` (awareness); `profile_visits` when the café has no Facebook Page connected |
  | Budget | 20 € total over 5 days |
  | Schedule | all day |

- **Variants**, picked only when the post or the owner's words call for them. No student variant.

  | Variant | When | Settings |
  |---|---|---|
  | `morning` | morning or office offers ("до 11", "сутрин", "закуска") | 1.5 km, Monday–Friday 07:30–11:00 |
  | `weekend` | brunch, events, live music, or "уикенд/събота/неделя" | 3 km, Friday–Sunday |

- **Owner limits:** the budget per ad is clamped to 5–200 € and the duration to 1–14 days. Anything outside is refused with the allowed range.
- **Approval:** ✅ only saves the plan in Phase 1. Nothing is spent, and the proposal says so in one line. A `boost_plan` set never counts toward the monthly change limit.
- **Owner role only.** Copy is bg/en and goes through the existing translation wrapper. The post caption and the café name are kept.
- **OpenStreetMap usage:**
  - Nominatim: at most one call per venue unless the address changes, with a `User-Agent: Claudia (getclaudia.app)` header.
  - Overpass: one query per venue per 30 days, 8 s timeout.
  - A failure makes surroundings `missing`; it never fails the tool.
- **Insights:**
  - Follower demographics need at least 100 followers and the insights permission.
  - Any error or missing permission makes that input `missing`.
  - Log error codes only, never data.

## Review Focus

1. **A café with no Instagram connected, or under 100 followers:** the proposal still works from surroundings and hours, shows the follower lines as missing, and invents nothing (Task 4).
2. **OpenStreetMap down or slow:** `propose_boost` still proposes with the defaults, and the surroundings line reads "не успях да проверя района" ("couldn't check the area") (Tasks 1 and 4).
3. **An owner saying "100 € за 30 дни":** the duration is refused with the 1–14 day range. 30 € for 3 days is accepted (Task 3).
4. **Approving a plan:** nothing is spent, the change limit is not used, and undo works (Task 4).
5. **A venue whose address cannot be geocoded:** surroundings `missing`, and the radius stays 2 km around nothing. The proposal says the location needs checking (Tasks 1 and 4).

---

### Task 1: Venue location and surroundings (OpenStreetMap)

**Files:**
- Create: `supabase/migrations/2026-10-18-venue-surroundings.sql` (+ `schema.sql`, `policies.sql`), `src/geo/osm.ts`, `src/geo/surroundings.ts`
- Modify: `src/store/types.ts`, `memory.ts`, `supabase.ts` (`getSurroundings(venueId)`, `putSurroundings(row)`), `test/store-contract.ts`
- Test: `test/geo-surroundings.test.ts`

**Interfaces:**
- Table `venue_surroundings`:
  - columns: `venue_id uuid pk references venues on delete cascade`, `address text not null`, `lat double precision`, `lng double precision`, `places jsonb not null default '[]'`, `fetched_at timestamptz not null`
  - access: server-only (RLS on, no policies)
- `geocode(address: string, fetch): Promise<{ lat: number; lng: number } | null>` uses Nominatim with `countrycodes=bg`, `limit=1`, the `User-Agent` and a 6 s timeout.
- `nearbyPlaces(lat, lng, fetch): Promise<Place[] | null>`
  - One Overpass query within 2000 m for: `amenity=university|college`, `office=government`, `amenity=townhall`, `building=office`, `leisure=park`, `tourism=attraction|museum`, `amenity=theatre|cinema`, `historic=*` (named only).
  - 8 s timeout.
  - `Place = { kind: "university" | "government" | "office" | "park" | "sight" | "culture"; name: string | null; meters: number }` (straight-line distance).
- `loadSurroundings(d, venue, now): Promise<Surroundings>`
  - Uses the cache when the address is unchanged and the data is under 30 days old.
  - Otherwise geocodes (only if the address changed) and queries Overpass, then saves.
  - Returns `{ status: "ok" | "missing"; reason?: "no_address" | "geocode_failed" | "osm_unavailable"; places: Place[] }`.
  - Never throws.
- `summarise(places): SurroundingsSummary`:
  - Counts per kind within 500 m, 1 km and 2 km, and the 2 nearest named places per kind.
  - Pure, so it is easy to test.

- [ ] **Step 1: Failing tests**
  - `summarise` counts and orders places correctly.
  - `loadSurroundings`:
    - uses the cache and makes no fetch under 30 days with the same address;
    - refreshes after 30 days, or after an address change (geocodes again);
    - when the geocoder returns null: `missing`/`geocode_failed`, nothing saved;
    - on an Overpass timeout: `missing`/`osm_unavailable`, no throw;
    - sends the User-Agent header.
  - Store contract: `getSurroundings`/`putSurroundings` round-trip.
- [ ] **Step 2: Run** `npx vitest run test/geo-surroundings.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Use the fetch-injection pattern of `src/visual/client.ts`. Write the migration so it can safely run twice.
- [ ] **Step 4: Run** the full suite, tsc and lint. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Boost: the café's surroundings from OpenStreetMap, cached 30 days"`

---

### Task 2: Instagram audience and post performance

**Files:**
- Create: `src/social/insights-graph.ts`
- Test: `test/social-insights.test.ts`

**Interfaces:**
- `followerProfile(client, igUserId): Promise<FollowerProfile | null>`
  - Calls `GET /{ig-user-id}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age` (then `gender`, then `city`).
  - Returns `{ followers: number; age: Record<string, number>; gender: Record<string, number>; cities: { name: string; share: number }[] }`, shares 0..1, top 3 cities.
  - Returns null on any error or empty data, for example under 100 followers or a missing permission.
- `recentPostStats(client, igUserId, sinceIso): Promise<PostStat[]>`
  - Calls `GET /{ig-user-id}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink` for the last 30 days, at most 25 posts.
  - For each post, calls `GET /{media-id}/insights?metric=reach,saved,shares,views`.
  - `PostStat = { id; caption; type: "image" | "video" | "carousel"; at; permalink; reach?; saved?; shares?; views? }`.
  - A metric the API refuses is left undefined. Each post has a 4 s cap; the whole call has a 12 s cap.
- `bestPost(stats, now): PostStat | null`
  - Considers posts 1–14 days old.
  - Scores each as `(saved + shares) / reach`, with a minimum reach of 50.
  - Returns the best post, or null when no post has enough data.

- [ ] **Step 1: Failing tests** with a fake `GraphClient`:
  - demographics parsing (age, gender, top 3 cities);
  - null on error, on empty data and on a missing permission;
  - post stats with one metric refused;
  - `bestPost` picks the highest save+share rate with reach ≥ 50, ignores posts newer than 1 day, and returns null without data.
- [ ] **Step 2: Run** `npx vitest run test/social-insights.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** with `GraphClient` from `src/social/meta-graph.ts`, following `comments-graph.ts`. Log codes only.
- [ ] **Step 4: Run** the full suite, tsc and lint. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Boost: Instagram follower profile and recent post performance"`

---

### Task 3: The recommendation (pure)

**Files:**
- Create: `src/domain/boost.ts`
- Test: `test/domain-boost.test.ts`

**Interfaces:**
- `type BoostVariant = "default" | "morning" | "weekend"`
- `interface BoostInput { venue: Pick<Venue, "name" | "hours" | "tz">; surroundings: Surroundings; followers: FollowerProfile | null; post: { id: string; caption: string; type: "image" | "video" | "carousel"; stat?: PostStat } | null; ownerWords: string; budgetEur?: number; days?: number; variant?: BoostVariant; hasFacebookPage: boolean }`
- `interface BoostPlan { variant; radiusKm: number; ageMin: 18; schedule: null | { days: Weekday[]; from: "HH:MM"; to: "HH:MM" }; budgetEur: number; days: number; placements: "automatic"; goal: "reach" | "profile_visits"; reasons: { kind: "fact" | "hypothesis" | "missing"; bg: string; en: string }[] }`
- `planBoost(input: BoostInput): BoostPlan | { error: "budget_range" | "days_range" }`:
  - Applies the Global Constraints defaults, variants and limits.
  - The variant comes from `input.variant`, else from keywords in the owner's words or caption:

    | Variant | Keywords |
    |---|---|
    | morning | "сутрин", "закуска", "до 11", "morning", "breakfast" |
    | weekend | "уикенд", "събота", "неделя", "бранч", "концерт", "weekend", "brunch", "event", "live" |

  - A `morning` schedule is clipped to the café's opening hours on those days. If the café is closed on all those days, use the default variant.
  - Reasons, in this order:
    1. **Surroundings (fact):** "в радиус 1 км: Софийски университет (400 м), 3 държавни институции, 2 парка", or missing ("не успях да проверя района").
    2. **Followers (fact):** "62% от последователите са жени, най-много 25–34 г., 71% от София", or missing ("демографията на последователите ще се вижда при 100+ последователи и свързан Instagram").
    3. **Post (fact):** "този пост има 3× повече запазвания от средното", when there is a stat.
    4. **Hypothesis:** "по-широката аудитория обикновено е по-евтина; Meta сама намира кой да види рекламата в радиуса".
    5. **Variant (hypothesis):** "сутрешна оферта → делнични сутрини" (only when chosen).

- [ ] **Step 1: Failing tests**
  - Defaults: 2 km, 18+, 20 €, 5 days, automatic, reach.
  - Goal is `profile_visits` without a Facebook Page.
  - Morning: via keywords, clipped to hours; falls back to default when the café is closed those days.
  - Weekend: via keywords.
  - There is no student variant: "студенти" in the owner's words leaves the default.
  - Budget 4 € → error; 201 € → error; days 15 → error; 30 € and 3 days → accepted.
  - Missing reasons when followers are null or surroundings are missing.
  - No reason line contains a reach or price number unless a stat is given.
- [ ] **Step 2: Run** `npx vitest run test/domain-boost.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Pure function, no IO.
- [ ] **Step 4: Run** the full suite, tsc and lint. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Boost: the recommendation, with every reason marked fact, hypothesis or missing"`

---

### Task 4: `propose_boost`, the `boost_plan` change and its preview

**Files:**
- Create: `src/agent/boost-tools.ts`
- Modify:
  - `src/agent/tools.ts` (register for the owner role)
  - `src/agent/tool-schemas.ts`
  - `src/domain/types.ts` (op `boost_plan`)
  - `src/domain/changes.ts` (apply: store the plan only)
  - `src/domain/preview.ts` (preview lines)
  - `src/domain/limits.ts` (`boost_plan` never counts)
  - `src/agent/prompt.ts` (new numbered rule)
- Test: `test/agent-boost-tool.test.ts`, `test/preview.test.ts`, `test/prompt.test.ts`

**Interfaces:**
- Tool `propose_boost { media_id?: string; post_ref?: string; budget_eur?: number; days?: number; variant?: "default" | "morning" | "weekend" }`, owner only.
  - **Which post:**
    1. the given photo or post;
    2. else the owner's most recent `social_post` in this conversation;
    3. else `bestPost` from Task 2;
    4. else the error "Which post should I boost? Send it or name it."
  - **How it proposes:**
    - Loads surroundings (Task 1), followers and post stats (Task 2, when Instagram is connected), then `planBoost` (Task 3).
    - Sends the post's picture with the caption "Пост за реклама" / "Post to boost".
    - Creates a change set with one `boost_plan` row whose `after` is the plan, the post ref and the permalink.
    - Calls `sendProposal`.
- **Preview** (bg/en; non-bg/en owners get it through the wrapper):

  > 📣 Реклама: ⟦caption, first 60 characters⟧
  > Къде: до 2 км от кафенето · Кой: 18+ · Кога: 5 дни, по цял ден
  > Бюджет: 20 € общо · Обхват: ще го видите, щом рекламите са свързани
  > Защо: • … (the reasons, facts first; missing reasons shown last with "—")
  > (Сега само записвам плана — ще може да се пусне, щом Meta одобри рекламите в Claudia.)

  English mirrors it: "📣 Ad: … Where: within 2 km of the café · Who: 18+ · When: 5 days, all day · Budget: 20 € total · Reach: you'll see it once ads are connected · Why: … (For now I only save the plan — it can run once Meta approves ads in Claudia.)"
- **Apply:**
  - Stores the plan as an applied change. There are no external calls.
  - It does not count toward the limit, the same as the comment-mode exemption pattern in `limits.ts`.
  - Undo removes it.
- **Prompt rule:** a boost/ad request ("пусни поста с реклама", "рекламирай", "boost", "ad") → `propose_boost`; never `social_post` for an ad; ✏️ changes re-run `propose_boost` with the owner's numbers.

- [ ] **Step 1: Failing tests**
  - The tool proposes with defaults for a given photo.
  - Post choice falls back from the last social_post to `bestPost` to the error.
  - Without Instagram, the plan uses missing follower reasons.
  - Surroundings missing → the "couldn't check the area" line.
  - The budget-range error passes through.
  - Staff are refused.
  - The preview text is exact in bg and en: no reach number, plus the save-only line.
  - Apply makes no external call and leaves the change limit unchanged; undo works.
  - The prompt rule text.
- [ ] **Step 2: Run** `npx vitest run test/agent-boost-tool.test.ts test/preview.test.ts test/prompt.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement**, following the patterns of `make_menu_photo` and `social_post` (picture first, then proposal).
- [ ] **Step 4: Run** the full suite, tsc and lint. Expect PASS.
- [ ] **Step 5: Commit** `git commit -m "Boost: propose_boost — Claudia proposes who, where, when and how much; ✅ saves the plan"`

---

## Phase 2 (after business verification and Meta App Review; not built in this plan)

1. **Connect the ad account:**
   - OAuth scopes `ads_management` and `ads_read`; the owner picks the ad account.
   - Spend caps per ad and per month are set by the owner (suggested 50 €/ad, 200 €/month) and enforced in code.
2. **Reach before ✅:** Meta's `delivery_estimate` for the planned targeting replaces "you'll see it once ads are connected".
3. **Launch on ✅** through the Marketing API:
   - **Campaign:** objective `OUTCOME_AWARENESS` (or `OUTCOME_ENGAGEMENT` for profile visits).
   - **Ad set:**
     - `custom_locations` radius around the café's lat/lng;
     - `age_min` 18;
     - Advantage+ audience;
     - location expansion off;
     - lifetime budget and end time;
     - `adset_schedule` for variants, which needs a lifetime budget.
   - **Ad:** uses the existing post (`object_story_id` / IG media).
   - The ad is created paused, then activated, so a failure never leaves a live ad behind.
4. **Results and control:**
   - A daily line in the digest ("1 840 души, 37 кликвания, 12,40 € изразходвани"), reporting facts, hypotheses and missing data.
   - "спри рекламата" pauses the ad.
   - No automatic kill rules.

## Self-review notes
- Spec coverage:
  - analysis covered by Tasks 1–3;
  - proposal and approval by Task 4;
  - launch deferred to Phase 2 by the approval constraint;
  - no student variant: Task 3 test.
- MISSING rule: Tasks 2–4 never estimate reach or price.
