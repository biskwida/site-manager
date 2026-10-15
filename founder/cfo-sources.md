# CFO sources (2026-10-11)

| input | value | source |
| --- | --- | --- |
| Price | 25 €/venue/month excl. VAT | Founder's list price; four venue quotes 20/30/50/70 € (conversations, not contracts) |
| Claude AI per venue | 2.29 € | **Estimate**, routed by message type: plain text → Haiku 5.5 ($0.10/$0.50 per M tokens, cache reads $0.01), bulk/scheduling → Sonnet 5.5 ($2/$10, cache $0.20), photos → Opus 5.5 ($4/$20, cache $0.20); 1 in 10 Haiku turns redone on Opus (estimate). Token sizes per turn from the founder's calculator (https://claude.ai/artifact/JZFAvWYcKvSFxDcVYDK224): text 30k in (18k cached) / 2.5k out, photo 38k / 5k, bulk 34k / 4k; 60 turns a month, 15% photos, 5% bulk; USD→EUR 0.92. Per turn: text 0.012 € (incl. fallback share), bulk 0.070 €, photo 0.169 €. Month ≈ 2.30 € incl. voice. All-Opus was 6.40 € (kept in `numbers-all-opus.json`) |
| Card fees | 0.63 € | Stripe standard EEA cards 1.5% + 0.25 € (https://stripe.com/pricing — check current rate) |
| Speech-to-text | 0.01 € | Groq whisper-large-v3 $0.111/hour, 18 notes × 15 s (calculator) |
| Supabase Pro | 23 € | $25/month (https://supabase.com/pricing) |
| Vercel Pro | 19 € | $20/user/month; Hobby is non-commercial only (https://vercel.com/pricing) |
| Domain, email, misc | 10 € | **Estimate** |
| Accountant | 60 € | **Estimate** for monthly bookkeeping of a small Bulgarian EOOD; get a real quote |
| Founder pay | 1,000 € | **Estimate**: a part-time draw. The founder sets this; it moves break-even more than anything else |
| Startup items | 500 € total | **Estimates**; the product is already built, so no build cost is counted (the founder's time was not paid) |
| Ramp (paying venues by month) | 1 → 31 | **Estimate** built from the board conditions (≥3 paying by day 60, ≥10 by month 4) and then ~3 new venues/month from door-to-door + referrals. The buyer panel (1 in 10 in wave 1) says a pitch converts poorly cold, so this assumes the founder visits ~30 venues a month |
| Setup fee | 199 € per new venue, nets 195.41 € | Founder's choice; card fee 1.5% + 0.25 € = 3.23 €; wizard AI ≈ 0.35 € (**estimate**: menu extraction from 3 photos plus generated texts on Opus 5.5). Calculated beside the CFO tool, which has no one-off revenue line |
| Plan | 60 paying venues | **Estimate**: a target a solo founder could serve in year 2 |

Not counted: VAT (20% on top of the price in Bulgaria for a VAT-registered company; mandatory registration above the threshold), income tax (10% corporate in Bulgaria), Viber (≈100 €/month if added), Google Business Profile API (free), per-venue custom domains (paid by the venue on Pro).
