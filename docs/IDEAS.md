# Ideas backlog (not built)

- **Template-first onboarding (2026-10-10, user's note):** instead of hand-building each venue's site, make the site from a template (venue picks a template, we deploy it, then the Telegram agent takes over the content). Would turn setup into minutes and make the 25 €/month price pure margin after the first month. **Picked up:** this is the wizard at `/new` ([templates spec](superpowers/specs/2026-10-10-site-manager-templates-design.md)).
- **Market research (2026-10-10, user's note):** needed before scaling: how many cafés/restaurants in Sofia (then Bulgaria) have no site or a stale one, what they pay today (Facebook page only, agency sites, Wix/Squarespace), who else sells "website + management" to venues, and willingness to pay beyond the four quoted venues (20–70 €/month).

## Parked 2026-10-10: integrations for sites we did not build

Decision: the first product is template-first onboarding with our own hosting (the wizard at `/new`, see [the templates spec](superpowers/specs/2026-10-10-site-manager-templates-design.md)). The research and design for managing a venue's *existing* site from Telegram is kept for after the templates ship. Full design, file lists and task order: [docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md](superpowers/specs/2026-10-10-site-manager-integrations-design.md).

Research (2026-10-10): WordPress runs about 42 % of all websites and 65–87 % of CMS sites in Bulgaria; about 63 % of Bulgarian sites use no CMS (custom, agency, static, AI-built); Shopify about 5 % globally but negligible in Bulgaria; Wix about 4 % globally, about 3 % in Bulgaria. Every venue has a Google Business Profile.

Direction: pull first, then the deepest access each platform allows. Every write path keeps the existing preview → one-tap approval → log → undo flow, and destination secrets stay encrypted, server-only and unlogged.

1. **Generic embed + JSON feed docs.** Iframe-safe `/embed/<slug>/<block>` pages (menu, specials, hours, announcements, photos, texts) and a tiny `embed.js` that injects them; documented feed for developers and a Lovable/Claude prompt for AI-built sites. Covers Wix, Squarespace, Joomla, Drupal, custom and AI-built sites, live sections only.
2. **WordPress plugin.** Read blocks and shortcodes rendered from the feed first, then a write channel: the owner sends `/connect <code>`, the plugin exposes a token-protected REST surface (pages with revisions, media, allow-listed options, menus, WooCommerce products) and the agent's WordPress tools produce ordinary change sets, so Apply publishes and Undo restores the revision.
3. **Google Business Profile push.** The first "destination": after a change set is applied, hours, holiday hours and specials/announcements (as posts) are pushed, retried by the tick. Needs Business Profile API access approval and OAuth per venue; runs in dry-run until approved.
4. **GitHub connector.** For custom and AI-built sites in a repository with auto-deploy: a GitHub App on one repo; the agent hands a request to a sandboxed coding agent, the result is a pull request with a preview URL; Apply = squash-merge with green checks, Cancel = close, Undo = revert.
5. **Shopify and Wix apps.** To-do only: two app stores with their own review for a thin slice of venues (Wix has no page-text API).

Market coverage (Bulgarian café and restaurant sites; global in brackets), from the integrations spec:

| Level of change the agent can make | Platforms | Share of sites with a website |
|---|---|---|
| Everything (text, photos, pages, layout, menu, hours) | WordPress plugin; GitHub connector | ~35–45 % (~50–55 %) |
| Live sections (menu, specials, hours, announcements, photos) via embed | Wix, Squarespace, Joomla, Drupal, static/agency custom | ~50 % (~40 %) |
| Hosted page + link/QR only | Sites nobody can edit | ~5 % |
| Hours, holidays, specials on Google | Every venue | 100 % |
| Whole site because we host it | Venues with no website | 100 % of those |

If we come back to this, the spec's task order applies: embed and docs first, then the destination tables and sync, the WordPress plugin (read, then write), Google, GitHub; if time is short, Google stays in dry-run.
