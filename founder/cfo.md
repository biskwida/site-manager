# CFO note (read first)

Amounts are in euros; the tool prints "$" but every input is EUR. One "day" in this model is one month, so "a day" means "paying venues". **The model prices every venue on the Everywhere plan at 30 €** (Menu at 17 € exists but is not modelled). **AI is routed by message type** (plain text → Claude Haiku 5.5, bulk/scheduling → Claude Sonnet 5.5, photos → Claude Opus 5.5, 1 in 10 Haiku turns redone on Opus). The all-Opus inputs at the old 25 € price are kept in `numbers-all-opus.json`.

## What one client costs us (Everywhere, 30 €)

| Client | AI per day | AI per month | + card fee + hosting share | **Total per month** | Left from 30 € |
| --- | ---: | ---: | ---: | ---: | ---: |
| Quiet (1 message every 2 days) | 0.01 € on a 1-text day | 0.58 € | 2.10 € | **2.68 €** | 27.32 € |
| **Average (2 messages a day)** | 0.08 € | **2.30 €** | 2.10 € | **4.40 €** | **25.60 €** |
| Busy (5 a day; a busy day = 8 texts, 1 bulk, 3 photos) | 0.67 € on a busy day | 5.75 € | 2.10 € | **7.85 €** | 22.15 € |

Card fee 0.70 € (Stripe 1.5% + 0.25 €); hosting share 1.40 € at 30 venues (42 € ÷ 30). Menu at 17 €: about 2.26 € a month, 14.74 € left. Setup: about 0.35 € of AI per new venue, plus 2–3 hours of the founder's time.

## The numbers

- **The margin.** Each venue-month leaves **27.00 € (90%)** after AI, card fees and speech-to-text. The cost is people, not tokens.
- **The line to watch: founder pay.** With a 1,000 €/month draw, break-even is **42 paying venues** and year 1 loses **8,484 €** (subscriptions only). With no draw, break-even is **5 venues** and year 1 makes **3,516 €** (startup money back in month 7).
- **Cash (subscriptions only).** With the draw: **8,984 €** needed before it pays for itself. Without: **616 €**.
- **Price what-ifs** (tool runs, with the draw): 25 € → break-even 51, year 1 −9,384 €; 35 € → break-even 35, year 1 −7,584 €; 17 € (everyone on Menu) → break-even 79, year 1 −10,824 €.
- **Board money conditions.** A busy client still leaves 22.15 €, so heavy users stay profitable. Still to measure: real message counts, photo share, and how often Haiku needs Opus. CAC is unknown; the model treats the founder's visits as free.

## With a 199 € setup fee

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

# Unit economics: Site Manager (subscription; one 'day' in this model = one month, so 'per day' = paying venues)

Every number below comes from the input file. Nothing is looked up or guessed.

## One venue-month

| line | per venue-month |
| --- | ---: |
| Price | $30.00 |
| Claude AI per venue, routed (Haiku text, Sonnet bulk, Opus photos; 2 msgs/day) | -$2.29 |
| Card fees (Stripe EEA 1.5% + 0.25 EUR) | -$0.70 |
| Speech-to-text (Groq whisper, ~18 voice notes) | -$0.01 |
| **Contribution** (what each venue-month leaves to pay the fixed costs) | **$27.00** (90%) |

## The margin that matters

Fixed costs: $1,112 a month (Supabase Pro ($25) $23, Vercel Pro ($20) $19, Domain, email, misc SaaS (estimate) $10, Accountant for a Bulgarian EOOD (estimate) $60, Founder pay, part-time draw (estimate) $1,000).

- **Break-even: 42 venue-months a day.** Below that you lose money every month.
- **Profit margin at your plan** (60 a day): **28%** of every sale, after every cost.

## Year 1, month by month

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

## What if

| scenario | margin at plan | break-even a day | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 28% | 42 | -$8,484 |
| Price -10% | 20% | 47 | -$9,024 |
| Volume -20% | 13% | 42 | -$9,456 |
| Unit costs +15% | 27% | 42 | -$8,565 |

## Red flags

- Year 1 loses money on operations (-$8,484).
- The startup spend is not earned back within year 1.
