# Import from Randevue

The wizard's Menu step can read a venue's menu straight from its [Randevue](https://randevue.app) page (the Bulgarian QR table-ordering platform) instead of menu photos. The owner pastes the link from a table's QR code, the server reads the page, and the result lands in the same review step as a photo extraction: nothing is inserted until the owner ticks and accepts. No model call is made, so the import is free and takes a few seconds.

Code: `src/wizard/randevue.ts` (pure parser and mapping), `src/server/wizard-randevue.ts` (the route handler), `app/api/new/[id]/randevue/route.ts`, `src/server/item-images.ts` (product photos after publish). Tests: `test/wizard-randevue.test.ts`, `test/wizard-randevue-route.test.ts`, fixtures in `test/fixtures/randevue/`.

## What the owner gets

- Every category and product with name, description, price (EUR), allergens and the product photo, in Bulgarian and English.
- A product Randevue does not show right now (the owner took it off sale, and it is not sold out) comes in **unticked**; the note above the list says how many. A product sold out until a date still in the future shows a **Sold out** badge and keeps that date on the published site.
- The venue's name fills an empty name in Basics; its opening hours replace the default hours when the owner has not changed them yet. The logo and cover URLs are returned by the route but not used yet.
- After **Create my site**, the product photos are copied into the venue's media in the background (`src/server/item-images.ts`), as one "Photos from Randevue" change set. A full menu (165 photos) takes under a minute; the site is live before that.

## The page format (undocumented, observed 2026-10-15)

`https://randevue.app/<locale>/<uuid>` is a Next.js App Router page; the uuid is a table (`floorPlanObject`). The whole venue dataset is in the React Flight payload the server streams as `<script>self.__next_f.push([1,"…"])</script>` chunks. Concatenated, the chunk strings form lines `<hex id>:<payload>\n`; lines starting with `I[` (imports), `T` (text), `HL` (hints) are skipped, the rest are JSON. The importer looks for:

| Where (by key, not position) | What |
|---|---|
| `productsByCategories: [{ id, name, products: [...], localizations }]` | categories in menu order (seen on line `3c`) |
| `products[]`: `id, name, description, price, priceCurrency, allergens[{ name, code }], image{url}, bigImage{url}, soldOutUntilDatetime, newUntilDatetime, deletedAt, isActive, productType, localizations` | one product |
| `commercialEntity: { name, description, timeZone, currency, logoImage{url}, settings.metadata.weeklyWorkingHours }` | the venue (line `14`) |
| `floorPlanObject: { name }` | the table ("Маса 34") |
| `supabaseImage: { url }` | the cover image |

Things worth knowing:

- **Languages.** Top-level texts are in the URL's locale; `localizations` carries only the other, non-default locale and only where the venue translated it (127 of 195 products had a `bg-BG` entry on the en-GB page). So the server fetches **both** `bg-BG` and `en-GB` pages and pairs products by id. When one page fails, the other still works and the missing language is filled from the one we have.
- **Allergen codes are not EU codes.** Randevue's `"2"` is eggs and `"3"` is milk (EU: 2 crustaceans, 3 eggs). The importer maps the allergen **name** (either language) to the EU code; the existing keyword suggestions from the photo extraction are merged in afterwards, as for photos.
- **Visibility.** Randevue shows a product when `isActive` is true or `soldOutUntilDatetime` is in the future (shown with "Изчерпан"); everything else is hidden. The import mirrors that with the unticked default.
- **Hours are UTC** (`"start": { "time": "05:00" }` = 08:00 in Sofia). Converted with the venue's `timeZone` on the day of the import; a DST change can shift them by an hour, which the owner sees in the Hours step.
- **Images** live on a public Supabase bucket (`https://<project>.supabase.co/storage/v1/render/image/public/...`). Only https URLs on `*.supabase.co/storage/v1/` are accepted anywhere (review thumbnails, draft, download).
- Descriptions contain `\r\n` and padding; names have trailing spaces ("Десерти "); one English name had a Cyrillic "е" in it. The parser normalises whitespace and otherwise imports texts as they are.
- `scalarQuantity` / `scalarQuantityUnit` (0.3 liter, 450 gram) and `productOptionCategories` (sizes, extras) are not imported yet.

## Limits and fallback

- Link validation: https, host exactly `randevue.app`, path `/<locale>/<uuid>` or `/<uuid>`. Anything else is a 400 with a bilingual message.
- The server fetches only the two canonical page URLs, never follows redirects, times out after 15 s and stops reading a page over 4 MB. 20 imports per draft per hour.
- When neither page carries the dataset (network error, a changed format, an error page), the route answers 502 `randevue_error`: "Could not read this Randevue page. Use menu photos instead." / "Не успяхме да прочетем тази страница от Randevue. Качете снимки на менюто вместо това." The photo/PDF extraction stays as the fallback.
- The format can change without notice. `test/fixtures/randevue/` holds the real pages of 43.12 Café Sofia (both locales, trimmed to the two flight lines the importer reads); regenerate them by saving the pages again if the parser stops finding the payload.
