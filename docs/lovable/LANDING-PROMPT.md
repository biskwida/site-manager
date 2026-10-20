# Lovable landing: prompt pack

> **Superseded 19 Oct 2026: the landing now lives in the app** (`app/(landing)/`, copy in `src/landing/copy.ts`). Kept as history only.

The public marketing landing for Site Manager is built in Lovable. This file is the prompt for it.

How to use it:

1. Replace every `{{APP_URL}}` below with the app's address, `<PUBLIC_BASE_URL>` without a trailing slash (today `https://site-manager-lovat.vercel.app`, so the button goes to `https://site-manager-lovat.vercel.app/new`), and every `{{DEMO_URL}}` with the demo café's address, `<PUBLIC_BASE_URL>/agala` (today `https://site-manager-lovat.vercel.app/agala`). If you do not know them yet, leave the placeholders and ask Lovable to swap them later (step 5).
2. Copy everything from "PROMPT START" to "PROMPT END" and paste it into a new Lovable project as the first message.
3. When Lovable is done, check the page against section 2 word for word, then publish and follow section 5.

The copy in section 2 is taken verbatim from `landing.*` in `src/i18n/dicts.ts` (the demo text link is `nav.demo`). If you change the copy there, change it here too.

---

<!-- PROMPT START -->

## 1. What to build

Build a single-page, bilingual marketing landing for **Site Manager**, a service that gives a café a website the owner runs from Telegram. The page has a Bulgarian/English language toggle: English is the default on the first visit, the visitor's choice is remembered in `localStorage` and restored on the next visit, `?lang=bg` or `?lang=en` in the URL overrides it, and the `<html lang>` attribute follows the current language. Switching language swaps every visible string on the page instantly, without a reload. Mobile-first: design for a 375 px wide phone first, then widen to a centred column of about 900 px on desktop. This is a static page: no backend, no database, no authentication, no forms, no newsletter signup, no contact section, no chat widget. There is exactly one call to action, the primary button "Create your site →" (Bulgarian: "Създайте сайта си →"), which links to `{{APP_URL}}/new`. Under the button and its note there is one plain text link, "See the demo café" (Bulgarian: "Вижте демо кафенето"), to `{{DEMO_URL}}`: a link in the accent colour, not a second button. At the very bottom, add a small footer line "Landing built with Lovable · product by Site Manager" (its Bulgarian version is in section 2.8).

Sections, top to bottom: header, hero, how it works, what the bot can do, price block, how it was built, footer. Use exactly the copy in section 2 and nothing else.

## 2. Copy, in both languages

Use these strings exactly as written, including the typographic quotes („…“ in Bulgarian, “…” in English), the euro sign after the number with a space ("25 €"), the "→" arrows and the emoji. Do not shorten, rephrase, translate or add words. Each item shows the English (EN) and the Bulgarian (BG) text for the same element. One English string deliberately contains Bulgarian (the example message in step 1, “Капучиното става 3,20”): keep it in Bulgarian, it shows what the owner actually types.

#### 2.1 Browser tab title

**English (EN)**

- Page title: Site Manager: your café's website, run from Telegram

**Bulgarian (BG)**

- Page title: Site Manager: сайтът на вашето кафене, управляван от Telegram

#### 2.2 Header

Left: the brand name **Site Manager** (same in both languages, display font, semibold). Right: the language toggle, a two-option segmented pill with the labels **БГ** and **EN** (Bulgarian first). The toggle group's accessible label is "Language" in English and "Език" in Bulgarian; each button carries `lang` for its own language, `aria-pressed` for the active one and a screen-reader name in its own language ("български", "English").

#### 2.3 Hero

The primary button links to `{{APP_URL}}/new` (same tab); the text link under the note links to `{{DEMO_URL}}` (same tab). Keep the arrow at the end of the button label.

**English (EN)**

- Eyebrow (small uppercase line above the headline): For cafés and small restaurants
- Headline (H1): Your café's website, managed by chat.
- Lead paragraph: We build your site and give you a Telegram bot. Text it, send a voice note or a photo, in Bulgarian or English, and the site changes: prices, sold-out dishes, today's specials, hours, holidays, photos. Every change is previewed, approved with one tap, logged and undoable.
- Primary button: Create your site →
- Note under the button: Three designs, your menu from a photo, online in minutes. Then you run it from Telegram.
- Text link under the note: See the demo café

**Bulgarian (BG)**

- Eyebrow (small uppercase line above the headline): За кафенета и малки ресторанти
- Headline (H1): Сайтът на вашето кафене, управляван с едно съобщение.
- Lead paragraph: Правим ви сайт и ви даваме Telegram бот. Пишете му, пратете гласово или снимка, на български или английски, и сайтът се променя: цени, изчерпани ястия, днешни предложения, работно време, почивни дни, снимки. Всяка промяна се вижда предварително, потвърждава се с едно докосване, записва се и може да се върне.
- Primary button: Създайте сайта си →
- Note under the button: Три дизайна, менюто от снимка, онлайн за минути. После го управлявате от Telegram.
- Text link under the note: Вижте демо кафенето

#### 2.4 How it works

Three numbered cards (1, 2, 3) in a row on desktop, stacked on mobile. Show the number large in the display font and the accent colour. Keep the emoji in step 2 exactly as written; they are the bot's real button labels.

**English (EN)**

- Section heading (H2): How it works
- Step 1 title: You message the bot
- Step 1 text: “Капучиното става 3,20”, a voice note, or a photo of the specials board.
- Step 2 title: You see the change before it goes live
- Step 2 text: The bot shows exactly what will change, in your language. ✅ Apply, ✏️ Change, or ❌ Cancel.
- Step 3 title: The site updates in seconds
- Step 3 text: Sold-out dishes grey out and come back on their own. Specials expire at closing. Everything is in a log you can undo.

**Bulgarian (BG)**

- Section heading (H2): Как работи
- Step 1 title: Пишете на бота
- Step 1 text: „Капучиното става 3,20“, гласово съобщение или снимка на дъската с предложенията.
- Step 2 title: Виждате промяната, преди да е на сайта
- Step 2 text: Ботът показва точно какво ще се промени, на вашия език. ✅ Приложи, ✏️ Промени или ❌ Откажи.
- Step 3 title: Сайтът се обновява за секунди
- Step 3 text: Изчерпаните ястия посивяват и се връщат сами. Предложенията изтичат при затваряне. Всичко се записва в дневник и всяка промяна може да се върне.

#### 2.5 What the bot can do

Six items in a two-column grid on desktop, one column on mobile, each a soft paper-deep tile with a small accent dot (decorative, hidden from screen readers).

**English (EN)**

- Section heading (H2): What the bot can do
- Feature 1: Prices and texts, one dish or all of them at once, with rounding
- Feature 2: Sold out until tomorrow's opening, automatically back
- Feature 3: Today's specials from a photo of the board
- Feature 4: Opening hours, holidays and announcements, scheduled in advance
- Feature 5: Cover, logo, dish and gallery photos
- Feature 6: New dishes with bilingual descriptions and an allergen check

**Bulgarian (BG)**

- Section heading (H2): Какво може ботът
- Feature 1: Цени и текстове, едно ястие или всички наведнъж, със закръгляне
- Feature 2: Изчерпано до утрешното отваряне, връща се автоматично
- Feature 3: Днешните предложения от снимка на дъската
- Feature 4: Работно време, почивни дни и съобщения, насрочени предварително
- Feature 5: Корица, лого, снимки на ястия и галерия
- Feature 6: Нови ястия с описания на два езика и проверка за алергени

#### 2.6 Price block (dark)

One dark block: ink background, paper-coloured text, rounded-3xl. Keep every name and amount in the last paragraph exactly as written.

**English (EN)**

- Price (large, display font): 25 € a month per venue
- Note under the price: Website hosting and the agent, setup included.
- Paragraph below a thin divider: Before we had a product, four venues told us what they would pay a month: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 €.

**Bulgarian (BG)**

- Price (large, display font): 25 € на месец за обект
- Note under the price: Включени са хостингът на сайта, агентът и настройката.
- Paragraph below a thin divider: Преди да имаме продукт, четири заведения ни казаха колко биха плащали на месец: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 €.

#### 2.7 How it was built

**English (EN)**

- Paragraph (muted text): Built for the “AI That Does the Work” hackathon with Claude. The AI reads casual Bulgarian, voice and handwriting; we built the site, the content model, the approval step, the scheduler, the log and the multi-venue plumbing.

**Bulgarian (BG)**

- Paragraph (muted text): Създадено за хакатона „AI That Does the Work“ с Claude. Изкуственият интелект разбира разговорен български, глас и почерк; ние направихме сайта, модела на съдържанието, стъпката за одобрение, насрочването, дневника и инфраструктурата за много обекти.

#### 2.8 Footer

**English (EN)**

- Footer line 1: Site Manager · a website your café runs from Telegram

**Bulgarian (BG)**

- Footer line 1: Site Manager · сайт, който кафенето ви управлява от Telegram

Below it, a second, smaller footer line:

**English (EN)**

- Footer line 2: Landing built with Lovable · product by Site Manager

**Bulgarian (BG)**

- Footer line 2: Страницата е направена с Lovable · продукт на Site Manager

## 3. Design

Colour tokens (define them once as CSS variables or Tailwind theme colours and use only these):

| Token | Hex | Use |
| --- | --- | --- |
| paper | `#faf7f2` | page background |
| paper-deep | `#f1ebe1` | feature tiles |
| card | `#fffdf9` | step cards, language toggle background |
| ink | `#1d2a24` | body text, price block background |
| ink-soft | `#4b5a53` | secondary text (lead, notes, step text, footer) |
| accent | `#2f6b4f` | primary button background (white text), eyebrow, step numbers, feature dots, focus ring |
| amber | `#8f5c10` | sparing highlight only, never for body text on a dark background |

Fonts, from Google Fonts, both with the `latin` and `cyrillic` subsets (the Bulgarian text must render in these fonts, not a fallback):

- **Literata** (display): the brand name, all headings (H1, H2, step titles), the step numbers and the price. Semibold. Use its optical-size axis at a large setting for headings if available.
- **Onest** (body): everything else, including buttons.

Layout and style:

- Off-white paper background with generous whitespace; large H1 (about 36 px on mobile, 60 px on desktop, tight line height); lead paragraph at about 18 px in ink-soft, max width about 40 em.
- Cards and blocks with `rounded-3xl` corners; step cards on the card colour with a hairline ink border at 10 % opacity; no heavy shadows.
- The primary button is a fully rounded pill in the accent colour with white, semibold text, at least 44 px tall.
- The price block is a dark block: ink background, paper text, the price large in Literata, a thin divider at 20 % paper opacity above the last paragraph.
- A faint, soft green radial glow in the top-right corner and a faint warm one in the bottom-left of the page background are welcome; keep them subtle.
- A gentle fade-and-rise entrance for the hero only (about 0.5 s). Respect `prefers-reduced-motion: reduce` by turning all motion off.
- No images are required. If you add any decoration, keep it abstract (shapes, a phone-chat illustration made of plain UI elements) and in the palette.

Accessibility (WCAG 2.1 AA):

- Text contrast at least 4.5:1 (3:1 for text 24 px and above); the tokens above meet this in the combinations listed.
- A visible focus ring on every interactive element: 3 px solid accent, 3 px offset.
- Semantic structure: one H1, H2 for each section heading, H3 for step titles, the steps as an ordered list, the features as a list; the toggle is a `group` of two buttons with `aria-pressed`.
- Every interactive element is reachable and usable by keyboard; touch targets at least 44 × 44 px.

## 4. Rules

- Use only the copy in section 2. Do not invent taglines, statistics, customer counts, ratings, testimonials, quotes, FAQs, partner logos, awards or contact details (no email, phone, address or social links).
- No stock photos of people, no AI-generated faces, no photos of real cafés.
- No invented numbers. The only numbers on the page are those in the copy: 25 € a month, the four venues and their amounts, and "3,20" in step 1.
- Keep the four venue names and amounts exactly as written: Bar and Dinner Central 30 €, Coffique 20 €, Family House 50 €, The High End Bar 70 €. Do not turn them into testimonials, logos or quotes.
- One call to action only, the primary button to `{{APP_URL}}/new`, plus the single text link to `{{DEMO_URL}}` under it. No second button, no "Sign up", "Book a demo" or "Contact us".
- Both languages must be complete: no string may stay in English when Bulgarian is selected, except the brand name "Site Manager", "Telegram", "Claude", "Lovable", the venue names and the hackathon name, which stay as written.
- No cookie banner, analytics or third-party scripts.

<!-- PROMPT END -->

---

## 5. After it is published

1. If the button or the link still show a placeholder, ask Lovable: "Change the primary button link to `<PUBLIC_BASE_URL>/new` and the demo text link to `<PUBLIC_BASE_URL>/agala`", with your real address (today `https://site-manager-lovat.vercel.app`), and publish again. Open the published page: the button must land on the template chooser, the link on the demo café.
2. Check both languages on a phone: toggle БГ / EN, reload, and confirm the choice is remembered.
3. Copy the published Lovable URL (it must start with `https://`) and set it as `NEXT_PUBLIC_LANDING_URL`:
   - Vercel: Project → Settings → Environment Variables → `NEXT_PUBLIC_LANDING_URL` = the Lovable URL (Production and Preview), then redeploy. `NEXT_PUBLIC_*` values are baked in at build time, so the change takes effect only after a new deployment.
   - Locally: `npm run env:set -- NEXT_PUBLIC_LANDING_URL` (or edit the line in `.env.local`), then restart `next dev`.
4. Open `<PUBLIC_BASE_URL>/`: it now redirects to the Lovable landing. With the variable empty, `/` shows the built-in fallback landing with the same copy.
