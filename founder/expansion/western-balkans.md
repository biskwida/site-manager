# Site Manager: Western Balkans (non-EU) expansion scan (2026-10-11)

Public sources only, accessed 2026-10-11 unless dated. Rows: `western-balkans.csv`. Bulgarian baseline: `../competitors.md`. **ESTIMATE** = my inference, reasoning given.

## Comparison

| | Serbia | N. Macedonia | Albania | Bosnia & H. | Montenegro | Kosovo |
|---|---|---|---|---|---|---|
| Food-service units (I56) | 18,317 (2024) | 4,615 (2024) | 15,333 (2023) | 9,099 (2024) | 6,855 (2024, section I incl. hotels) | ~9,500 active registrations (ARBK, undated) |
| Firms ≥10 staff with website | 84.6% (2025) | 48.8% (2021) | 60.6% (2025) | 68.0% (2025) | 87.3% (2025) | no data |
| Avg net wage | €1,034 (Jul 2026) | €793 (Apr 2026) | ~€800 **ESTIMATE** | €872 (Jun 2026) | €1,037 (Jul 2026) | €636 (2025) |
| Main messenger | Viber | Viber (old data) | WhatsApp/Viber, unclear | Viber **ESTIMATE** | Viber **ESTIMATE** | Viber (2019 data) |
| Currency | RSD | MKD | ALL | BAM | EUR | EUR |
| Local QR-menu prices/mo | €11–47 | €2.5–119 | €5–15 | €6–51 | €7–80 | €13–15 |
| Restaurant site (agency) | from €240–300 | from €199 | from €250 | from 500 KM (€256) | from €150 | from €595 |
| Recommended price | **€20** | **€15** | **€15** | **€18** | **€20** | **€12** |
| Attractiveness | **7** | 5 | 6 | 5 | 6 | 5 |
| Entry city | Belgrade | Skopje | Tirana | Sarajevo | Podgorica + coast | Prishtina |

Comparison points: Bulgaria has 19,441 I56 units (2024) and 49.7% website share (2025); EU average is 79.0% ([Eurostat sbs_ovw_act](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act?nace_r2=I56&indic_sbs=ENT_NR&geo=BG), [isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT)).

**Caveat:** the website share covers **all-sector firms with 10+ staff**; Eurostat has no food-service or micro-firm breakdown here. Most cafés are micro firms, so **ESTIMATE**: their share is well below these figures.

**Shared findings**
- **Regional competitor: doXmenu.** A Skopje firm (AUTO NESI DOO / Doiks Digital) offers one plan in every country: €12.99/mo billed yearly, €14.99/mo billed monthly. It claims 1,000+ North Macedonian venues ([blog, Sept 2026 data](https://www.doxmenu.com/blog/digital-menus-north-macedonia-restaurants/)) and now targets [Serbia](https://www.doxmenu.com/qr-menu/serbia/), [BiH](https://www.doxmenu.com/qr-menu/bosnia-herzegovina/), [Kosovo](https://www.doxmenu.com/qr-menu/kosovo/) and [Albania](https://www.doxmenu.com/blog/best-qr-menu-albania/). Like all local vendors found, it is an admin-panel menu editor. **No chat-first website product found in any of the six countries.**
- **VAT forces the partner model.** Reverse charge works only when the buyer is VAT-registered. Many cafés are not.
  - Kosovo: an unregistered buyer means the foreign supplier must register through a tax representative ([PwC, rev. 7 Aug 2026](https://taxsummaries.pwc.com/kosovo/corporate/other-taxes)).
  - Serbia: foreign suppliers must register with a fiscal representative unless they sell only to VAT payers ([PwC, rev. 7 Aug 2026](https://taxsummaries.pwc.com/serbia/corporate/other-taxes)).
  - BiH: electronic services need a local tax representative ([PwC, rev. 23 Sep 2026](https://taxsummaries.pwc.com/bosnia-and-herzegovina/corporate/other-taxes)).
  - Fix: **the local partner buys from us B2B (reverse charge) and resells in local currency with a local fiscal invoice.** Also check withholding tax on payments abroad with a local accountant; I did not verify it.
- **Payments.** SEPA transfers are live in Albania, Montenegro and North Macedonia (Oct 2025) and Serbia (May 2026) ([EC, 5 May 2026](https://enlargement.ec.europa.eu/news/commission-welcomes-serbia-joining-sepa-schemes-allowing-faster-and-cheaper-euro-transactions-2026-05-05_en); [Balkan Insight, 22 May 2025](https://balkaninsight.com/2025/05/22/eu-welcomes-serbias-membership-of-single-euro-payments-area/bi/)). I found no SEPA status for BiH or Kosovo. **I could not verify** whether local firms can easily pay a foreign SaaS by business card.
- **Viber is a fixed cost.** It costs ~€100/mo per bot (founder figure), and the product does not support Viber yet. At €20 per venue, the partner keeps €5 and AI costs ~€6.4, leaving €8.6 per venue. **ESTIMATE**: about 12 venues per country pay for the Viber bot. At €12 (Kosovo), about 34 venues are needed.

---

## 1. Serbia (deepest)

**Market.** 18,317 I56 enterprises in 2024 ([Eurostat](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act?nace_r2=I56&indic_sbs=ENT_NR&geo=RS)), almost Bulgaria's size. Belgrade: 8,214 hospitality venues, 2,066 of them cafés, per APR ([Vreme/Euronews, 7 Jan 2023](https://vreme.com/vesti/vasington-post-srpski-kuvari-su-super/)).

**Digital gap.** 84.6% of firms with 10+ staff had a website in 2025 (2023: 85.1%) ([isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT&geo=RS)). Far above Bulgaria; the opening is keeping micro-venue content current.

**Purchasing power.** Average net wage in July 2026 was 121,346 RSD; the median was 95,036 RSD ([Kurir citing RZS](https://biznis.kurir.rs/novcanik/10114914/prosecna-zarada-u-srbiji-za-jul-2026-godine)). At 117.375 RSD/€ (NBS, 8 Oct 2026, [Kurir](https://biznis.kurir.rs/novcanik/10127270/kursna-lista-dinara-za-8-oktobar-2026)) that is about €1,034; €25 is 2.4% of it.

**Messaging.**
- 77% of Serbians used Viber, against 55% for WhatsApp ([Kantar TMG via Diplomacy&Commerce, 2019](https://www.diplomacyandcommerce.rs/?p=35746)).
- A 2025 survey: Viber 79% ([bento.travel, secondary](https://www.bento.travel/serbia/messaging); original deck [unreadable image PDF](https://pravameramedija.rs/vesti/wp-content/uploads/2026/05/Media-Landscape-Srbija-IH-2025.pptx.pdf)).
- Messenger ads reach 2.20M people, 33% of the population ([DataReportal, 8 Nov 2025](https://datareportal.com/reports/digital-2026-serbia)).
- **Viber is mandatory here.**

**Currency, language, legal.** RSD; Serbian (Latin and Cyrillic); VAT 20%; ESIR e-fiscalization mandatory since 1 May 2022 ([Unija](https://unija.com/sr/fiskalizacija-najcesca-pitanja/)). The partner handles VAT and fiscal invoicing.

**Competitors** (monthly):

| Vendor | Price | Note |
|---|---|---|
| [QuickMenu](https://www.quickmenu.rs/price) | 1,290–2,290 RSD (€11–19.5) | Menu only, VAT not stated |
| [Tvoj Konobar](https://www.tvojkonobar.com/) | €0 / €12 / €21 | Menu + ordering, no website |
| [Pixel dizajn](https://pixeldizajn.rs/qr-cenovnik/) | €27 / €47 / €157 + €47 setup | QR price list |
| [qrmenu.rs](https://qrmenu.rs/sr/) | from €29 (search snippet) | Not verified |
| doXmenu | €12.99 | Regional player |

- qrl.rs was **unreachable** (DNS error).
- Agencies: [Digitful](https://izradasajta.digitful.net/) from €240 plus €120/yr hosting; [iiStudio](https://iistudio.rs/cena-web-sajta/) €296 for a full site and €69/yr for a QR menu; [WebKraft](https://webkraft.rs/cenovnik/) from €300.
- Substitutes: Wolt and Glovo (Glovo owns Donesi). There is "no public indicator" that Glovo will leave Serbia ([Biznis.rs, Aug 2026](https://biznis.rs/vesti/srbija/da-li-bi-glovo-posle-bih-mogao-da-napusti-i-srbiju/)).

**Partner candidates.**
- POS/ESIR vendors serving HoReCa: [Petcom Bmaster](https://www.petcom.rs/bmaster) (cafés and restaurants), [mts restaurant software](https://mts.rs/Poslovni/Digitalni-ekosistem/Digitalno-poslovanje/softver-za-ugostiteljstvo), [IntelliPOS Web ESIR](https://www.intellipos.rs/web-esir.html) (from 1,199 RSD/mo), [HARDoffice](https://esir.co.rs/).
- Association: HORES, the hotel and restaurant business association ([Danas](https://www.danas.rs/ekonomija/hores-predlozio-duze-radno-vreme-restorana-u-srbiji-da-ne-bi-bilo-zabava-u-privatnom-prostoru/)).

**Price.** **€20/mo**, setup €149. Menu-only tools sell at €11–47, so €25 is defensible, but €20 undercuts Pixel's mid tier. **ESTIMATE.**

**Verdict: 7/10.**
- Risks: Viber must be built first; doXmenu and cheap local menus; RSD/ESIR compliance depends on the partner.
- Advantages: largest market; wages near Bulgaria's; SEPA since May 2026.
- Entry: **Belgrade**, then Novi Sad.

## 2. North Macedonia

- **Market.** 4,615 I56 units in 2024 ([Eurostat](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act?nace_r2=I56&indic_sbs=ENT_NR&geo=MK)). I found no Skopje figure.
- **Digital gap.** 48.8% website share in 2021, the latest year available ([isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT&geo=MK)).
- **Wage.** 48,779 MKD in April 2026 ([MakStat](https://www.stat.mk/en/stat/population-and-living-conditions/labour-market/average-monthly-net-wage-paid-per-employee/)), about €793 at ~61.5 MKD/€. **ESTIMATE**: de facto peg.
- **Messaging.** A survey of 1,100 people found Viber 92.2%, Messenger 84.4%, WhatsApp 25.5% ([Telegrafi](https://telegrafi.com/en/Macedonian-citizens-use-viber-and-facebook-messenger-a-lot-on-mobile-phones/)). The page returned 402 and search metadata suggests it is about 9 years old, so the data is stale.
- **Legal.** MKD currency, Macedonian (Cyrillic) plus Albanian, VAT 18% ([PwC, rev. 23 Jul 2026](https://taxsummaries.pwc.com/north-macedonia/corporate/other-taxes)). SEPA since Oct 2025.
- **Competitors.**
  - doXmenu, home market, claims 90%+ of digital menus.
  - [Dinerra](https://dinerra.com/): 1,850–5,400 MKD/yr, €2.5–7/mo.
  - [EasyOffer](https://easyoffer.mk/digitalno-meni/): €13 menu, €39–59 with POS.
  - [eBar](https://www.ebar.mk/pages/qr-meni.html): €35–119+ per venue, excl. VAT.
  - Agencies: [MaTox](https://matoxagency.com/dizajn-na-web-strani/) €199–790; [BestNet](https://www.bestnetstudio.com/cenovnik.php) €399–999.
  - Delivery: Wolt (not researched in depth).
- **Partners.** eBar and EasyOffer, as POS + menu vendors that could add our website. I could not find a named HoReCa association.
- **Price:** **€15**. Smallest market, wages about 23% below Serbia's, and doXmenu sets a €13 anchor.
- **Verdict: 5/10.**
  - Risks: doXmenu's home turf; small market; a third script/language.
  - Advantages: low website share; eBar/EasyOffer as channel; SEPA.
  - Entry: **Skopje** (plus Ohrid in season).

## 3. Albania

- **Market.** 15,333 I56 units in 2023 ([Eurostat](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act?nace_r2=I56&indic_sbs=ENT_NR&geo=AL)). That is 547 bars/restaurants per 100k people, about twice the EU average ([Shqiptarja/Monitor, 1 Mar 2023](https://shqiptarja.com/lajm/shqiperia-e-treta-ne-europe-per-numrin-e-larte-te-kafeneve-ia-kalon-spanjes-e-italise)). Tirana holds 46.7% of registered businesses across all sectors ([QKB](https://qkb.gov.al/en/business-in-albania/)).
- **Digital gap.** 60.6% website share in 2025 ([isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT&geo=AL)).
- **Wage.** INSTAT publishes only gross pay: 90,119 ALL in Q1 2026 ([INSTAT](https://www.instat.gov.al/en/themes/labour-market-and-education/wages/publications/2026/wage-statistics-q1-2026/)). **ESTIMATE**: net about 73,500 ALL after 11.2% contributions and 13% income tax above the allowance, which is about €800 at ~92 ALL/€ ([exchange-rates.org, 1 Oct 2026](https://www.exchange-rates.org/exchange-rate-history/all-eur-2026-10-01)). The lek is at record strength ([Gazeta Tema, 11 Aug 2026](https://english.gazetatema.net/economy/euro-falls-to-record-low-against-albanian-lek-i346635)).
- **Messaging.** About 1.2M WhatsApp users and 1.17M Messenger users in 2023 ([Techjury, upd. Sep 2024](https://techjury.net/research/market-share-of-messaging-apps-by-country/)). I found no current Viber figure. **ESTIMATE**: WhatsApp is strong, so we may be able to launch without Viber.
- **Legal.** ALL currency, Albanian language, VAT 20% ([PwC, rev. 22 Jul 2026](https://taxsummaries.pwc.com/albania/corporate/other-taxes)). Software fiscalization requires a certified POS. SEPA since Oct 2025.
- **Competitors.**
  - [MenuZone](https://menuzone.al/): free tier, or 6,500 L (€60) per year.
  - [shiko.menu](https://www.shiko.menu/): €70–120/yr.
  - [easyBar](https://easybar.al/): free menu bundled with its POS.
  - doXmenu: €12.99–14.99/mo.
  - Agencies: [AG Studio](https://agstudio.al/krijim-faqe-interneti/) from €250; [Grow.al](https://grow.al/faqe-interneti-ndertim-website/) from €400.
  - Delivery: [Wolt](https://albaniatech.org/wolt-celebrates-first-anniversary-in-albania-a-year-of-growth-innovation-and-impact/) (700+ partners after its first year, self-reported) and Baboon. Glovo [suspended its Albania launch](https://SeeNews.com/news/glovo-suspends-plans-to-launch-in-albania-855204).
- **Partners.**
  - Certified fiscal/POS vendors: [easyPos](https://easypos.al/llms.txt), [Logic (logibar)](https://www.logic.al/en/logibar/), AED.
  - Association: the Association of Bars, Restaurants and Clubs (representative Enri Jahaj, 2021 coverage, [Telegrafi](https://telegrafi.com/turizmi-ne-shqiperi-vuan-mungesen-e-fuqise-punetore-bizneset-kthejne-syte-nga-rajoni/)).
- **Price:** **€15**. Local menus cost €5–10/mo-equivalent, but tourism venues need multilingual sites.
- **Verdict: 6/10.**
  - Risks: price anchors near zero; lek volatility; unclear which messenger leads.
  - Advantages: venue density and tourism boom; possibly no Viber cost; Albanian localization also serves Kosovo.
  - Entry: **Tirana**, then the coast (Durrës, Vlorë, Sarandë).

## 4. Bosnia and Herzegovina

- **Market.** 9,099 I56 units in 2024 ([Eurostat](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/sbs_ovw_act?nace_r2=I56&indic_sbs=ENT_NR&geo=BA)). No Sarajevo figure found.
- **Digital gap.** 68.0% website share in 2025 ([isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT&geo=BA)). Republika Srpska alone: 63.8% ([RZS RS 2025](https://www2.rzs.rs.ba/static/uploads/saopstenja/informaciono_drustvo/2025/Upotreba_IKT_Preduzeca_2025.pdf)).
- **Wage.** 1,706 KM in June 2026 ([BHAS](https://bhas.gov.ba/data/Publikacije/Saopstenja/2026/LAB_04_2026_06_1_BS.pdf)), €872 at the fixed 1.95583 KM/€.
- **Messaging.** No country survey found. **ESTIMATE**: Viber, based on regional pattern. WhatsApp had 0.92M users and Messenger 1.48M in 2023 ([Techjury](https://techjury.net/research/market-share-of-messaging-apps-by-country/)).
- **Legal.** BAM currency; Bosnian, Croatian and Serbian (Latin and Cyrillic) are mutually intelligible. VAT 17%. E-services need a local tax representative. Two entities have separate fiscal laws. No SEPA status found.
- **Competitors.**
  - [digitalnimeni.ba](https://digitalnimeni.ba/): 39.90–99.90 KM/mo, excl. VAT (€20–51).
  - [qrcode.ba](https://qrcode.ba/): 24.90–44.90 KM/mo (search snippet).
  - [check.ba](https://qr.check.ba/): 139–239 KM/yr.
  - doXmenu: about 25 KM.
  - Agencies: [ZiCoding](https://zicoding.com/blog/izrada-web-stranica/izrada-web-stranica-cijena.html) from 500 KM; [Webizrada](https://webizrada.ba/izrada-web-stranica-cijena-bih) 500–1,700 KM.
  - Delivery: Glovo **left BiH on 10 Aug 2026** ([N1/Capital](https://n1info.rs/biznis/glovo-odlazi-iz-bih-za-pet-godina-napravili-minus-od-15-miliona-maraka/)). Wolt and Korpa status not verified.
- **Partners.** Authorized fiscal-device distributors, which the FBiH law requires ([law](https://fuzip.gov.ba/wp-content/uploads/2022/09/Zakon_o_fiskalnim_sistemima_sl_novine_fbih_broj_81_2009-9.pdf)); none were named in sources. Also "Horeka RS", an RS association mentioned by [Paragraf](https://www.paragraf.ba/dnevne-vijesti/12102023/12102023-vijest3.html).
- **Price:** **€18 (35 KM)**. Wages are about 15% below Serbia's, and digitalnimeni.ba already charges 40–60 KM.
- **Verdict: 5/10.**
  - Risks: two tax and fiscal regimes; e-services representative rule; no SEPA.
  - Advantages: Serbian-variant language reuse; fixed peg to the euro; healthy price anchors.
  - Entry: **Sarajevo** (Banja Luka second, through a Serbian partner).

## 5. Montenegro

- **Market.** 6,855 active entities in section I (accommodation **and** food) in 2024, 11.6% of all entities ([Monstat 2024](https://www.monstat.org/uploads/files/publikacije/registri/Broj%20i%20struktura%20poslovnih%20subjekata%20u%20Crnoj%20Gori%20%202024.god.pdf)). Eurostat has no I56 row for Montenegro. Podgorica had 23,607 active entities across all sectors in 2025 ([Monstat 36/2026](https://monstat.org/uploads/files/publikacije/registri/Broj%20i%20struktura%20poslovnih%20subjekata%20u%20Crnoj%20Gori%20%202026.god_CG.pdf)).
- **Digital gap.** 87.3% website share in 2025, the highest in the region ([isoc_ciweb](https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_ciweb?indic_is=E_WEB&unit=PC_ENT&geo=ME)).
- **Wage.** €1,037 in July 2026 ([Monstat](https://monstat.org/uploads/files/zarade/2026/7/RAD_EN_Jul_2026.pdf)).
- **Messaging.** No data. **ESTIMATE**: Viber.
- **Legal.** EUR currency, Montenegrin (Serbian-variant) language, VAT 21% ([PwC, rev. 7 Aug 2026](https://taxsummaries.pwc.com/montenegro/corporate/other-taxes)). SEPA since Oct 2025. Online fiscalization.
- **Competitors.**
  - [onlinemeni.me](https://www.onlinemeni.me/): €6.99–14.99/mo, or €59 per season (claims 50+ venues).
  - [MenuApp](https://menuapp.me/en): €40–80.
  - Agencies: [izradisajt.com](https://izradisajt.com/izrada-sajtova/) from €150; [vebIT](https://vebit.me/) €300 plus €19/mo.
- **Partners.** None named in sources; candidates: coastal POS dealers, agencies like vebIT.
- **Price:** **€20**, with a seasonal plan. Wages are at Serbian level, and buyers pay in euros.
- **Verdict: 6/10.**
  - Risks: small market; strong seasonality; high existing website share.
  - Advantages: euro with no FX; tourist venues need multilingual menus updated often; Serbian-language reuse.
  - Entry: **Podgorica** plus Budva/Kotor before the season.

## 6. Kosovo

- **Market.** No official I56 count reached.
  - The ARBK registry (third-party mirror, undated) shows 4,768 active restaurants ([5610](https://arbk.atlas-studio.eu/activity/5610)) and 4,733 active beverage-serving businesses ([5630](https://arbk.atlas-studio.eu/activity/5630)): about 9,500 in total.
  - Prishtinë has 4,775 registered in these two activities, including closed ones.
  - An ASK figure of 3,915 for section I (year unclear) via [bpbinfomat](https://bpbinfomat.com/en/articles_and_news/the-number-of-companies-providing-service-activities-in-kosovo-is-increasing-key-success-factors-for-service-companies/) (**403, unreachable**).
  - **ESTIMATE**: about 4,000–9,500 real venues.
- **Digital gap.** Kosovo is not in Eurostat's isoc_ciweb data; no ASK figure found.
- **Wage.** €636 net in 2025 ([ASK](https://askapi.rks-gov.net/Custom/6710f2b6-7a5e-48cd-bded-80d9df03c8b7.pdf)), the lowest in the region.
- **Messaging.** Viber 85%, WhatsApp 43% ([STIKK, Oct 2019](https://stikk.org/wp-content/uploads/2019/11/STIKK_IK_Report_Internet_Penetration_V3-final-1.pdf)).
- **Legal.** EUR currency, Albanian and Serbian languages, VAT 18%. Selling to unregistered buyers requires registering through a tax representative, so a partner is essential. No SEPA status found.
- **Competitors.**
  - doXmenu: €12.99–14.99. No local menu vendor found.
  - Agencies: [Hostinkos](https://hostinkos.com/shqiperi/) from €595.
  - Delivery: Wolt reached ~750 active businesses in its first year ([Telegrafi](https://telegrafi.com/viti-i-pare-i-wolt-ne-kosove-dy-qytete-me-shume-se-nje-mije-partnere-dhe-mbeshtetje-direkte-per-ekonomine-lokale/)).
- **Partners.**
  - Shoqata e Gastronomëve të Kosovës, the Kosovo gastronomers' association (chair Petrit Kllokoqi in 2021 coverage, [Telegrafi](https://telegrafi.com/kllokoqi-sektori-gastronomise-eshte-duke-e-vuajtur-kete-pandemi-kerkojme-mbeshtetjen-e-shtetit/)).
  - [FISKO](https://www.cbinsights.com/company/fisko), a cloud fiscal POS.
- **Price:** **€12**. Wages are 38% below Serbia's. At this price, margin after the partner's share and AI cost is about €2.6 per venue. **ESTIMATE.**
- **Verdict: 5/10.**
  - Risks: thin margin; Viber cost; VAT rule.
  - Advantages: euro; reuses the Albanian localization; a diaspora-season tourism spike.
  - Entry: **Prishtina**, bundled with Albania.

## Recommended sequence

1. **Serbia**: build Viber, sign a Belgrade POS/ESIR partner.
2. **Montenegro**: same language and bot, euro.
3. **Albania + Kosovo**: one Albanian launch, WhatsApp-first test in Albania.
4. **BiH, North Macedonia**: opportunistic, via POS vendors.
