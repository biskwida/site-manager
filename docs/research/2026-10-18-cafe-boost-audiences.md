# Who a café should target when Claudia boosts a post (Coffique, Sofia), 18 Oct 2026

Short analysis behind Claudia's default boost suggestion. Example café: Coffique, ул. „Кракра“ 24, Оборище/Център, Sofia.
Sources are linked at the end. Figures marked ≈ are estimates; anything unconfirmed is listed under "Open points".

## 1. Who is around the café

Straight-line distances from Кракра 24, measured on OpenStreetMap; walking distances are longer.

| Within | What | Likely visitors |
|---|---|---|
| 0.2–0.4 km | Doctors' Garden, National Library, National Academy of Art, **Sofia University**, Alexander Nevsky | students 18–24, lecturers, tourists |
| 0.6–1.2 km | Eagles' Bridge, Zaimov Park, National Theatre, **Parliament, Council of Ministers, Presidency**, Vasil Levski Stadium | office and government workers 25–44, theatre-goers |
| 1.4–2.2 km | Borisova gradina, Vitosha Blvd, NDK, Hilton | weekend walkers, tourists, wider centre |

**Takeaway:** almost all of Coffique's walk-in customers live, work or study within about 1.5 km. Paying to reach people 5–10 km away mostly buys views from people who won't come.

## 2. Who can be reached on Meta in Bulgaria

Bulgaria's population is 6.7 m (UN figure, quoted by DataReportal).

| Platform | Reach | Share of adults | Notes |
|---|---|---|---|
| Facebook | 3.60 m | 65% | reach falling, −2.7% a year |
| Instagram | 1.95 m | 35% | 53% female, reach growing +5.4% a year |

Facebook and Instagram accounts aged 18+, from Meta's ad tool:

| Age | Accounts |
|---|---|
| 18–24 | 514k |
| **25–34** | **940k** (the largest group under 45) |
| 35–44 | 793k |
| 45–54 | 728k |
| 55+ | 1.02 m |

- **Cost:** no Bulgaria-specific figure was found. Nearby markets suggest about **3–6 $ per 1,000 views**. So 20 € ≈ **3,500–7,000 views** (≈), fewer different people because of repeats.
- **Who goes to specialty cafés:** the clearest signal from European data is **25–34-year-olds**, who buy from cafés about 1.7× more often than average (UK). Young people aged 18–30 like artisanal drinks and comfortable places (Budapest study). Peak times elsewhere are **weekday mornings and late morning**. Treat this as a hypothesis for Sofia, not a measured fact.

## 3. What Meta allows today (2026)

- **Location:** a pin at the café plus a radius. Only "people living in **or recently in**" the area can be chosen. "Tourists only" or "residents only" were removed in 2023.
- **Turn off location expansion:** the "reach more people likely to respond" option pulls in people outside the area.
- **Age and gender:** in Meta's default automatic audience (Advantage+), only the **minimum age** is a hard rule. Maximum age, gender and interests are only **suggestions** to Meta.
- **Excluding interests** is no longer possible (since 2025).
- **Placements:** Instagram and Facebook feed, Stories, Reels and Explore are chosen automatically. A boosted Reel runs everywhere.
- **Scheduling by hour** is possible only with a total budget for the whole run, through the full ads API.
- **Minimum budget:** varies by currency and goal. Claudia asks Meta's API for the minimum instead of hard-coding it.

## 4. Claudia's default boost suggestion (for an owner who says only "пусни поста с реклама")

| Setting | Default | Why |
|---|---|---|
| Where | pin on the café, **2 km** radius, location expansion **off** | covers the university, the government and office cluster, the parks and the centre's sights; little wasted reach |
| Who | **18+**, no maximum age, any gender, no interests | Meta's automatic audience finds likely customers inside the radius better than manual guesses; extra limits are only suggestions anyway |
| Where shown | automatic (Instagram + Facebook, Reels if it's a video) | cheapest delivery |
| Goal | reach people nearby (awareness); "profile visits" for Instagram-first cafés | low budgets can't optimise for sales |
| Budget | **20 € for 5 days** (4 €/day), shown in the ✅ with the estimated views | small enough to try without thinking twice; enough for Meta to learn |
| When | all day (no hour schedule) | keeps it simple; hours only when the owner asks ("само сутрин") |

The owner can change any line with ✏️, e.g. "1 км", "само сутрин", "50 € за седмица".

### Ready-made variants Claudia can suggest by post type

(No student variant for now — owner, 18 Oct 2026.)

| Post | Suggested audience |
|---|---|
| New drink, dessert, seasonal item | default (2 km, 18+) |
| Morning or office special ("кафе + кроасан до 11") | 1.5 km, weekdays 7:30–11:00 (needs a total budget), age suggestion 25–44 |
| Weekend brunch, event, live music | 3 km, Friday to Sunday, 18+ |
| Reel or video | default; Reels usually get the cheapest views |

### Which posts to boost

- **Best:** posts that already did well without paying for 1–3 days, new items, events and limited offers.
- **Avoid:** plain menu photos with no news in them.

## 5. Open points (check live before building)

- The smallest radius Meta allows around a pin: sources disagree, about 1 km vs about 1.6 km.
- Whether a boost keeps strictly to the radius under the automatic audience. Sources conflict, so test it with a real boost.
- The minimum budget in EUR. Read it from the API (`minimum_budgets`).
- Real Bulgarian cost per 1,000 views. Measure it on the first Coffique boosts.
- Whether Meta's new 2–5% "location fee" (July 2026) applies to Bulgaria.

## Sources

- **Meta targeting:**
  - [Jon Loomer, Meta ads targeting 2026](https://www.jonloomer.com/meta-ads-targeting-2026/)
  - [Jon Loomer, location targeting change](https://www.jonloomer.com/big-change-to-meta-ads-location-targeting/)
  - [Jon Loomer, reach outside the location](https://www.jonloomer.com/meta-ads-reach-people-outside-of-the-targeted-location/)
  - [Big Eye Agency, geographic targeting 2026](https://www.bigeyeagency.com/insights/geographic-targeting-for-meta-ads-guide-2026)
  - [Meta: removal of detailed-targeting exclusions](https://developers.facebook.com/blog/post/2025/01/21/removal-of-detailed-targeting-exclusions/)
  - [Meta: pacing and scheduling](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/pacing-and-scheduling)
  - [Meta: minimum budgets](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/minimum_budgets.md)
  - [Hootsuite, boosting Reels](https://blog.hootsuite.com/boost-instagram-reels/)
- **Bulgaria:**
  - [DataReportal, Digital 2026 Bulgaria](https://datareportal.com/reports/digital-2026-bulgaria)
  - [Affect Group, Bulgaria Meta audience by age 2026](https://affectgroup.com/blog/bulgaria-meta-ads-audience-by-age-and-gender-2026/)
  - [citypopulation.de, Sofia](https://citypopulation.de/en/bulgaria/admin/22__sofija_stolica_)
- **Costs (proxies):**
  - [Adligator](https://adligator.com/blog/meta-ads-cpm-by-country-benchmarks)
  - [Adamigo](https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026)
- **Café customers:**
  - [Attest UK 2025](https://www.askattest.com/blog/research/hot-drink-behaviors-insights-us-uk-2025.md)
  - [Mintel Germany](https://store.mintel.com/report/germany-coffee-shops-market-report)
  - [Budapest study](https://borykereso.uni-bge.hu/Record/dolg60203/Description?lng=en)
  - [JLL Auckland peak times](https://www.jll.com/en-au/guides/exploring-auckland-cbds-cafe-culture-peak-times-and-trends)
- **Area:**
  - OpenStreetMap / Nominatim
  - [In Your Pocket, Krakra](https://www.inyourpocket.com/bulgaria/sofia/venues/krakra)
