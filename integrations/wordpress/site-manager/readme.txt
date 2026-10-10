=== Site Manager ===
Contributors: sitemanager
Tags: restaurant, cafe, menu, opening hours, telegram
Requires at least: 6.5
Tested up to: 6.8
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Shows your café's menu, specials, opening hours, announcements and photos from Site Manager, and lets the Site Manager agent edit this site after you connect it from Telegram.

== Description ==

Site Manager is a website for a café or restaurant that the owner runs from Telegram. If you already have a WordPress site, this plugin keeps it in step:

* Shortcodes and blocks show the live menu (prices, allergens, sold-out marks), today's specials, the open-now status and opening hours, upcoming closures, announcements and the photo gallery. Bulgarian and English.
* After you connect the site from the plugin's settings page (one code, one Telegram message), the agent can also change page text, upload photos, update the site title, logo and navigation menus, and WooCommerce product prices. Every change is shown to you in Telegram first; nothing is published until you tap ✅, and every change can be undone.

Site Manager: Вашето кафене има сайт, който управлявате от Telegram. Плъгинът показва живото меню, предложенията, работното време, съобщенията и снимките на вашия WordPress сайт и, след свързване, позволява на агента да редактира страниците му с ваше одобрение.

== Installation ==

1. Upload the zip under Plugins → Add New → Upload Plugin and activate it.
2. Open Settings → Site Manager and paste the two values from your Site Manager dashboard: the Site Manager address and your venue code. Press "Check connection".
3. Add a "Site Manager" block to a page or paste a shortcode such as `[site_manager_menu]`.
4. Optional, to let the agent edit this site: press "Generate code" on the same page and send the bot the line it shows (`/connect https://your-site.com CODE`).

== Frequently Asked Questions ==

= Does the plugin change my site on its own? =

No. Reading is one way (your site reads Site Manager). Writing happens only after you connect the site and approve each change in Telegram. You can disconnect at any time from the settings page.

= What does the plugin store? =

Your two settings, a cached copy of the feed, and, once connected, a hash of the connection token (never the token itself) plus a short log of API calls.

== Changelog ==

= 0.1.0 =
* First release: read blocks and shortcodes, connect flow, page/media/option/menu/product write channel.
