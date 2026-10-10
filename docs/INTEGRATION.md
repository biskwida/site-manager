# Works with your existing WordPress site

Site Manager manages a café's website from Telegram. If the café already has a WordPress site, the **Site Manager plugin** keeps it in step in two directions:

1. **Reading (always on once configured).** Shortcodes and Gutenberg blocks show the live menu, today's specials, the open-now status and opening hours, upcoming closures, announcements and the photo gallery, in Bulgarian or English. The plugin reads the public feed `GET <Site Manager address>/api/site/<venue code>`, caches it for 30 seconds and keeps the last good copy for a day, so a Site Manager outage never breaks the page.
2. **Writing (after one `/connect`).** The Telegram agent can change page text, upload photos, set the site title, tagline, logo and icon, replace navigation menus and update WooCommerce products. Every change is a Site Manager change set: the owner sees a preview (with a link that renders the pending page on the real site), taps ✅, and can undo it later. Nothing is written to the site before the tap.

This document covers WordPress only; the embed snippet for other platforms, Google Business Profile and the GitHub connector are planned (see `docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md`).

## Install (owner)

1. On the Site Manager dashboard (`/admin/<venue>?key=…`), open the **WordPress** card and download `site-manager.zip` (also at `<Site Manager address>/wp/site-manager.zip`).
2. In WordPress: Plugins → Add New → Upload Plugin → activate. Requires WordPress 6.5+ and PHP 8.1+.
3. Settings → Site Manager: paste the **Site Manager address** and the **Venue code** from the card, Save, then **Check connection** (it names the venue and counts the menu items).
4. Add blocks (search "Site Manager" in the editor) or shortcodes:

| Shortcode | Shows |
|---|---|
| `[site_manager_menu]` | categories, items, prices, allergen codes with a legend, sold-out marks |
| `[site_manager_specials]` | today's specials (nothing when there are none) |
| `[site_manager_hours]` | open now / opens at / closed until, the week's hours, upcoming closures, address, map, phone, Instagram |
| `[site_manager_announcements]` | current announcements (nothing when there are none) |
| `[site_manager_photos]` | the gallery |
| `[site_manager_text key="welcome"]` | one text: `welcome`, `footer_note`, `tagline`, `about`, `address`, `phone`, `instagram`, `name` |

Add `lang="bg"` or `lang="en"` to force the language; the default is the venue's language (changeable on the settings page). The HTML uses `.sm-*` classes and the venue's accent as `--sm-accent`; the plugin's stylesheet inherits the theme's fonts.

## Connect (owner, optional)

1. Settings → Site Manager → **Generate code**. The page shows one line, valid for 15 minutes.
2. Send that line to the bot: `/connect https://your-site.com CODE`.
3. The bot confirms. From now on, ask it things like "Смени текста на страницата „За нас“: …", "Качи тази снимка на началната страница", "Смени името на сайта на …", "Добави „Обяд“ в менюто на сайта под „Меню“". Menu, prices, hours, specials and announcements still go through the normal Site Manager flow; the plugin shows them.
4. **Disconnect** at any time from the same settings page or from the dashboard card. The blocks keep working.

## What the agent can and cannot edit

- **Pages:** Gutenberg and Classic editor pages, Divi (shortcodes in the content) and Elementor (text inside the builder data). Edits are exact text replacements (the agent copies the text it replaces from the page) or a full new content. Elementor pages get no preview link (the Telegram preview shows the diff instead). Pages built with other page builders are listed but refused.
- **Photos:** uploaded to the media library at approval time, optionally as a page's featured image, or inserted into page content. Undo deletes them again.
- **Site title, tagline, logo, site icon.** Navigation menus are replaced wholesale (custom links and page links; CSS classes on items are not kept).
- **WooCommerce:** name, regular and sale price, stock status and descriptions of products.
- **Not editable:** theme options other than the logo, widgets, plugins, users, comments, anything that needs code.

## Security

- The plugin's REST routes (`/wp-json/site-manager/v1/*`) require `Authorization: Bearer <token>`; the token is created during the handshake, returned once, and stored **hashed** in WordPress and **encrypted** (AES-256-GCM, `DESTINATION_SECRET_KEY`) in Site Manager. The handshake is bound to the venue code and the code expires after 15 minutes; 5 handshake attempts per minute per IP, 120 API calls per minute otherwise; every call is logged on the settings page (last 50).
- Writes run as the WordPress admin who generated the code; disconnecting (either side) stops them at once.
- Site Manager accepts only `https://` addresses of public sites: it refuses private and local addresses, also when the site's name resolves to one, and it never follows a redirect from the site (send the final address, for example with `www`). Plain `http://` and local hosts (`localhost`, `127.0.0.1`, `[::1]`, `host.docker.internal`, `*.localhost`) are accepted only by the in-memory development server (`SITE_MANAGER_STORE=memory`) and the Docker smoke test.
- The public feed never contains admin data; the plugin never sends anything to Site Manager except the handshake.

## Run the checks (developers)

| Command | What |
|---|---|
| `npm test` | includes the fake-plugin tests (`test/fake-wordpress.ts`), the feed-field contract and translation guards, the zip guard |
| `npm run wp:lint` | `php -l` on every plugin file (Docker `php:8.3-cli`) |
| `npm run wp:test` | the plugin's pure PHP logic against `integrations/wordpress/tests/fixtures/feed.json` |
| `npm run wp:i18n` | regenerates `languages/site-manager-bg_BG.l10n.php` and `.mo` from the `.po` |
| `npm run wp:zip` | rebuilds `public/wp/site-manager.zip` (commit it) |
| `npm run wp:smoke` | Docker WordPress + MySQL: install, render blocks from the production feed, handshake, preview, apply, undo, options, menus, rate limit, log; `-- --keep` leaves it running at http://localhost:8088; `-- --feed http://host.docker.internal:3000` uses `npm run dev:offline` as the feed. Host ports 8088 (WordPress) and 8080 (the photo served to WordPress; core's `wp_http_validate_url()` allows external hosts only on 80, 443 and 8080) must be free |

## Known limitations (0.1.0)

- Editor UI strings of the blocks are English in a Bulgarian admin (no JavaScript translation files yet); the rendered blocks are bilingual.
- Menu items are recreated on every menu change, so item CSS classes and link targets are lost.
- Page previews use `?sm_preview=<key>`; themes that do not call `wp_body_open()` show the pending content without the yellow banner.
- WooCommerce variations are not supported; simple products only.
- Retries of a failed push (the site was down) run only with the tick: on the owner's next message to the bot and at the daily cron (03:00 UTC), or every 5 minutes with `supabase/cron.sql` or a Pro cron. "Will retry" can therefore mean hours; after five failed attempts the dashboard card shows the error.
- Pushes to one site run strictly in order: a set that failed (site down) is retried before any newer set or undo is pushed, so the last approved change wins. A manual WordPress edit made between a proposal and a late retry of that proposal is overwritten by the retry.
