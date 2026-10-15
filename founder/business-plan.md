# Site Manager · Business plan

**Verdict: Not yet**

- ✓ Each venue-month earns $27.00 before fixed costs (90% contribution).
- ✗ Year 1 operating LOSS: $8,484.
- ✗ 2 of 20 simulated buyers buy (10%, the bar is 25%).

| key number | |
| --- | ---: |
| Price | $30.00 a venue-month |
| Profit margin at plan | 28% per venue-month |
| Break-even | 42 venue-months a day |
| Year 1 operating profit | $-8,484 |
| Startup spend | $500 |
| Cash needed before it pays for itself | $8,984 |
| Startup money earned back | not in year 1 |
| Buyer panel | 2 buy · 18 pass |

## The idea

- What it is: a website for a café, bar or restaurant that the owner runs from a chat app (Telegram, WhatsApp, Messenger) by talking to an AI agent: "cappuccino is 3.20 now", "we're out of the lemon cake until tomorrow", a voice note, or a photo of the specials board. The agent prepares the change, shows a preview, and it goes live after one tap. It also supports scheduled changes, auto-revert, a change log and undo, in Bulgarian and English.
- Who it is for: independent cafés, bars and small restaurants in Sofia, Bulgaria (then the rest of Bulgaria), run by an owner-operator who has no web person, whose menu, prices, hours and specials change often, and who today keeps the site out of date or only uses Instagram/Facebook/Google.
- What it sells, at what price: a monthly subscription, list price 25 € per venue per month (before VAT), hosting and setup included. Tier idea: Start 15 € (text and voice, 40 changes/month), Standard 25 € (photos, scheduling, staff, 150 changes), Pro 40 € (400 changes, several locations, own domain). Real evidence: four Sofia venues the founder knows said what they would pay per month before a product existed: Coffique 20 €, Bar and Dinner Central 30 €, Family House 50 €, The High End Bar 70 €.
- Where and how: online SaaS. Onboarding: the owner picks one of three templates, fills a 7-step wizard (menu read from a photo or PDF, texts written by AI), the site is deployed on its own Vercel project, then they connect the chat bot. Existing WordPress sites can be managed through a plugin. Sales: founder sells door to door to venues they know, then referrals; a Lovable-built landing page.
- Budget and constraints: solo founder (technical, builds with Claude Code). Product already built and live in production (Next.js on Vercel, Supabase, Claude Opus 5.5, Groq speech-to-text). Known running costs: about 42 €/month fixed infrastructure (Supabase Pro + Vercel Pro), and an estimated ~6.4 € of AI cost per venue per month at 2 messages a day (founder's own model). No outside funding stated. Started as a hackathon entry (theme "AI That Does the Work", October 2026).

## Summary

**Verdict: Not yet.** Two checks fail: year 1 loses 8,484 € once the founder pays themselves 1,000 €/month (subscriptions only), and only 2 of 20 simulated owners buy (10% against a 25% bar). The unit economics pass: each venue leaves 27.00 € of 30 € (90%) with AI routed by message type. What has to change is the **offer** (→ `/founder-offer`) and the **ramp** (→ `/founder-launch`), not the cost base.

**What it is.** Site Manager gives an independent café, bar or restaurant in Sofia a website the owner updates by messaging an AI agent (WhatsApp, Messenger, Telegram) with text, a voice note or a photo of the specials board; one tap makes it live. Two plans, excl. VAT: **Menu 17 €/month** (text and voice) and **Everywhere 30 €/month** (adds photos, Google and Instagram); Ready site 199 € once.

**The three numbers.** Contribution 27.00 €/venue on Everywhere (90%). Break-even 42 paying venues with a 1,000 € founder draw, 5 without. Year 1 at a ramp of 1 → 31 venues: −8,484 € with the draw, +3,516 € without (subscriptions only).

**Setup fee and promo.** 199 € once per new site (excl. VAT); none for venues that keep their own site. Promo: website + one year paid up front = 2 months free (Everywhere 199 € + 300 € = 499 €). With the setup fee, year 1 is −2,426 € with the founder draw (monthly profit positive from month 9) and +9,574 € without; cash needed 3,685 € with the draw. The computed verdict above is subscription-only.

**Who it's for.** Every café, bar and restaurant whose menu, prices or hours change; **venues with a daily menu, or that cook every day, get the most out of it** (lunch menus, daily specials, bistros, home-style restaurants): their menu changes every morning, so a photo of the board or a voice note is the core use. In both buyer-panel runs, the only 2 buyers of 20 were exactly these owners ("my lunch special changes every single day"). Sell to them first. Heavy photo users need photo routing (only board photos on Opus) and the 150-change limit to stay profitable.

**What a client costs us.** AI is routed: plain text → Haiku 5.5, bulk and scheduling → Sonnet 5.5, photos → Opus 5.5. An average Everywhere client (2 messages a day) costs about 0.08 € a day and **4.40 € a month** in total (AI 2.30 €, card fee 0.70 €, hosting share 1.40 €). A quiet client costs 2.68 € a month; a busy one 7.85 € (a busy day is about 0.67 € of AI). A Menu client costs about 2.26 €.

**Market.** 22,756 food-service venues in Bulgaria (Eurostat 2024); 2,742 categorised venues in Sofia (2021), ~98% independent. SAM ≈ 0.97 M €/year at 30 €. Only 47.4% of Bulgarian food and accommodation businesses with 10+ staff have a website, against 76.5% in the EU.

**Expansion (`expansion.md`).** Ten more countries in Greece and the Balkans (about 191,000 food-service businesses, 8× Bulgaria), sold through local POS/till partners who keep 15%. Order: Romania + Serbia (year 2), Greece + Montenegro (year 3), Croatia + Albania + Kosovo (year 4), then Bosnia, North Macedonia and Slovenia. Base case: about 3,050 venues and 601,000 € a year profit before salaries in year 5 (cautious 355,000 €, strong 1,094,000 €). No local competitor updates sites by chat.

**What the board and the panel agreed on.** All three board members (3 × FUND IF, average 5.3/10) and 12 of 18 panel no's said the same thing: the website is not where guests look. Google Maps, Instagram and the delivery apps are. "One message that also fixes my Google hours and menu" is the most-asked change. Viber is missing (4 of 18 no's). Trust needs a local person and a free first month.

**Re-test with Google added (same 20 owners):** still 2 buy. Google alone flipped nobody; it lifted price tolerance by about 2.5 € and moved the objections to Viber, Instagram posting, delivery apps, trust and keeping their own site (`panel-google/compare.md`).

**Where they disagreed.** Real venues quoted 20–70 € (median 40 €); the simulated panel's range tops out at 24.91 €. The panel judged "a website" against free Instagram; the real quotes came from owners who know the founder. The board split on scope: the Product lens says cut (one template, freeze WordPress), the Offers lens says widen (ship Google first).

**Competition.** "Edit your site by chat" already exists (Clawfront $4.99, bot2site 0–12 €), so it is not a moat. Bulgarian QR-menu vendors (3–60 €) are the fastest copier: qr-menu.bg says it has 247+ venues. The gap is local: a Bulgarian, venue-specific, chat-run website plus Google, set up in person.

**Biggest risk and the answer.** Selling "a website" into a market that does not value websites, now at 30 €, above the simulated panel's ceiling (about 25 €). Answer: sell "Everywhere" (site + photos + Google + Instagram from one message, 30 €), keep a 17 € "Menu" plan, apply for Google Business Profile API access now (approval is the slow part), and test 30 € on real owners before printing it.

**What the founder needs to start.** About 500 € of startup costs (estimates) and the decision on founder pay: without a salary it needs 616 € of cash; with 1,000 €/month it needs 8,984 € (3,685 € with the setup fee).

**This week.** Apply for Google Business Profile API access, and visit 10 Sofia venues with two printed offers (17 € "Menu" vs 30 € "Everywhere", plus the website + one-year promo). Ask each owner which messenger they use daily. Count the signatures.

The panel is simulated buyers and every number here is a projection; real customers and signed invoices confirm them. Not financial, legal or tax advice.

## What the board said

**Vote: 3 FUND IF, 0 PASS. Average score 5.3 / 10** (Offers 5, Monopoly 5, Product 6).

Memos: [offers](board/offers.md) · [monopoly](board/monopoly.md) · [product](board/product.md). The lenses are summaries of published frameworks, not the views of their authors.

### Risks more than one member raised

1. **The website may be the wrong place.** All three: diners look at Google Maps, Instagram and Facebook. A correct website with a stale Google listing does not solve the owner's real problem. (Offers #1, Monopoly #3, Product #2)
2. **Viber is missing.** All three: it is the messenger Bulgarian owners use most, so many would need a new app to use the product. (Offers #3, Monopoly #3, Product #3)
3. **Four quotes are not customers.** All three ask for paid, weekly-active venues before anything else.
4. **Distribution and CAC are unknown.** Offers and Monopoly: door-to-door to friends gets 10 venues, not 100; a 15–25 € plan cannot pay for much field-sales time.
5. **Copyable.** Monopoly (top risk), Offers (drifts to "cheap website"): any builder, POS or delivery app could add "edit by chat".

### Where they disagree

- **Scope.** Product wants the scope *cut* (one template, no WordPress, no tiers until 10 venues). Offers wants it *widened* (ship Google Business updates, maybe a higher tier that covers Google and Instagram). Monopoly sees "one place to update site, Google and Instagram" as the only credible moat. Reconciled reading: cut the surfaces that are not where diners look (extra templates, WordPress, quotas), add the one that is (Google).
- **How strong the pain is.** Product scores the core chat moment highly; Offers doubts the pain is big enough to pay for.

### Conditions, merged (the rest of the pack ticks these off)

- [ ] Turn quotes into money: ≥3 paying venues within 60 days (one at ≥40 €), ≥10 paying by month 4, used weekly and still paying after a month.
- [ ] Size the beachhead: count venues in Sofia/Bulgaria and map competitor prices → `competitors.md`.
- [ ] Measure cost to win a venue and referral rate on the next 20 visits → `cfo.md` assumption until then.
- [ ] One measurable outcome and a guarantee (e.g. first month refunded if not used weekly) → `offer`.
- [ ] Ship Google Business Profile hours/menu updates before scaling sales.
- [ ] Cut scope: one onboarding path the founder leads, freeze WordPress plugin and extra tiers until 10 paying venues.
- [ ] Onboarding: 3–5 venues from first contact to first live change in under 15 minutes.
- [ ] Measure and publish agent accuracy on real messages (misread prices).
- [ ] Decide: "a website" or "correct everywhere".
- [ ] Check the ~6.4 € AI cost per venue at 10 messages a day → `cfo.md`.

### The strongest version the board can see

Not "a website you edit by chat", but **"text one message, and your menu, prices and hours are right everywhere guests look": your site, Google Maps, and Instagram.** The website is the free anchor that holds the structured menu; the paid value is that one voice note fixes the Google listing too. That is harder to copy (it needs the structured menu, the integrations and local trust together), it ties to money (guests who arrive at the right hours and see the right prices), and it gives a reason to charge 25–40 €. This differs from the pitch: it demotes the template/wizard work and promotes the planned Google integration to the core.

## The competition

Public sources only. Full rows with URLs: `competitors.csv`. Prices are list prices, accessed 2026-10-11 unless dated.

### 1. Competitors, most direct first

| # | Name | Type | Comparable price | Note |
|---|---|---|---|---|
| 1 | [Clawfront](https://clawfront.io/) | Chat-built site (WhatsApp) | $4.99/mo + AI edit credits | Edits by WhatsApp text/voice; has a restaurants page; not restaurant-only |
| 2 | [bot2site](https://bot2site.com/en/) | Chat-built site (Telegram) | €0 free; €11.99/mo own domain | "Update your site by chatting"; markets to cafés; no AI |
| 3 | [ChilledSites](https://chilledsites.com/whatsapp-website-builder) | Chat-built site (WhatsApp/Telegram) | £9/mo Pro | Builds from a message; post-launch chat editing not stated on WhatsApp page |
| 4 | [digitalnomenu.bg](https://digitalnomenu.bg/prices/) (Ordermoon/Zavedenia.bg) | BG digital menu | €60/mo, or €33/mo annual | App editing, AI translation, menu from scan; no website in plan |
| 5 | [qr-menu.bg](https://www.qr-menu.bg/home/en) | BG digital menu + ordering | €10/mo Standard | Claims 247+ active venues |
| 6 | [1MENU.eu](https://1menu.eu/) | BG hosted menu | €45/mo + €100 one-off setup | Own subdomain, bars/beach venues |
| 7 | [e-menu.bg](https://www.e-menu.bg/) | BG QR menu | €3.06/mo (5.99 лв) | Cheapest; menu URL only |
| 8 | [Owner.com](https://www.owner.com/pricing) | US restaurant site platform | $249/mo + 5% per order | AI website + ordering + marketing |
| 9 | [Popmenu](https://pricingsaas.com/companies/popmenu) | US restaurant site platform | $179/mo Starter (third-party) | Official pricing page returned 403 |
| 10 | [BentoBox](https://www.getbento.com/pricing/) | US restaurant site platform | Not published | Now Clover-only |
| 11 | [Wix](https://www.wix.com/upgrade/website) | Generic builder | $17.77/mo Light (yearly, USD ref.) | DIY editor |
| 12 | [Maxgraphic](https://maxgraphic.bg/bg/%D0%B8%D0%B7%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%BA%D0%B0-%D1%81%D0%B0%D0%B9%D1%82-%D1%80%D0%B5%D1%81%D1%82%D0%BE%D1%80%D0%B0%D0%BD%D1%82.html) (Sofia agency) | Agency | €1,824.49 one-off excl. VAT | Menu module, 1 yr hosting/support |
| – | [Glovo BG](https://www.capital.bg/biznes/kompanii/2024/10/26/4691158_dostavki_ot_glovo_s_privkus_na_socialna_mreja/) | Delivery marketplace | Commission, BG rate not public | Took over foodpanda BG |
| – | [Google Business Profile](https://support.google.com/business/answer/9455840?hl=en) | Substitute | Free | Menu editor; changes "can take 1–2 days" |
| – | Instagram/Facebook, PDF menu, nothing | Substitute | Free | Default today per idea.md |

Also seen, not tabled: [AI Site Biz](https://aisitebiz.com/whatsapp-website-builder/) (WhatsApp sites for trades, owner approves facts before publish; price not stated), [Menubly](https://www.menubly.com/pricing/) ($9.99/mo mini-site + menu), MENU TIGER ($17/mo Regular per [its blog](https://www.menutiger.com/blog/menu-tiger-annual-plan); pricing page unreachable), [GloriaFood](https://www.gloriafood.com/) (free ordering; end of life 30 April 2027), [Saitko](https://saitko.com/planove-i-ceni-za-sait) (BG subscription site €11.20/mo, no menu features).

**Is anyone doing "manage the website by chatting"?** Yes, but generically. Clawfront, bot2site and ChilledSites prove the pattern exists for small businesses. None found targets Bulgaria, speaks Bulgarian, or has restaurant operations (scheduled specials, sold-out/auto-revert, change log). Customer-facing WhatsApp restaurant bots are common (e.g. [n8n template, $60](https://n8n.io/workflows/5096-ai-powered-restaurant-order-and-menu-management-with-whatsapp-and-google-gemini/)), but their menus are edited "through the admin interface", not by chat.

### 2. Price range for "venue website + easy menu updates"

- **Monthly SaaS** (10 paid plans, monthly price): lowest **€3.06** (e-menu.bg; free tiers exist at bot2site/Wix), median **≈ €11–18** (between bot2site €11.99 and Wix $17.77), highest **$249 + 5%** (Owner.com; $499 flat). Bulgarian-only SaaS: €3.06–€60.
- **One-off agency builds, Sofia/BG** (3 priced): lowest **≈ €250+** ([Gradivnite](https://gradivnite.com/%D1%86%D0%B5%D0%BD%D0%B0-%D1%83%D0%B5%D0%B1-%D1%81%D0%B0%D0%B9%D1%82), hosting extra), median **€500** ([All in design](https://allin-design.com/czeni-za-ueb-dizajn/), excl. VAT), highest **€1,824–3,847** (Maxgraphic). Maintenance runs 100–500 лв/month at All in design.
- Site Manager at 25 €/mo sits above BG QR menus (€3–20) and below digitalnomenu.bg (€33–60), 1MENU (€45) and US platforms.

### 3. Positioning map (owner's view)

Axes: **effort to keep it current** (who does the work, how) vs **monthly cost**.

```
                 HIGH effort to update (owner logs into admin / pays agency)
                         |
  Wix ($18)              |                Agency (€250–3,850 one-off + upkeep)
  e-menu.bg (€3)         |                Popmenu ($179)  BentoBox (n/a)
  qr-menu.bg (€10)       |                Owner.com ($249+5%)
  Google Profile (free)  |                digitalnomenu.bg (€33–60), 1MENU (€45)
 LOW cost ---------------+--------------------------------------- HIGH cost
  bot2site (€0–12)       |
  Clawfront ($5)         |  <- Site Manager (25 €)
  ChilledSites (£9)      |
  Instagram (free; no real menu/site)
                         |
                 LOW effort (send a chat message)
```

The low-effort/low-cost quadrant is not empty: generic chat builders sit there and are cheaper than Site Manager.

### 4. Complaints, ranked

Sources read: Trustpilot pages for [Popmenu](https://www.trustpilot.com/review/popmenu.com) (2.9/5, 55 reviews; first page, 14 low/4-star read), [BentoBox](https://www.trustpilot.com/review/getbento.com) (1.6/5, 82; 19 read), [Owner.com](https://www.trustpilot.com/review/owner.com) (2.5/5, 5; 4 read), [Wix](https://www.trustpilot.com/review/wix.com) (3.4/5, 29,179; themes only), [Popmenu BBB](https://www.bbb.org/us/ga/atlanta/profile/marketing-software/popmenu-0443-28164736/complaints). Capterra, G2 and TrustRadius returned 403.

1. **Support disappears after the sale (≈8).** "Once you sign the docs everyone disappears" ([Popmenu, 1★, 2026-10-05](https://www.trustpilot.com/review/popmenu.com)); "Unreliable and non existent support." ([BentoBox, 1★, 2025-02-14](https://www.trustpilot.com/review/getbento.com)).
2. **Billing, contracts, can't cancel (≈7).** "they keep taking our money as if we are renewing an annual contract!" ([Popmenu, 1★, 2025-09-26](https://www.trustpilot.com/review/popmenu.com)); BentoBox 4★ asking to "honor my request for cancellation" (2026-02-12); two BBB cases of billing after cancellation.
3. **Editing the menu/site is unreliable or rigid (5).** "Menu items kept just disappearing, changes didnt stick." ([BentoBox, 1★, 2026-02-26](https://www.trustpilot.com/review/getbento.com)); "they couldn't provide an audit trail" ([Popmenu, 3★, 2024-09-18](https://www.trustpilot.com/review/popmenu.com)).
4. **Too expensive for what it is (4).** "too expensive for such a cookie-cutter template" ([Popmenu, 3★, 2025-08-20](https://www.trustpilot.com/review/popmenu.com)); "$500 per month and no orders at all" ([Owner.com, 1★, 2025-05-08](https://www.trustpilot.com/review/owner.com)).
5. **Promised SEO/results didn't arrive (4).** "from page 3 on Google to page 5" ([Owner.com, 1★, 2026-08-22](https://www.trustpilot.com/review/owner.com)).
6. **Spammy marketing / data privacy (4).** "carpet bombing my inbox" ([Popmenu, 1★, 2026-03-05](https://www.trustpilot.com/review/popmenu.com)).

All themes are from US platforms; **no public reviews were found for any Bulgarian menu vendor or for the chat builders** — BG-specific complaints are **thin (0)**.

### 5. The gap

There is a gap, but it is narrow and local rather than technological:

- **Chat editing exists, but not for venues in Bulgaria.** Clawfront/bot2site/ChilledSites are generic, English-first, and do not mention scheduled specials, sold-out items, auto-revert or a change log. Site Manager's preview-then-publish, change log and undo answer complaint #3 directly ("audit trail", "changes didnt stick").
- **BG menu vendors are menu-only and admin-driven.** qr-menu.bg, e-menu.bg and digitalnomenu.bg sell a QR menu, not the venue's website, and edits happen in an app/admin.
- **Restaurant platforms that bundle a website are US-only and $179–499/mo**, with the support/contract complaints above. Month-to-month at 25 € with a founder who visits answers #1, #2 and #4.
- **The market is underserved:** only **47.4%** of Bulgarian accommodation & food enterprises (10+ staff) have a website vs **76.5%** EU-wide, and hotels (I55) are at 87.6%, so food service is lower still ([Eurostat isoc_ciwebn2, 2025](https://ec.europa.eu/eurostat/databrowser/view/isoc_ciwebn2/default/table)). Micro venues (<10 staff) are not covered by that survey.
- **Google's own menu editor is slow** (changes "can take 1–2 days") and is not a website.

What Site Manager can own: *the Bulgarian-language, chat-run website for a café, with menu operations built in, sold and set up in person.* Pure "edit by chat" is not a moat.

### 6. The threat

- **Fastest copy: Bulgarian menu vendors with an installed base.** qr-menu.bg (247+ venues) or digitalnomenu.bg (already does AI translation and menu-from-scan, tied to Zavedenia.bg's directory and its "Websites" product) could add a Viber/WhatsApp/Telegram bot on top of their existing menu database in weeks and sell it to venues they already bill. This is the biggest threat.
- **Price pressure from generic chat builders:** Clawfront at $4.99 or bot2site at €0–12 adding a restaurant template and Bulgarian would undercut 25 € by 5x.
- **Platform moves:** Google already builds menus from a photo; Wix/Owner.com adding a WhatsApp agent is plausible but they do not sell in Bulgarian today.
- **DIY:** n8n + LLM templates make a one-venue clone cheap for any freelancer.

### 7. Market size

Inputs (all Eurostat API, data updated 2026-09-30 unless noted):

| Input | Value | Source |
|---|---|---|
| BG food & beverage service enterprises (I56), 2024 | 19,441 (restaurants 12,268; bars 6,337; catering 836) | [Eurostat sbs_ovw_act](https://ec.europa.eu/eurostat/databrowser/view/sbs_ovw_act/default/table) |
| BG I56 local units (venues), 2024 | **22,756** | [Eurostat sbs_r_nuts2021](https://ec.europa.eu/eurostat/databrowser/view/sbs_r_nuts2021/default/table) |
| Yugozapaden region BG41 (Sofia city + 4 oblasts) I56 local units, 2024 | 8,031 | same |
| Sofia municipality, food & entertainment venues, 2021 | **2,742** (913 restaurants, 694 fast food, 503 cafés, 359 drinking places, 271 bars) | [Visit Sofia, "Туризмът в цифри 2021"](https://www.visitsofia.bg/images/pdf/TC__2021.pdf) (mayor-categorised venues only; newer edition not found) |
| Independent share, Sofia | ~98% | [Cushman & Wakefield via Investor.bg, 2026-04-23](https://www.investor.bg/a/113-analizi/429692-operatorite-na-zavedeniya-za-hranene-v-sofiya-sa-uvelichili-prihodite-si-s-90-za-shest-godini) |
| BG I56 births / deaths, 2024 | 2,447 (12.6%) / 2,346 (12.1%) | [Eurostat bd_size](https://ec.europa.eu/eurostat/databrowser/view/bd_size/default/table) |
| Website share, NACE I, 10+ staff, 2025 | BG 47.4%, EU 76.5% | [Eurostat isoc_ciwebn2](https://ec.europa.eu/eurostat/databrowser/view/isoc_ciwebn2/default/table) |
| EU-27 I56 enterprises, 2024 | 1,584,295 | [Eurostat sbs_ovw_act](https://ec.europa.eu/eurostat/databrowser/view/sbs_ovw_act/default/table) |

```
Price: 25 €/venue/month = 300 €/venue/year

TAM  (all BG food-service venues)   22,756 × 300 €     = 6.83 M €/yr
SAM  (independent Sofia venues)     2,742 × 98%* = 2,687 × 300 € = 0.81 M €/yr
     upper bound (BG41 region)      8,031 × 98%* = 7,870 × 300 € = 2.36 M €/yr
     *98% independent share applied to venue counts = ESTIMATE
SOM  (solo founder, ESTIMATE)       Y1  30 venues  =  9,000 €/yr ARR
                                    Y2 100 venues  = 30,000 €/yr
                                    Y3 250 venues  = 75,000 €/yr (≈9% of the SAM floor)
```

SOM assumes roughly one net new venue a week by door-to-door, then referrals, and accounts for ~12% of venues closing each year (Eurostat death rate), which sets a churn floor of about 1% a month that no product can fix. The ~2,450 new food businesses a year in Bulgaria are the natural entry point: new venues need a site from day one.

EU headroom: 1,584,295 food-service enterprises in the EU-27 (2024), about 81× Bulgaria.

## The buyer panel

**2 buy · 18 pass** (10% buy) out of 20 simulated buyers. Seed 1011, so the same cards can be dealt again.

These are simulated buyers, not customers. Use this to find objections and weak spots, then confirm the big ones with real people before you spend.

### By segment

| group | buyers | buy rate |
| --- | ---: | ---: |
| Restaurant owner or manager (1-3 locations) | 5 | 20%  (thin) |
| Bar or bistro owner with a kitchen (1 location, changing menu) | 6 | 17%  (thin) |
| Small café or coffee bar owner (1 location, under 10 staff) | 9 | 0% |

### By buying behaviour

| group | buyers | buy rate |
| --- | ---: | ---: |
| Tech-curious early adopter | 2 | 100%  (thin) |
| Instagram is enough | 4 | 0%  (thin) |
| Penny-pincher | 3 | 0%  (thin) |
| Trusts people, not apps | 2 | 0%  (thin) |
| Has an outdated site | 4 | 0%  (thin) |
| Relies on Google and delivery apps | 3 | 0%  (thin) |
| Busy, delegates to a manager | 2 | 0%  (thin) |

### By income

| group | buyers | buy rate |
| --- | ---: | ---: |
| $28,000 to $43,000 | 7 | 14%  (thin) |
| $43,000 and up | 7 | 14%  (thin) |
| under $28,000 | 6 | 0%  (thin) |

### Why they pass

| reason | buyers | in their words |
| --- | ---: | --- |
| need | 9 | "My customers find me on Instagram and Facebook, and I already post the specials there myself for free. Paying 25 euros a month for a website nobody looks at, on a margin like mine, makes no sense." (P001) · "My guests find me on Instagram and Google Maps, I already post the specials there for free. I raised prices twice this year, I'm not adding 25 € a month for a website nobody opens." (P003) |
| trust | 4 | "I already bleed money on POS, accounting and the delivery apps, and my lunch special goes on the board and on Facebook for free. Another 25 € plus VAT every month to an AI I can't phone when it breaks is not something I sign up for from an ad." (P005) · "I don't buy things from an ad or an app I've never heard of. My daughter does the Instagram and that's enough for now; if another café owner I know used this and told me it works, maybe, but not from a stranger." (P006) |
| habit | 4 | "My whole day runs on Viber voice notes, with staff, suppliers, everyone. I'm not installing WhatsApp or Telegram just to talk to my website, and if it's not where I already am, I'll forget it exists within a week, like the old site." (P007) · "I already have a site and my manager updates the menu when it matters; moving everything to a new site for 25 euros a month is a hassle I don't need right now. Most of my customers see us on Glovo and Google anyway." (P010) |
| price | 1 | "I already pay for POS, accounting and give the delivery apps their cut, and I raised my prices twice this year. Another 25 a month, 30 with VAT, for a menu page I can fix on Facebook and Google myself is money I don't have spare right now." (P002) |

### Why they buy

| reason | buyers | in their words |
| --- | ---: | --- |
| convenience | 2 | "My lunch special changes every single day and right now it never makes it onto my site, so sending a photo of the board from my phone and tapping once is exactly the kind of thing I'd try. I'd start on one venue for a month, keep my old site running alongside, and point the table QR at this." (P004) · "My lunch special changes every day and right now the website is always wrong, so sending a voice note I'm already used to and tapping once is exactly how I'd want to do it. 25 a month is less than one slow lunch service, so I'll try it for a month and cancel if it messes up." (P020) |

### What would flip a no

- If one message from Viber updated my Instagram, Facebook and Google listing at the same time, so it saved me time instead of adding another thing to feed.
- A free first month, plus it also updates my Google listing hours and menu, and a promise in writing that if I cancel I keep my domain and get my site and menu exported.
- If one message also updated my Google Maps hours and menu and posted the special to Instagram, not just the website.
- A local person who sets it up with me in the restaurant, a phone number that answers in Bulgarian, and a first month free so I can see if it actually saves me time.
- Another café owner in Sofia I know shows me it on their phone, tells me it never got a price wrong, and there's a real person who speaks Bulgarian I can call.
- Viber support, so I can send it a voice note in the same app I use all day.
- If the same WhatsApp message also updated my prices, hours and specials on Google Maps, Glovo and Wolt, without me having to move off my current site.
- My existing domain connected on the 25 € plan, plus a written promise that if I cancel I get a full export of the site and menu that I can host elsewhere.
- If it worked on top of my existing site without moving anything and my manager could do it from Viber, with a free first month to see it actually saves time.
- If it worked with the site I already have instead of making me move, and the first months were free so I could see it actually saves me time on the daily special.
- My manager sets it up, uses it for a month on a free trial without bothering me, and I can see it actually brought in tables or saved us phone calls.
- If the same WhatsApp message also updated my hours and menu on Google Maps and Glovo/Wolt, and there was a Bulgarian person I could phone when something goes wrong.

Buyers say they would buy **1.0 times** in the first month on average.

20 buyers gave all four price answers. Run founder-pricing's van_westendorp.py on the answers folder.

## Pricing

### The three signals disagree, and that is the finding

| signal | what it says | weight |
| --- | --- | --- |
| Four real Sofia venues (conversations, not contracts) | 20, 30, 50, 70 €/month; median 40 € | Highest: real people, but friendly and unpaid |
| Simulated panel, 20 owners (Van Westendorp, `pricing-curve.md`) | acceptable 5.10–24.91 €; median "getting expensive" 20 €, "too expensive" 30 € | Low: picks what to test, leans cheap when the pitch is "a website" |
| Competitors (`competitors.md`) | BG QR menus 3–20 €/month; digitalnomenu.bg 33–60 €, 1MENU 45 €; chat-builders Clawfront $4.99, bot2site 0–12 €; US restaurant platforms $179–499; BG agency site 250–3,800 € one-off | Medium |

The panel was pitched "a website" and judged it against free Instagram. Its own flip condition was "and it also fixes Google". So **the price depends on what is sold**: as "a website" it sits with QR menus (≤20 €); as "correct on your site and Google from one message" it sits with digitalnomenu.bg and 1MENU (33–60 €), where the real quotes also sit.

### The price

**Main plan: Everywhere at 30 €/venue/month (excl. VAT), with photos, Google and Instagram; entry plan: Menu at 17 €.** 30 € sits above the simulated panel's range (it topped out at 24.91 €, when shown "a website" against free Instagram), inside the BG menu+site vendors' range (33–60 € is above it, QR menus at 3–20 € below), and at or below 3 of the 4 real quotes (20, 30, 50, 70 €). The panel is the warning: test 30 € with real owners (below). Margin from the CFO tool, with AI routed by message type: contribution 27.00 € (90%) per venue; break-even 42 venues with a 1,000 € founder draw, 5 without. An average client costs us about 4.40 € a month in total (`cfo.md`).

Until Google and Instagram posting ship, sell Everywhere at the Menu price (17 €) to early venues, with a written move to 30 € when they arrive (their choice). Do not price below 17 €: at 17 € break-even is about 79 venues with the founder draw.

### Price tiers: the website once, the agent monthly

Prices in Bulgaria, excl. VAT. Other countries get their own prices (`expansion.md`).

#### 1. The website (one-off)

| package | price | what the venue gets | our cost |
| --- | ---: | --- | --- |
| **Bring your site** | **0 €** | Keep the site you have; the WordPress plugin or the embed shows the menu, specials and hours from Site Manager, and the chat edits them | none |
| **Ready site** | **199 €** | One of three designs, menu read from a photo or PDF, texts written in BG and EN, QR codes for the tables, set up in person and connected to the owner's chat; live the same day; **own domain and hosting free for the first year** | ≈ 3.59 € (card fee + AI) + 2–3 h of the founder's time |

Both are below the Sofia agency median (500 €) in the research; the cheapest agency build found was 250 €, with upkeep at 51–256 €/month that the chat replaces.

#### 2. The agent (monthly)

| plan | price | what it does | changes / month | our cost, typical use | left for us |
| --- | ---: | --- | ---: | ---: | ---: |
| **Menu** | **17 €** | Website + QR menu, edited by chat with text and voice, undo and change log | up to 40 | 2.26 € (30 messages) | **14.74 € (87%)** |
| **Everywhere** | **30 €** | Menu + **photos** (snap the specials board, new dish photos), scheduled changes, staff access, own domain, **Google hours, menu and posts**, **today's special posted to Instagram (post or story)** (opt-in per post) | up to 150 | 4.40 € (60 messages) | **25.60 € (85%)** |

Our cost = routed AI (≈ 0.038 € per message on average; Menu has no photo turns, ≈ 0.012 €) + card fee (1.5% + 0.25 €) + hosting share 1.40 €. At the limit, the worst case still leaves money: Menu 14.62 € (86%), Everywhere 22.15 € (74%). Over the limit nothing stops working; the bot suggests the next plan.

Google push and Instagram posting are planned, not built (Facebook Page posting maybe later, not in the offer): sell Everywhere at the Menu price (17 €) to early venues until they ship, with a written move to 30 € when they do (their choice).

#### 3. Promo: website + one year = 2 months free

Buy the Ready site together with a year of the agent, paid up front, and get **12 months for the price of 10**:

| package | normal | with the promo |
| --- | ---: | ---: |
| Ready site + Menu, one year | 199 € + 204 € = 403 € | **199 € + 170 € = 369 €** |
| Ready site + Everywhere, one year | 199 € + 360 € = 559 € | **199 € + 300 € = 499 €** |

It answers the owners who object to "another monthly fee", brings the year's money in up front, and keeps the setup fee.

#### What a venue pays in year 1

| choice | year 1 total |
| --- | ---: |
| Bring your site + Menu, monthly | 204 € |
| Bring your site + Everywhere, monthly | 360 € |
| Ready site + Everywhere, monthly | 559 € |
| **Ready site + Everywhere, one year with the promo** | **499 €** |

For comparison: one Sofia agency site is 500 € on average, before any upkeep. The CFO model (`cfo.md`) uses Everywhere at 30 € with a 199 € setup for every new venue.

### Opening offer (ends 31 December 2026)

First month free, setup done in person by the founder, and a written exit promise: the venue keeps its domain and gets a full export of site and menu if it cancels. Each answers a panel objection (free trial ×6, in-person/Bulgarian support ×5, lock-in ×2). No "was" prices.

### What to test with real buyers

1. **17 € Menu vs 30 € Everywhere, framed as "a website" vs "your site, Google and Instagram"**: offer both to 10 venues door to door, with and without the website + one-year promo; count signed first invoices.
2. **Viber**: ask every visited owner which messenger they use daily. If more than half say Viber only, the 100 €/month Viber bot pays for itself at 4 venues on the 30 € plan.

### Top price objections from the panel (verbatim, simulated)

- "Another 25 a month, 30 with VAT, for a menu page I can fix on Facebook and Google myself" (P002)
- "Paying 25 euros a month for a website nobody looks at, on a margin like mine, makes no sense." (P001)
- "25 a month is less than one slow lunch service, so I'll try it for a month" (P020, a buyer)

## The numbers

Amounts are in euros; the tool prints "$" but every input is EUR. One "day" in this model is one month, so "a day" means "paying venues". **The model prices every venue on the Everywhere plan at 30 €** (Menu at 17 € exists but is not modelled). **AI is routed by message type** (plain text → Claude Haiku 5.5, bulk/scheduling → Claude Sonnet 5.5, photos → Claude Opus 5.5, 1 in 10 Haiku turns redone on Opus). The all-Opus inputs at the old 25 € price are kept in `numbers-all-opus.json`.

### What one client costs us (Everywhere, 30 €)

| Client | AI per day | AI per month | + card fee + hosting share | **Total per month** | Left from 30 € |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quiet (1 message every 2 days) | 0.01 € on a 1-text day | 0.58 € | 2.10 € | **2.68 €** | 27.32 € |
| **Average (2 messages a day)** | 0.08 € | **2.30 €** | 2.10 € | **4.40 €** | **25.60 €** |
| Busy (5 a day; a busy day = 8 texts, 1 bulk, 3 photos) | 0.67 € on a busy day | 5.75 € | 2.10 € | **7.85 €** | 22.15 € |

Card fee 0.70 € (Stripe 1.5% + 0.25 €); hosting share 1.40 € at 30 venues (42 € ÷ 30). Menu at 17 €: about 2.26 € a month, 14.74 € left. Setup: about 0.35 € of AI per new venue, plus 2–3 hours of the founder's time.

### The numbers

- **The margin.** Each venue-month leaves **27.00 € (90%)** after AI, card fees and speech-to-text. The cost is people, not tokens.
- **The line to watch: founder pay.** With a 1,000 €/month draw, break-even is **42 paying venues** and year 1 loses **8,484 €** (subscriptions only). With no draw, break-even is **5 venues** and year 1 makes **3,516 €** (startup money back in month 7).
- **Cash (subscriptions only).** With the draw: **8,984 €** needed before it pays for itself. Without: **616 €**.
- **Price what-ifs** (tool runs, with the draw): 25 € → break-even 51, year 1 −9,384 €; 35 € → break-even 35, year 1 −7,584 €; 17 € (everyone on Menu) → break-even 79, year 1 −10,824 €.
- **Board money conditions.** A busy client still leaves 22.15 €, so heavy users stay profitable. Still to measure: real message counts, photo share, and how often Haiku needs Opus. CAC is unknown; the model treats the founder's visits as free.

### With a 199 € setup fee

The CFO tool has no line for one-off revenue, so this is calculated beside it, on the same inputs and ramp: every **new** venue pays 199 € once (excl. VAT). Each setup costs us about 3.59 € (card fee 3.23 €, wizard AI 0.35 €), so it nets **195.41 €**. The founder's setup time sits inside the founder pay. The plan's computed verdict above uses the subscription-only year 1. The website + one-year promo (2 months free) moves money earlier but is not modelled separately.

| month | paying venues | new venues | revenue (incl. setup fees) | profit | cumulative (after 500 € startup) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | 229 € | −890 € | −1,390 € |
| 2 | 3 | 2 | 488 € | −640 € | −2,030 € |
| 3 | 5 | 2 | 548 € | −586 € | −2,616 € |
| 4 | 7 | 2 | 608 € | −532 € | −3,148 € |
| 5 | 10 | 3 | 897 € | −256 € | −3,404 € |
| 6 | 13 | 3 | 987 € | −175 € | −3,579 € |
| 7 | 16 | 3 | 1,077 € | −94 € | −3,672 € |
| 8 | 19 | 3 | 1,167 € | −13 € | −3,685 € |
| 9 | 22 | 3 | 1,257 € | 68 € | −3,617 € |
| 10 | 25 | 3 | 1,347 € | 149 € | −3,468 € |
| 11 | 28 | 3 | 1,437 € | 230 € | −3,237 € |
| 12 | 31 | 3 | 1,527 € | 311 € | −2,926 € |

- **Year 1 with the setup fee:** **−2,426 €** with the 1,000 € founder draw (−8,484 € without the fee); **+9,574 €** without the draw.
- **Monthly profit turns positive in month 9** with the draw.
- **Cash needed before it pays for itself:** 3,685 € with the draw; 500 € without, earned back in month 3.
- **If the first 10 venues get setup free** (launch partners): about 1,950 € less in year 1.
- **Venues that keep their own site** pay no setup; each one lowers this by about 195 €.
- **The risk:** 30 € and the fee may cost sign-ups (the simulated panel topped out at about 25 €). This assumes the same ramp; test on the first 10–20 visits.

Not financial, tax or legal advice: an accountant should check the EOOD structure, VAT registration (20% on top of the price) and how the founder pays themselves before money moves.

---

## Unit economics: Site Manager (subscription; one 'day' in this model = one month, so 'per day' = paying venues)

Every number below comes from the input file. Nothing is looked up or guessed.

### One venue-month

| line | per venue-month |
| --- | ---: |
| Price | $30.00 |
| Claude AI per venue, routed (Haiku text, Sonnet bulk, Opus photos; 2 msgs/day) | -$2.29 |
| Card fees (Stripe EEA 1.5% + 0.25 EUR) | -$0.70 |
| Speech-to-text (Groq whisper, ~18 voice notes) | -$0.01 |
| **Contribution** (what each venue-month leaves to pay the fixed costs) | **$27.00** (90%) |

### The margin that matters

Fixed costs: $1,112 a month (Supabase Pro ($25) $23, Vercel Pro ($20) $19, Domain, email, misc SaaS (estimate) $10, Accountant for a Bulgarian EOOD (estimate) $60, Founder pay, part-time draw (estimate) $1,000).

- **Break-even: 42 venue-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (60 a day): **28%** of every sale, after every cost.

### Year 1, month by month

| month | venue-months a day | revenue | profit | cumulative (after $500 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | $30 | -$1,085 | -$1,585 |
| 2 | 3 | $90 | -$1,031 | -$2,616 |
| 3 | 5 | $150 | -$977 | -$3,593 |
| 4 | 7 | $210 | -$923 | -$4,516 |
| 5 | 10 | $300 | -$842 | -$5,358 |
| 6 | 13 | $390 | -$761 | -$6,119 |
| 7 | 16 | $480 | -$680 | -$6,799 |
| 8 | 19 | $570 | -$599 | -$7,398 |
| 9 | 22 | $660 | -$518 | -$7,916 |
| 10 | 25 | $750 | -$437 | -$8,353 |
| 11 | 28 | $840 | -$356 | -$8,709 |
| 12 | 31 | $930 | -$275 | -$8,984 |

- **Year 1 operating profit: -$8,484** on $5,400 of revenue.
- After the $500 startup spend: -$8,984.
- Startup money earned back: not within year 1.
- Cash you need before it pays for itself: **$8,984**.

### What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 28% | 42 | -$8,484 |
| Price -10% | 20% | 47 | -$9,024 |
| Volume -20% | 13% | 42 | -$9,456 |
| Unit costs +15% | 27% | 42 | -$8,565 |

### Red flags

- Year 1 loses money on operations (-$8,484).
- The startup spend is not earned back within year 1.

## Not done yet

- The offer: run /founder-offer
- Marketing: run /founder-marketing
- Brand: run /founder-brand
- Operations: run /founder-ops
- Launch plan: run /founder-launch

_The panel is simulated buyers and the numbers are projections from your inputs. Confirm demand with real customers and costs with real quotes before you spend. Not financial, legal or tax advice._
