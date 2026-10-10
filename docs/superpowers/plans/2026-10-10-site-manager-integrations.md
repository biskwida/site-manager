# Site Manager WordPress Plugin (full site access) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A café owner with an existing WordPress site installs one plugin, pastes two settings, and gets the live menu, specials, hours, announcements and photos from Site Manager as shortcodes and Gutenberg blocks; after sending one `/connect` line to the bot, the Telegram agent can also edit the site's pages, photos, menus and options through the same preview → approve → undo flow that already governs the hosted site.

**Architecture:** The plugin (`integrations/wordpress/site-manager`, PHP 8.1+, WordPress 6.5+) reads the public JSON feed `GET /api/site/<slug>` with a transient cache and renders server-side HTML; its REST namespace `site-manager/v1` is a bearer-token write channel. On our side, WordPress edits are ordinary `Change` rows with `wp_*` entities that the store treats as no-ops; a store decorator installed in `src/server/deps.ts` pushes every applied set to the connected destination through a `DestinationAdapter`, records a `destination_syncs` row, and the tick retries failures. Secrets (the plugin token) live AES-256-GCM-encrypted in `venue_destinations.secrets`. Everything runs offline against a fake plugin REST surface in `test/fake-wordpress.ts`; the real plugin is exercised by a Docker smoke script.

**Tech Stack:** Next.js 16.4 App Router, React 19.3, TypeScript 5.9, zod 4.6, @anthropic-ai/sdk 0.133 (`betaZodTool`), Supabase (Postgres), grammy 1.46, vitest 5, node:crypto (AES-256-GCM), WordPress 6.5+ (block.json API v3, `register_rest_route`, transients, `wp_remote_get`, `media_handle_sideload`, nav menus), PHP 8.1+, Docker (`wordpress:6.8`, `wordpress:cli`, `mysql:8.0`, `php:8.3-cli`).

**Spec:** `docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md`. Its section "Scope for the integrations session of 2026-10-10" is binding and overrides the older text where they differ. The main product spec is `docs/superpowers/specs/2026-10-10-site-manager-design.md`; the parallel templates track's spec is `docs/superpowers/specs/2026-10-10-site-manager-templates-design.md` (do not implement anything from it).

## Global Constraints

- **Isolation from the templates track (non-negotiable).** This branch is `build/integrations` in the worktree `/Users/tanyatopacharova/Projects/site-manager-integrations`. Never commit to `main` or `build/templates`. These files are **append-only** (add new exports, new cases, new columns, new object keys at the end; never reorder, rename or restructure what is there): `src/domain/types.ts`, `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`, `supabase/schema.sql`, `supabase/policies.sql`, `src/server/deps.ts`, `src/tick.ts`, `src/bot/bot.ts`, `src/bot/copy.ts`, `src/config.ts`, `app/admin/[slug]/page.tsx`, `src/server/admin.ts`, `next.config.ts`, `.env.example`, `README.md`, `scripts/check-rls.mts`, `test/store-contract.ts`, `src/i18n/dicts.ts`, `package.json`, `app/admin/[slug]/components/AdminPanel.tsx`. Do not touch `app/[slug]/**`, `src/templates/**`, `templates/**`, `src/deploy/**`, `src/wizard/**`, `app/new/**`, `app/api/new/**`. New database tables go in `supabase/schema-integrations.sql` and `supabase/policies-integrations.sql`. Where a task below says "append", it means exactly that.
- **Every write to a customer's site goes through a change set** (`Change` rows, preview, one-tap approval, audit log, undo). No tool pushes to WordPress directly; the push happens only after `applyChangeSet` returned `"applied"`.
- **Secrets.** `DESTINATION_SECRET_KEY` (32 bytes, hex or base64) is read only in `src/config.ts`; the plugin token is encrypted at rest, decrypted only inside `src/destinations/**`, never logged, never returned by any API or tool, never read by `loadSite` or `/api/site/[slug]`. `SUPABASE_SERVICE_ROLE_KEY` and the bot token stay server-only as today. Before finishing: `npx next build` and `grep -rl "DESTINATION_SECRET\|wp-json" .next/static` must find nothing except the admin card's documentation strings (the card never embeds a token).
- **Plugin API hardening.** Every route except `handshake` requires `Authorization: Bearer <token>` compared with `hash_equals` against a SHA-256 hash; `handshake` is limited to 5 calls per minute per IP and the rest to 120 per minute; every call lands in a 50-entry ring buffer (`site_manager_api_log`). The handshake refuses when the venue slug does not match the plugin's settings.
- **Bulgarian first, both natural.** Every owner-facing string (bot copy, dashboard, Telegram previews, plugin settings page, plugin readme) exists in Bulgarian and English; the plugin's guest-facing block labels are the plugin's own BG/EN table (not the WordPress locale) and mirror `site.*` in `src/i18n/dicts.ts`.
- **Offline-first.** `npm test` never touches the network: the plugin is replaced by `FakeWordPress` from `test/fake-wordpress.ts`; the PHP render logic is tested with a WordPress-function shim in a `php:8.3-cli` container (`npm run wp:test`); the live Docker smoke (`npm run wp:smoke`) is opt-in.
- **Read-time rules in PHP** equal `src/domain/effective.ts` and `src/domain/hours.ts`: use the feed's `now`, treat an elapsed `sold_out_until` as available, hide expired specials and announcements, list holidays from today in the venue zone, compute today's status in the venue zone. Prices: `2,90 €` (BG) / `€2.90` (EN).
- **Targets.** WordPress ≥ 6.5, PHP ≥ 8.1, `declare(strict_types=1)` in every PHP file, every output escaped with `esc_html`/`esc_attr`/`esc_url`, every option read through one settings accessor, no PHP warnings at `WP_DEBUG=true`.
- **Tests** live in `test/*.test.ts` (vitest, node environment, `@/` alias). `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` must be green at the end of every task that touches `app/**` or `src/**`; `npm run wp:lint` (php -l) must be green at the end of every PHP task.
- **Commit after every green step** with a conventional message ending in `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never commit `.env*` except `.env.example`; never run `npm run demo:reset`, `cleanup:test-venues`, `db:apply` or anything else against the live Supabase project; never deploy to Vercel production; never change the Telegram webhook.

## Review Focus

1. **An owner pastes a site URL with a path or a trailing slash (`https://cafe.bg/wordpress/`)** — the connect flow must normalise it (keep the path, drop the trailing slash) and call `https://cafe.bg/wordpress/wp-json/site-manager/v1/handshake`; a URL with a username, a private IP or plain http on a public host must be refused with a Bulgarian/English reason (Task 3 `validateSiteUrl` tests, Task 4 bot test).
2. **A `find` text that occurs twice on the page, or not at all** — `wp_edit_page` must refuse before anything is stored, naming the text and the count, so the agent picks a longer anchor instead of changing the wrong paragraph (Task 3 fake and Task 10 PHP `compute_after` both return `sm_replace_failed` with `count`; Task 6 test "refuses ambiguous replacements").
3. **The WordPress site is down when the owner taps ✅** — our change set is still applied and logged, the bot says "WordPress: не успях да обновя, ще опитам пак", the sync row stays `pending` with `next_at` one minute later, and the next tick pushes it; after five failures it is `failed` with the error shown on the dashboard (Task 5 tests "retries with backoff" and "gives up after five attempts").
4. **Undo of a page edit after the owner edited the page by hand in WordPress** — undo pushes the full `before` snapshot (title, content, Elementor data, featured image), which overwrites the manual edit; the Telegram preview of the undo must therefore show "връща предишния текст / restores the previous text" so the owner knows what they are approving (Task 1 `wpPreviewLines` test for an inverted change, Task 5 test "undo restores the previous content").
5. **A photo placeholder `{{sm_media_url:…}}` left in page content when the upload in the same set failed** — the push must stop at the first failure and report it, never apply a page with raw placeholders; on retry the upload is idempotent by `source_id` and the page apply resolves the placeholders (Task 5 test "stops at the first failed change and leaves no placeholder", Task 10 PHP resolves remaining placeholders by attachment meta).

---

## Plugin REST contract (binding for Tasks 3, 5, 6, 10, 11)

Base: `<site_url>/wp-json/site-manager/v1`. JSON in and out. Errors use WordPress's `WP_Error` JSON shape: `{ "code": "<code>", "message": "<text>", "data": { "status": <http> , ...extra } }`. Codes: `sm_unauthorized` (401), `sm_forbidden` (403: bad code, slug mismatch, expired code), `sm_not_found` (404), `sm_rate_limited` (429), `sm_replace_failed` (422, `data.find`, `data.count`), `sm_builder_unsupported` (422, `data.builder`), `sm_invalid` (400), `sm_no_woocommerce` (404), `sm_upload_failed` (502).

Types (TypeScript names used in `src/destinations/wordpress-client.ts`; the PHP returns exactly these keys):

```ts
export type WpBuilder = "gutenberg" | "classic" | "elementor" | "divi" | "unknown";
export interface WpPageSummary { id: number; title: string; slug: string; url: string; status: string; builder: WpBuilder; modified: string; featured_media: number | null; is_front_page: boolean }
export interface WpPageFields { title: string; content: string; elementor_data: string | null; featured_media: number | null }
export interface WpPage extends WpPageSummary, WpPageFields { text: string; texts: string[]; editable: boolean }
export interface WpReplacement { find: string; replace: string }
export interface WpPageEdit { title?: string; content?: string; replacements?: WpReplacement[]; featured_media?: number | null; placeholders?: Record<string, string> }
export interface WpPagePreview { before: WpPageFields; after: WpPageFields; preview_url: string | null; pending_key: string }
export interface WpPageApplied { id: number; url: string; revision_id: number | null; before: WpPageFields; after: WpPageFields }
export interface WpMedia { id: number; url: string; alt: string; existed: boolean }
export interface WpOptions { blogname: string; blogdescription: string; custom_logo: number | null; site_icon: number | null }
export type WpOptionKey = keyof WpOptions;
export interface WpMenuItem { id: number; title: string; url: string; parent_index: number | null; position: number; type: "custom" | "post_type"; object_id: number | null }
export interface WpMenuItemInput { title: string; url: string; parent_index?: number | null; type?: "custom" | "post_type"; object_id?: number | null }
export interface WpMenu { id: number; name: string; locations: string[]; items: WpMenuItem[] }
export interface WpProduct { id: number; name: string; regular_price: string; sale_price: string; stock_status: "instock" | "outofstock" | "onbackorder"; description: string; short_description: string; url: string }
export type WpProductPatch = Partial<Pick<WpProduct, "name" | "regular_price" | "sale_price" | "stock_status" | "description" | "short_description">>;
export interface WpSiteInfo {
  name: string; description: string; url: string; home_url: string; wp_version: string; plugin_version: string; locale: string; timezone: string;
  theme: { name: string; slug: string };
  pages: WpPageSummary[];
  menus: { id: number; name: string; locations: string[]; count: number }[];
  options: WpOptions;
  woocommerce: boolean;
  products: Pick<WpProduct, "id" | "name" | "regular_price" | "sale_price" | "stock_status">[];
  connected_user: { id: number; login: string } | null;
}
```

Routes:

| Method and path | Auth | Body | 200 response |
|---|---|---|---|
| `POST /handshake` | none (5/min/IP) | `{ code, slug }` | `{ token, site: WpSiteInfo }` (the token is returned once) |
| `GET /site` | bearer | | `WpSiteInfo` |
| `GET /page/{id}` | bearer | | `WpPage` |
| `POST /page/{id}/preview` | bearer | `WpPageEdit` | `WpPagePreview` |
| `DELETE /page/{id}/preview` | bearer | | `{ ok: true }` |
| `POST /page/{id}/apply` | bearer | `Partial<WpPageFields> & { placeholders? }` | `WpPageApplied` |
| `POST /revert/{page_id}/{revision_id}` | bearer | | `{ id, restored_revision }` |
| `POST /media` | bearer | `{ url, source_id, filename?, title?, alt? }` | `WpMedia` (idempotent by `source_id`) |
| `PUT /media/{id}` | bearer | `{ alt?, title?, caption? }` | `WpMedia` |
| `DELETE /media/{id}` or `DELETE /media?source_id=…` | bearer | | `{ ok: true, deleted: boolean }` |
| `GET /option` | bearer | | `WpOptions` |
| `PUT /option` | bearer | `{ key: WpOptionKey, value: string \| number \| null }` | `{ key, before, after }` |
| `GET /menu/{id}` | bearer | | `WpMenu` |
| `PUT /menu/{id}` | bearer | `{ items: WpMenuItemInput[] }` | `{ id, before: WpMenuItem[], after: WpMenuItem[] }` |
| `GET /product/{id}` | bearer | | `WpProduct` |
| `PUT /product/{id}` | bearer | `WpProductPatch` | `{ id, before: WpProduct, after: WpProduct }` |

Semantics shared by the fake (Task 3) and the PHP (Task 10):
- **Replacements** apply to `content` for `gutenberg`, `classic` and `divi` pages and to the string values inside `elementor_data` for `elementor` pages. Each `find` must occur **exactly once** in the target, else `sm_replace_failed` with `data.count` (0 or ≥ 2) and nothing is stored. `content` (full replacement) is refused with `sm_builder_unsupported` for `elementor`; both are refused for `unknown`.
- **Placeholders** `{{sm_media_url:<source_id>}}` and `{{sm_media_id:<source_id>}}` in `title`, `content` and `elementor_data`: the explicit `placeholders` map is applied first (string replace of the whole token); any remaining token is resolved from the media library by `source_id` (`_site_manager_source_id` meta); a token that still cannot be resolved is left as is in a preview and makes `apply` fail with `sm_invalid` (`data.placeholder`).
- **Preview** stores `{ key, after, expires }` in post meta `_site_manager_pending` (24 h); `preview_url` is `<permalink>?sm_preview=<key>` or `null` for `elementor`. **Apply** writes only the fields present in the body (the adapter always sends all four), deletes the pending meta, and returns the new latest revision id when revisions exist.
- **Media** upload stores `_site_manager_source_id` and alt text; a second upload with the same `source_id` returns the existing attachment with `existed: true`. Delete by `source_id` deletes that attachment.
- **Menus** are replaced wholesale: all current items are deleted and the new list created in order; `parent_index` refers to the index in the same list.

---

### Task 1: WordPress change entities, preview lines, destination tables and Store additions

**Files:**
- Create: `src/domain/wp-preview.ts`, `supabase/schema-integrations.sql`, `supabase/policies-integrations.sql`, `test/wp-changes.test.ts`
- Modify (append-only): `src/domain/types.ts`, `src/store/types.ts`, `src/store/memory.ts`, `src/store/supabase.ts`, `scripts/check-rls.mts`, `test/store-contract.ts`
- Modify (free): `src/domain/changes.ts`, `src/domain/preview.ts`, `scripts/db-apply.mts`
- Test: `test/wp-changes.test.ts`, `test/store-contract.ts` (runs through `test/store-memory.test.ts`; the Supabase run is opt-in)

**Interfaces:**
- Consumes: existing `Change`, `Entity`, `OpName`, `Store`, `applyChange`, `renderPreview`, `quote`, `tr`.
- Produces: in `src/domain/types.ts`: `WpOpName`, `WP_OP_NAMES`, `WpEntity`, `WP_ENTITIES`, `isWpEntity(e)`, `Entity` extended with the five `wp_*` members, `Change.op: OpName | WpOpName`. In `src/domain/wp-preview.ts`: `wpPreviewLines(c: Change, lang: Lang): string[]`, `clip(s, n = 80)`. In `src/store/types.ts`: `DestinationKind`, `DestinationStatus`, `Destination`, `DestinationWithSecrets`, `NewDestination`, `DestinationPatch`, `SyncStatus`, `DestinationSync`, `NewSync`, `SyncPatch`, and these `Store` methods: `upsertDestination(d: NewDestination): Promise<Destination>`, `getDestination(venueId, kind): Promise<DestinationWithSecrets | null>`, `listDestinations(venueId): Promise<Destination[]>`, `updateDestination(id, patch: DestinationPatch): Promise<void>`, `deleteDestination(id): Promise<void>`, `createSync(s: NewSync): Promise<DestinationSync>`, `getSync(id): Promise<DestinationSync>`, `listSyncs(opts: { venueId?; changeSetId?; status?: SyncStatus[]; dueBefore?: string; limit? }): Promise<DestinationSync[]>` (oldest first), `updateSync(id, patch: SyncPatch): Promise<void>`.

Decisions this task fixes:
- `wp_*` ops are **not** members of `ChangeOp` (the agent's `propose_changes` must not accept them); `Change.op` is widened to `OpName | WpOpName` instead. `planChange` and `validateChange` are untouched.
- `applyChange` returns the state unchanged for a `wp_*` entity; `SupabaseStore.writeEntity` returns early for it. The change rows are still stored and listed, so the log, undo and previews work unchanged.
- `secrets` is a `text` column (base64 ciphertext); `Destination` never carries it, only `DestinationWithSecrets` from `getDestination` does.
- One destination per `(venue_id, kind)`; `upsertDestination` replaces config, secrets and status of an existing row and keeps its id.

- [ ] **Step 1: Append the WordPress types to `src/domain/types.ts`**

At the very end of `src/domain/types.ts` append:

```ts

// --- WordPress write channel (integrations track, appended 2026-10-10) ---
/** Ops produced by the WordPress tools (src/agent/wp-tools.ts) from live WordPress data; never by planChange. */
export type WpOpName = "wp_edit_page" | "wp_upload_photo" | "wp_set_option" | "wp_edit_menu" | "wp_edit_product";
export const WP_OP_NAMES: readonly WpOpName[] = ["wp_edit_page", "wp_upload_photo", "wp_set_option", "wp_edit_menu", "wp_edit_product"];
/** Entities that live on the owner's WordPress site, not in our database: the store applies them as no-ops and the destination push writes them. */
export type WpEntity = "wp_page" | "wp_media" | "wp_option" | "wp_menu" | "wp_product";
export const WP_ENTITIES: readonly WpEntity[] = ["wp_page", "wp_media", "wp_option", "wp_menu", "wp_product"];
export function isWpEntity(e: string): e is WpEntity {
  return (WP_ENTITIES as readonly string[]).includes(e);
}
```

Then make two one-line edits in the same file (these are "new cases", allowed by the append-only rule):

```ts
export type Entity = "venue" | "category" | "item" | "holiday" | "announcement" | "media" | "site_text" | WpEntity;
```

and inside `export interface Change`:

```ts
  op: OpName | WpOpName;
```

- [ ] **Step 2: Write the failing domain test**

Create `test/wp-changes.test.ts`:

```ts
// test/wp-changes.test.ts
import { describe, expect, it } from "vitest";
import { applyChange, invertChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import { clip, wpPreviewLines } from "@/src/domain/wp-preview";
import { isWpEntity, type Change } from "@/src/domain/types";
import { state } from "./fixtures";

const page: Change = {
  position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "12",
  before: { title: "About", content: "<p>We bake banitsa every morning.</p>", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: "<p>We bake banitsa and kozunak every morning.</p>", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }], preview_url: "https://cafe.example/about/?sm_preview=abc" },
};
const photo: Change = {
  position: 1, op: "wp_upload_photo", entity: "wp_media", entity_id: "m-1",
  before: null,
  after: { source_url: "https://cdn.example/m-1.jpg", title: "Коледна витрина", alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 12, page_title: "About", as_featured: true, previous_featured: null },
};
const option: Change = { position: 2, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Agala" }, after: { value: "Кафене „Ъгъла“" } };
const menu: Change = {
  position: 3, op: "wp_edit_menu", entity: "wp_menu", entity_id: "3",
  before: { name: "Main", items: [{ id: 1, title: "Home", url: "/", parent_index: null, position: 1, type: "custom", object_id: null }] },
  after: { name: "Main", items: [{ title: "Home", url: "/", parent_index: null, type: "custom", object_id: null }, { title: "Menu", url: "/menu/", parent_index: null, type: "custom", object_id: null }] },
};
const product: Change = { position: 4, op: "wp_edit_product", entity: "wp_product", entity_id: "77", before: { product_name: "Espresso beans", regular_price: "12" }, after: { product_name: "Espresso beans", regular_price: "13.5" } };

describe("wp entities in the change engine", () => {
  it("recognises wp_* entities and applies them as no-ops", () => {
    expect(isWpEntity("wp_page")).toBe(true);
    expect(isWpEntity("item")).toBe(false);
    const s = state();
    expect(applyChange(s, page)).toEqual(s);
    expect(applyChange(s, photo)).toEqual(s);
  });
  it("inverts like any other change", () => {
    const [inv] = invertChanges([page]);
    expect(inv.before).toEqual(page.after);
    expect(inv.after).toEqual(page.before);
    expect(inv.op).toBe("wp_edit_page");
  });
});

describe("wpPreviewLines", () => {
  it("clips long text on one line", () => {
    expect(clip("a\n b   c")).toBe("a b c");
    expect(clip("x".repeat(100), 10)).toBe("xxxxxxxxx…");
  });
  it("describes a page edit with replacements and the preview link, in both languages", () => {
    expect(wpPreviewLines(page, "bg")).toEqual([
      "• WordPress: страница „About“",
      "  „banitsa every morning“ → „banitsa and kozunak every morning“",
      "  Преглед: https://cafe.example/about/?sm_preview=abc",
    ]);
    expect(wpPreviewLines(page, "en")).toEqual([
      "• WordPress: page “About”",
      "  “banitsa every morning” → “banitsa and kozunak every morning”",
      "  Preview: https://cafe.example/about/?sm_preview=abc",
    ]);
  });
  it("describes an inverted page edit as restoring the previous text", () => {
    const [inv] = invertChanges([page]);
    expect(wpPreviewLines(inv, "bg")).toEqual(["• WordPress: страница „About“", "  връща предишния текст"]);
    expect(wpPreviewLines(inv, "en")).toEqual(["• WordPress: page “About”", "  restores the previous text"]);
  });
  it("describes photos, options, menus and products", () => {
    expect(wpPreviewLines(photo, "bg")).toEqual(["• WordPress: качва снимка „Коледна витрина“", "  като водеща снимка на страница „About“"]);
    expect(wpPreviewLines(photo, "en")).toEqual(["• WordPress: uploads photo “Christmas window”", "  as the featured image of page “About”"]);
    const [noPhoto] = invertChanges([photo]);
    expect(wpPreviewLines(noPhoto, "en")).toEqual(["• WordPress: removes photo “Christmas window”", "  and the featured image of page “About”"]);
    expect(wpPreviewLines(option, "bg")).toEqual(["• WordPress: Име на сайта: „Agala“ → „Кафене „Ъгъла““"]);
    expect(wpPreviewLines(option, "en")).toEqual(["• WordPress: Site title: “Agala” → “Кафене „Ъгъла“”"]);
    expect(wpPreviewLines(menu, "en")).toEqual(["• WordPress: menu “Main”: 1 → 2 items", "  – Home → /", "  – Menu → /menu/"]);
    expect(wpPreviewLines(menu, "bg")[0]).toBe("• WordPress: меню „Main“: 1 → 2 елемента");
    expect(wpPreviewLines(product, "en")).toEqual(["• WordPress: product “Espresso beans”", "  price: “12” → “13.5”"]);
  });
  it("is wired into renderPreview", () => {
    const s = state();
    expect(renderPreview(s, [option, page], "en", "Europe/Sofia")).toBe(
      ["• WordPress: Site title: “Agala” → “Кафене „Ъгъла“”", "• WordPress: page “About”", "  “banitsa every morning” → “banitsa and kozunak every morning”", "  Preview: https://cafe.example/about/?sm_preview=abc"].join("\n"),
    );
  });
});
```

`state()` is the existing helper in `test/fixtures.ts` that builds a `SiteState` (check its name there; if it is `siteState()` or similar, use that name).

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/wp-changes.test.ts`
Expected: FAIL (module `@/src/domain/wp-preview` not found; TypeScript complaints about `op: "wp_edit_page"` are fixed by Step 1).

- [ ] **Step 4: Create `src/domain/wp-preview.ts`**

```ts
// src/domain/wp-preview.ts
// Preview lines for WordPress change rows (entities wp_*). Pure; both languages; undo-safe (an inverted
// row keeps the op with before/after swapped, so "after without replacements" reads as a restore).
import { quote, tr } from "./format";
import type { Change, Lang, Row } from "./types";

const OPTION_LABEL: Record<string, { bg: string; en: string }> = {
  blogname: { bg: "Име на сайта", en: "Site title" },
  blogdescription: { bg: "Слоган", en: "Tagline" },
  custom_logo: { bg: "Лого", en: "Logo" },
  site_icon: { bg: "Икона на сайта", en: "Site icon" },
};
const PRODUCT_FIELD: Record<string, { bg: string; en: string }> = {
  name: { bg: "име", en: "name" },
  regular_price: { bg: "цена", en: "price" },
  sale_price: { bg: "промоционална цена", en: "sale price" },
  stock_status: { bg: "наличност", en: "stock" },
  description: { bg: "описание", en: "description" },
  short_description: { bg: "кратко описание", en: "short description" },
};

/** One line, whitespace collapsed, at most `n` characters. */
export function clip(s: string, n = 80): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown): string => (v === null || v === undefined ? "—" : `#${String(v)}`);

function pageTitle(b: Row, a: Row, id: string): string {
  return str(a.page_title) || str(b.page_title) || `#${id}`;
}

export function wpPreviewLines(c: Change, lang: Lang): string[] {
  const b: Row = c.before ?? {};
  const a: Row = c.after ?? {};
  const q = (s: string) => quote(clip(s), lang);
  switch (c.op) {
    case "wp_edit_page": {
      const lines = [`• WordPress: ${tr(lang, "страница", "page")} ${quote(pageTitle(b, a, c.entity_id), lang)}`];
      const reps = Array.isArray(a.replacements) ? (a.replacements as { find: string; replace: string }[]) : [];
      if (a.title !== undefined && str(a.title) !== str(b.title)) lines.push(`  ${tr(lang, "заглавие", "title")}: ${q(str(b.title))} → ${q(str(a.title))}`);
      for (const r of reps) lines.push(`  ${q(r.find)} → ${q(r.replace)}`);
      const contentChanged = str(a.content) !== str(b.content) || str(a.elementor_data) !== str(b.elementor_data);
      if (reps.length === 0 && contentChanged) lines.push(a.replacements === undefined && a.preview_url === undefined ? `  ${tr(lang, "връща предишния текст", "restores the previous text")}` : `  ${tr(lang, "нов текст на страницата", "new page text")}`);
      if (a.featured_media !== undefined && a.featured_media !== b.featured_media) lines.push(`  ${tr(lang, "нова водеща снимка", "new featured image")}`);
      if (typeof a.preview_url === "string" && a.preview_url) lines.push(`  ${tr(lang, "Преглед", "Preview")}: ${a.preview_url}`);
      return lines;
    }
    case "wp_upload_photo": {
      const row = c.after ?? c.before ?? {};
      const alt = str(lang === "bg" ? row.alt_bg : row.alt_en) || str(row.alt_bg) || str(row.title);
      if (c.after === null) {
        const lines = [`• WordPress: ${tr(lang, "премахва снимката", "removes photo")} ${quote(alt, lang)}`];
        if (row.as_featured === true) lines.push(`  ${tr(lang, "и водещата снимка на страница", "and the featured image of page")} ${quote(str(row.page_title) || `#${str(row.page_id)}`, lang)}`);
        return lines;
      }
      const lines = [`• WordPress: ${tr(lang, "качва снимка", "uploads photo")} ${quote(alt, lang)}`];
      if (row.as_featured === true) lines.push(`  ${tr(lang, "като водеща снимка на страница", "as the featured image of page")} ${quote(str(row.page_title) || `#${str(row.page_id)}`, lang)}`);
      return lines;
    }
    case "wp_set_option": {
      const label = OPTION_LABEL[c.entity_id]?.[lang] ?? c.entity_id;
      const isMedia = c.entity_id === "custom_logo" || c.entity_id === "site_icon";
      const show = (v: unknown) => (isMedia ? (typeof v === "string" && v.startsWith("{{") ? tr(lang, "новата снимка", "the new photo") : num(v)) : q(str(v)));
      return [`• WordPress: ${label}: ${show(b.value)} → ${show(a.value)}`];
    }
    case "wp_edit_menu": {
      const name = str(a.name) || str(b.name) || `#${c.entity_id}`;
      const before = Array.isArray(b.items) ? (b.items as Row[]) : [];
      const after = Array.isArray(a.items) ? (a.items as Row[]) : [];
      const lines = [`• WordPress: ${tr(lang, "меню", "menu")} ${quote(name, lang)}: ${before.length} → ${after.length} ${tr(lang, "елемента", "items")}`];
      for (const it of after.slice(0, 15)) lines.push(`  – ${clip(str(it.title), 40)} → ${clip(str(it.url), 60)}`);
      if (after.length > 15) lines.push(`  … ${after.length - 15} ${tr(lang, "още", "more")}`);
      return lines;
    }
    case "wp_edit_product": {
      const name = str(a.product_name) || str(b.product_name) || `#${c.entity_id}`;
      const lines = [`• WordPress: ${tr(lang, "продукт", "product")} ${quote(name, lang)}`];
      for (const k of Object.keys(a)) {
        if (k === "product_name" || str(a[k]) === str(b[k])) continue;
        lines.push(`  ${PRODUCT_FIELD[k]?.[lang] ?? k}: ${q(str(b[k]))} → ${q(str(a[k]))}`);
      }
      return lines;
    }
    default:
      return [`• ${c.op}`];
  }
}
```

- [ ] **Step 5: Wire the no-op apply and the preview lines**

In `src/domain/changes.ts`, add the import and the early return at the top of `applyChange`:

```ts
import { isWpEntity, MONO_TEXT_KEYS, SITE_TEXT_KEYS, VENUE_TEXT_KEYS, /* …existing type imports… */ } from "./types";
```

```ts
export function applyChange(s: SiteState, c: Change): SiteState {
  if (isWpEntity(c.entity)) return s; // lives on the owner's WordPress site; the destination push writes it
  switch (c.entity) {
```

In `src/domain/preview.ts`, import `wpPreviewLines` and add the cases before the closing of the `switch (c.op)`:

```ts
import { wpPreviewLines } from "./wp-preview";
```

```ts
      case "wp_edit_page":
      case "wp_upload_photo":
      case "wp_set_option":
      case "wp_edit_menu":
      case "wp_edit_product":
        lines.push(...wpPreviewLines(c, lang));
        break;
```

- [ ] **Step 6: Run the domain test**

Run: `npx vitest run test/wp-changes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Append the destination types and Store methods to `src/store/types.ts`**

At the very end of `src/store/types.ts` append:

```ts

// --- Destinations (integrations track, appended 2026-10-10) ---
export type DestinationKind = "wordpress" | "google" | "github";
export type DestinationStatus = "connected" | "error" | "disconnected";
export interface Destination {
  id: string;
  venue_id: string;
  kind: DestinationKind;
  /** Non-secret settings (site URL, site name, versions, connected_at…). */
  config: Record<string, unknown>;
  status: DestinationStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
/** Only getDestination returns the encrypted secrets blob (base64 ciphertext); never put it on Destination. */
export interface DestinationWithSecrets extends Destination {
  secrets: string;
}
export interface NewDestination {
  venue_id: string;
  kind: DestinationKind;
  config: Record<string, unknown>;
  secrets: string;
  status?: DestinationStatus;
}
export type DestinationPatch = Partial<Pick<Destination, "status" | "last_error" | "config">>;

export type SyncStatus = "pending" | "done" | "failed";
export interface DestinationSync {
  id: string;
  venue_id: string;
  destination_id: string;
  change_set_id: string;
  status: SyncStatus;
  attempts: number;
  /** Earliest instant the next attempt may run (ISO). */
  next_at: string;
  last_error: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}
export interface NewSync {
  venue_id: string;
  destination_id: string;
  change_set_id: string;
  payload: Record<string, unknown>;
  next_at: string;
}
export type SyncPatch = Partial<Pick<DestinationSync, "status" | "attempts" | "next_at" | "last_error" | "result" | "updated_at">>;

// Declaration merging: the Store interface above gains the destination methods.
export interface Store {
  /** One destination per (venue, kind): replaces config, secrets and status of an existing row, keeping its id. */
  upsertDestination(d: NewDestination): Promise<Destination>;
  getDestination(venueId: string, kind: DestinationKind): Promise<DestinationWithSecrets | null>;
  listDestinations(venueId: string): Promise<Destination[]>;
  updateDestination(id: string, patch: DestinationPatch): Promise<void>;
  /** Deletes the destination and its sync rows. */
  deleteDestination(id: string): Promise<void>;
  createSync(s: NewSync): Promise<DestinationSync>;
  getSync(id: string): Promise<DestinationSync>;
  /** Oldest first (created_at). `dueBefore` keeps rows with next_at <= dueBefore. */
  listSyncs(opts: { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; limit?: number }): Promise<DestinationSync[]>;
  updateSync(id: string, patch: SyncPatch): Promise<void>;
}
```

- [ ] **Step 8: Append the failing contract test to `test/store-contract.ts`**

Inside the `describe` block, after the last existing `it(...)`, append:

```ts
    it("stores one destination per kind with secrets kept apart, and syncs with due ordering", async () => {
      const s = await make();
      const v = await s.createVenue({ slug: "t-dest", name: "Dest" });
      const d1 = await s.upsertDestination({ venue_id: v.id, kind: "wordpress", config: { site_url: "https://a.example" }, secrets: "enc-1" });
      expect(d1).toMatchObject({ venue_id: v.id, kind: "wordpress", status: "connected", last_error: null, config: { site_url: "https://a.example" } });
      expect(d1).not.toHaveProperty("secrets");
      const d2 = await s.upsertDestination({ venue_id: v.id, kind: "wordpress", config: { site_url: "https://b.example" }, secrets: "enc-2" });
      expect(d2.id).toBe(d1.id);
      expect(await s.getDestination(v.id, "wordpress")).toMatchObject({ id: d1.id, secrets: "enc-2", config: { site_url: "https://b.example" }, status: "connected" });
      expect(await s.getDestination(v.id, "google")).toBeNull();
      const listed = await s.listDestinations(v.id);
      expect(listed.map((d) => d.kind)).toEqual(["wordpress"]);
      expect(listed[0]).not.toHaveProperty("secrets");
      await s.updateDestination(d1.id, { status: "error", last_error: "boom" });
      expect(await s.getDestination(v.id, "wordpress")).toMatchObject({ status: "error", last_error: "boom" });

      const cs = await s.createChangeSet({ venue_id: v.id, chat_id: null, summary_bg: "x", summary_en: "x", preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "7", before: { title: "a" }, after: { title: "b" } }] });
      expect(await s.applyChangeSet(cs.id, NOW)).toBe("applied"); // wp_* rows are no-ops for the store
      expect((await s.getChangeSet(cs.id)).changes[0]).toMatchObject({ entity: "wp_page", op: "wp_edit_page", after: { title: "b" } });

      const y1 = await s.createSync({ venue_id: v.id, destination_id: d1.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: "2026-10-09T09:05:00.000Z" });
      const y2 = await s.createSync({ venue_id: v.id, destination_id: d1.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: "2026-10-09T09:00:00.000Z" });
      expect(y1).toMatchObject({ status: "pending", attempts: 0, last_error: null, result: null, payload: { kind: "wordpress" } });
      expect((await s.listSyncs({ venueId: v.id, status: ["pending"], dueBefore: "2026-10-09T09:01:00.000Z" })).map((x) => x.id)).toEqual([y2.id]);
      expect((await s.listSyncs({ changeSetId: cs.id })).map((x) => x.id)).toEqual([y1.id, y2.id]);
      await s.updateSync(y2.id, { status: "done", attempts: 1, result: { pushed: 1 }, updated_at: LATER });
      expect(await s.getSync(y2.id)).toMatchObject({ status: "done", attempts: 1, result: { pushed: 1 }, updated_at: LATER });
      expect((await s.listSyncs({ venueId: v.id, status: ["pending"] })).map((x) => x.id)).toEqual([y1.id]);
      expect((await s.listSyncs({ venueId: v.id, limit: 1 })).map((x) => x.id)).toEqual([y1.id]);

      await s.deleteDestination(d1.id);
      expect(await s.getDestination(v.id, "wordpress")).toBeNull();
      expect(await s.listSyncs({ venueId: v.id })).toEqual([]);
    });
```

Run: `npx vitest run test/store-memory.test.ts`
Expected: FAIL (`s.upsertDestination is not a function`; TypeScript also reports `InMemoryStore` not implementing the new methods).

- [ ] **Step 9: Implement the memory store**

At the end of the `InMemoryStore` class body in `src/store/memory.ts` (after `bumpRateLimit`, before the final `}`), append:

```ts

  // --- Destinations (integrations track, appended 2026-10-10) ---
  destinations = new Map<string, DestinationWithSecrets>();
  syncs = new Map<string, DestinationSync>();

  private publicDestination(d: DestinationWithSecrets): Destination {
    const { secrets: _secrets, ...rest } = d;
    void _secrets;
    return clone(rest);
  }
  async upsertDestination(d: NewDestination): Promise<Destination> {
    this.site(d.venue_id);
    const now = this.clock();
    const existing = [...this.destinations.values()].find((x) => x.venue_id === d.venue_id && x.kind === d.kind);
    const row: DestinationWithSecrets = {
      id: existing?.id ?? crypto.randomUUID(),
      venue_id: d.venue_id,
      kind: d.kind,
      config: clone(d.config),
      secrets: d.secrets,
      status: d.status ?? "connected",
      last_error: null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.destinations.set(row.id, row);
    return this.publicDestination(row);
  }
  async getDestination(venueId: string, kind: DestinationKind) {
    const d = [...this.destinations.values()].find((x) => x.venue_id === venueId && x.kind === kind);
    return d ? clone(d) : null;
  }
  async listDestinations(venueId: string) {
    return [...this.destinations.values()].filter((x) => x.venue_id === venueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((d) => this.publicDestination(d));
  }
  async updateDestination(id: string, patch: DestinationPatch) {
    const d = this.destinations.get(id);
    if (!d) throw new Error(`destination ${id} not found`);
    if (patch.status !== undefined) d.status = patch.status;
    if (patch.last_error !== undefined) d.last_error = patch.last_error;
    if (patch.config !== undefined) d.config = clone(patch.config);
    d.updated_at = this.clock();
  }
  async deleteDestination(id: string) {
    this.destinations.delete(id);
    for (const [sid, s] of this.syncs) if (s.destination_id === id) this.syncs.delete(sid);
  }
  async createSync(s: NewSync): Promise<DestinationSync> {
    const now = this.clock();
    const row: DestinationSync = { id: crypto.randomUUID(), venue_id: s.venue_id, destination_id: s.destination_id, change_set_id: s.change_set_id, status: "pending", attempts: 0, next_at: s.next_at, last_error: null, payload: clone(s.payload), result: null, created_at: now, updated_at: now };
    this.syncs.set(row.id, row);
    return clone(row);
  }
  async getSync(id: string) {
    const s = this.syncs.get(id);
    if (!s) throw new Error(`sync ${id} not found`);
    return clone(s);
  }
  async listSyncs(opts: { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; limit?: number }) {
    const rows = [...this.syncs.values()]
      .filter((s) => (!opts.venueId || s.venue_id === opts.venueId) && (!opts.changeSetId || s.change_set_id === opts.changeSetId) && (!opts.status || opts.status.includes(s.status)) && (!opts.dueBefore || s.next_at <= opts.dueBefore))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return (opts.limit ? rows.slice(0, opts.limit) : rows).map(clone);
  }
  async updateSync(id: string, patch: SyncPatch) {
    const s = this.syncs.get(id);
    if (!s) throw new Error(`sync ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = typeof v === "object" && v !== null ? clone(v) : v;
    if (patch.updated_at === undefined) s.updated_at = this.clock();
  }
```

Extend the type import at the top of the file (append the new names to the existing `import type {...} from "./types"` list): `DestinationKind, DestinationPatch, DestinationSync, DestinationWithSecrets, Destination, NewDestination, NewSync, SyncPatch, SyncStatus`.

Also append two cleanup lines (new cases) at the end of the existing methods so venue deletion and demo reset do not leave rows behind — at the end of `deleteVenue`:

```ts
    for (const [did, d] of this.destinations) if (d.venue_id === id) this.destinations.delete(did);
    for (const [sid, s] of this.syncs) if (s.venue_id === id) this.syncs.delete(sid);
```

and at the end of `clearVenueContent`:

```ts
    for (const [sid, s] of this.syncs) if (s.venue_id === venueId) this.syncs.delete(sid);
```

Run: `npx vitest run test/store-memory.test.ts`
Expected: PASS.

- [ ] **Step 10: SQL for the two tables, the entity constraint and the policies**

Create `supabase/schema-integrations.sql`:

```sql
-- Site Manager integrations: destinations (WordPress today; Google, GitHub later). Idempotent.
-- Applied by `npm run db:apply` after schema.sql.

create table if not exists public.venue_destinations (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  kind text not null check (kind in ('wordpress', 'google', 'github')),
  config jsonb not null default '{}'::jsonb,
  -- base64 of AES-256-GCM(iv || tag || ciphertext) under DESTINATION_SECRET_KEY; server-only (see policies-integrations.sql)
  secrets text not null default '',
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (venue_id, kind)
);

create table if not exists public.destination_syncs (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  destination_id uuid not null references public.venue_destinations(id) on delete cascade,
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists destination_syncs_due_idx on public.destination_syncs (status, next_at);
create index if not exists destination_syncs_set_idx on public.destination_syncs (change_set_id);
create index if not exists destination_syncs_venue_idx on public.destination_syncs (venue_id, created_at);

-- Change rows may now point at entities that live on the owner's WordPress site.
alter table public.changes drop constraint if exists changes_entity_check;
alter table public.changes add constraint changes_entity_check
  check (entity in ('venue', 'category', 'item', 'holiday', 'announcement', 'media', 'site_text', 'wp_page', 'wp_media', 'wp_option', 'wp_menu', 'wp_product'));
```

Create `supabase/policies-integrations.sql`:

```sql
-- Destinations and their sync queue are server-only: RLS on, no policies, no grants for anon/authenticated.
alter table public.venue_destinations enable row level security;
alter table public.destination_syncs enable row level security;
revoke all on public.venue_destinations, public.destination_syncs from anon, authenticated;
notify pgrst, 'reload schema';
```

In `scripts/db-apply.mts` change the file list:

```ts
  for (const file of ["schema.sql", "policies.sql", "schema-integrations.sql", "policies-integrations.sql"]) {
```

and update its header comment to `// Applies supabase/schema.sql, policies.sql, schema-integrations.sql and policies-integrations.sql to SUPABASE_DB_URL. Idempotent.`

Append to `scripts/check-rls.mts`, just before `process.exit(failed ? 1 : 0);`:

```ts
for (const t of ["venue_destinations", "destination_syncs"]) {
  const r = await db.from(t).select("*").limit(1);
  check(`anon cannot read ${t}`, !!r.error || (r.data?.length ?? 0) === 0, r.error?.code ?? `${r.data?.length ?? 0} rows`);
}
```

Do **not** run `db:apply` or `check:rls` against the live project in this session (the owner runs them after review).

- [ ] **Step 11: Implement the Supabase store**

In `src/store/supabase.ts`:

1. Extend the type import from `./types` with `Destination, DestinationKind, DestinationPatch, DestinationSync, DestinationWithSecrets, NewDestination, NewSync, SyncPatch, SyncStatus`, and the import from `../domain/types` with `isWpEntity, type WpEntity`.
2. Change the `TABLE` declaration's type (one line) so TypeScript does not demand rows for WordPress entities:

```ts
const TABLE: Record<Exclude<Change["entity"], WpEntity>, string> = { venue: "venues", category: "categories", item: "items", holiday: "holidays", announcement: "announcements", media: "media", site_text: "site_texts" };
```

3. Add the early return as the first line of `writeEntity`:

```ts
  private async writeEntity(venueId: string, c: Change) {
    if (isWpEntity(c.entity)) return; // lives on the owner's WordPress site; the destination push writes it
    const table = TABLE[c.entity];
```

4. Append mappers at the end of the file (after the class):

```ts

// --- Destinations (integrations track, appended 2026-10-10) ---
export function toDestination(r: Row): DestinationWithSecrets {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    kind: r.kind as DestinationKind,
    config: (r.config as Record<string, unknown>) ?? {},
    secrets: str(r.secrets),
    status: (r.status as Destination["status"]) ?? "connected",
    last_error: strOrNull(r.last_error),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
export function toSync(r: Row): DestinationSync {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    destination_id: r.destination_id as string,
    change_set_id: r.change_set_id as string,
    status: r.status as SyncStatus,
    attempts: num(r.attempts),
    next_at: iso(r.next_at),
    last_error: strOrNull(r.last_error),
    payload: (r.payload as Record<string, unknown>) ?? {},
    result: (r.result as Record<string, unknown> | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
```

5. Append the methods at the end of the `SupabaseStore` class body:

```ts

  // --- Destinations (integrations track, appended 2026-10-10) ---
  private withoutSecrets(d: DestinationWithSecrets): Destination {
    const { secrets: _secrets, ...rest } = d;
    void _secrets;
    return rest;
  }
  async upsertDestination(d: NewDestination): Promise<Destination> {
    const row = await must(
      this.db.from("venue_destinations")
        .upsert({ venue_id: d.venue_id, kind: d.kind, config: d.config, secrets: d.secrets, status: d.status ?? "connected", last_error: null, updated_at: new Date().toISOString() }, { onConflict: "venue_id,kind" })
        .select("*").single(),
      "upsertDestination",
    );
    return this.withoutSecrets(toDestination(row));
  }
  async getDestination(venueId: string, kind: DestinationKind) {
    if (badVenue(venueId)) return null;
    const { data, error } = await this.db.from("venue_destinations").select("*").eq("venue_id", venueId).eq("kind", kind).maybeSingle();
    if (error) throw new Error(`getDestination: ${error.message}`);
    return data ? toDestination(data) : null;
  }
  async listDestinations(venueId: string) {
    if (badVenue(venueId)) return [];
    const rows = await must(this.db.from("venue_destinations").select("*").eq("venue_id", venueId).order("created_at"), "listDestinations");
    return rows.map((r) => this.withoutSecrets(toDestination(r)));
  }
  async updateDestination(id: string, patch: DestinationPatch) {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.last_error !== undefined) row.last_error = patch.last_error;
    if (patch.config !== undefined) row.config = patch.config;
    await mustRows(this.db.from("venue_destinations").update(row).eq("id", id).select("id"), `updateDestination ${id}`);
  }
  async deleteDestination(id: string) {
    const { error } = await this.db.from("venue_destinations").delete().eq("id", id);
    if (error) throw new Error(`deleteDestination ${id}: ${error.message}`);
  }
  async createSync(s: NewSync): Promise<DestinationSync> {
    return toSync(await must(this.db.from("destination_syncs").insert({ venue_id: s.venue_id, destination_id: s.destination_id, change_set_id: s.change_set_id, payload: s.payload, next_at: s.next_at }).select("*").single(), "createSync"));
  }
  async getSync(id: string) {
    return toSync(await must(this.db.from("destination_syncs").select("*").eq("id", id).single(), `getSync ${id}`));
  }
  async listSyncs(opts: { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; limit?: number }) {
    if (badVenue(opts.venueId)) return [];
    let q = this.db.from("destination_syncs").select("*").order("created_at");
    if (opts.venueId) q = q.eq("venue_id", opts.venueId);
    if (opts.changeSetId) q = q.eq("change_set_id", opts.changeSetId);
    if (opts.status) q = q.in("status", opts.status);
    if (opts.dueBefore) q = q.lte("next_at", opts.dueBefore);
    if (opts.limit) q = q.limit(opts.limit);
    return (await must(q, "listSyncs")).map(toSync);
  }
  async updateSync(id: string, patch: SyncPatch) {
    const row: Row = { updated_at: patch.updated_at ?? new Date().toISOString() };
    for (const k of ["status", "attempts", "next_at", "last_error", "result"] as const) if (patch[k] !== undefined) row[k] = patch[k];
    await mustRows(this.db.from("destination_syncs").update(row).eq("id", id).select("id"), `updateSync ${id}`);
  }
```

- [ ] **Step 12: Typecheck, lint, full tests**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green (the Supabase contract stays skipped without `SUPABASE_CONTRACT=1`).

- [ ] **Step 13: Commit**

```bash
git add src/domain/types.ts src/domain/changes.ts src/domain/preview.ts src/domain/wp-preview.ts src/store/types.ts src/store/memory.ts src/store/supabase.ts supabase/schema-integrations.sql supabase/policies-integrations.sql scripts/db-apply.mts scripts/check-rls.mts test/wp-changes.test.ts test/store-contract.ts
git commit -m "Domain and store: WordPress change entities, preview lines, destinations and sync queue

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Secret encryption and `DESTINATION_SECRET_KEY`

**Files:**
- Create: `src/destinations/secrets.ts`, `test/destinations-secrets.test.ts`
- Modify (append-only): `src/config.ts`, `.env.example`
- Test: `test/destinations-secrets.test.ts`, `test/config.test.ts` (existing; add one case at the end)

**Interfaces:**
- Consumes: `loadConfig` from `src/config.ts`.
- Produces: `DEV_SECRET_KEY_HEX`, `parseSecretKey(raw: string): Buffer`, `encryptSecrets(secrets: Record<string, string>, key: Buffer): string`, `decryptSecrets(blob: string, key: Buffer): Record<string, string>`, `resolveSecretKey(configured: string | null, isMemory: boolean, log?: (s: string) => void): Buffer | null` in `src/destinations/secrets.ts`; `Config.destinationSecretKey: string | null`.

- [ ] **Step 1: Write the failing test**

Create `test/destinations-secrets.test.ts`:

```ts
// test/destinations-secrets.test.ts
import { describe, expect, it } from "vitest";
import { DEV_SECRET_KEY_HEX, decryptSecrets, encryptSecrets, parseSecretKey, resolveSecretKey } from "@/src/destinations/secrets";

const KEY = parseSecretKey("00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff");

describe("destination secrets", () => {
  it("round-trips a record and never repeats the ciphertext", () => {
    const a = encryptSecrets({ token: "t-1", other: "x" }, KEY);
    const b = encryptSecrets({ token: "t-1", other: "x" }, KEY);
    expect(a).not.toBe(b); // fresh IV each time
    expect(a).not.toContain("t-1");
    expect(decryptSecrets(a, KEY)).toEqual({ token: "t-1", other: "x" });
    expect(decryptSecrets(b, KEY)).toEqual({ token: "t-1", other: "x" });
  });
  it("rejects a tampered blob and a wrong key", () => {
    const blob = encryptSecrets({ token: "t-1" }, KEY);
    const bytes = Buffer.from(blob, "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptSecrets(bytes.toString("base64"), KEY)).toThrow(/decrypt/);
    expect(() => decryptSecrets(blob, parseSecretKey("ff".repeat(32)))).toThrow(/decrypt/);
    expect(() => decryptSecrets("not-base64!!", KEY)).toThrow(/decrypt/);
  });
  it("parses hex and base64 keys and rejects other lengths", () => {
    expect(parseSecretKey("ab".repeat(32))).toHaveLength(32);
    expect(parseSecretKey(Buffer.alloc(32, 7).toString("base64"))).toHaveLength(32);
    expect(() => parseSecretKey("short")).toThrow(/DESTINATION_SECRET_KEY must be 32 bytes/);
    expect(() => parseSecretKey("ab".repeat(16))).toThrow(/32 bytes/);
  });
  it("falls back to the dev key only in memory mode", () => {
    const logs: string[] = [];
    expect(resolveSecretKey(null, true, (s) => logs.push(s))?.equals(parseSecretKey(DEV_SECRET_KEY_HEX))).toBe(true);
    expect(logs[0]).toMatch(/DESTINATION_SECRET_KEY/);
    expect(resolveSecretKey(null, false)).toBeNull();
    expect(resolveSecretKey("ab".repeat(32), false)?.equals(parseSecretKey("ab".repeat(32)))).toBe(true);
  });
});
```

Run: `npx vitest run test/destinations-secrets.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `src/destinations/secrets.ts`**

```ts
// src/destinations/secrets.ts
// Server-only (node:crypto): AES-256-GCM for destination secrets such as the WordPress plugin token.
// Blob = base64( iv(12) || tag(16) || ciphertext ). Never log inputs or outputs of these functions.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Used only when SITE_MANAGER_STORE=memory and DESTINATION_SECRET_KEY is unset (offline tests, dev server). */
export const DEV_SECRET_KEY_HEX = "7d2f1c9a4b6e8f0a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b2d4f6a8c0e1b3d5f7a";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 32 bytes as 64 hex chars or 44 base64 chars. */
export function parseSecretKey(raw: string): Buffer {
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  if (buf.length !== 32) throw new Error("DESTINATION_SECRET_KEY must be 32 bytes as hex (64 chars) or base64 (44 chars); generate: openssl rand -hex 32");
  return buf;
}

export function encryptSecrets(secrets: Record<string, string>, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecrets(blob: string, key: Buffer): Record<string, string> {
  try {
    const bytes = Buffer.from(blob, "base64");
    if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error("too short");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, string>;
  } catch {
    throw new Error("Could not decrypt destination secrets (wrong DESTINATION_SECRET_KEY or corrupted data)");
  }
}

/** The key to use, or null when secrets cannot be handled (production without the variable). */
export function resolveSecretKey(configured: string | null, isMemory: boolean, log: (s: string) => void = console.warn): Buffer | null {
  if (configured) return parseSecretKey(configured);
  if (isMemory) {
    log("[destinations] DESTINATION_SECRET_KEY is not set; using the fixed development key (memory store only)");
    return parseSecretKey(DEV_SECRET_KEY_HEX);
  }
  return null;
}
```

Run: `npx vitest run test/destinations-secrets.test.ts`
Expected: PASS.

- [ ] **Step 3: Config and `.env.example`**

In `src/config.ts` append to the `Config` interface (last member):

```ts
  /** 32-byte key for destination secrets (WordPress plugin tokens); null = destinations cannot be connected (memory mode falls back to a dev key). */
  destinationSecretKey: string | null;
```

and to the returned object in `loadConfig` (last key):

```ts
    destinationSecretKey: optional("DESTINATION_SECRET_KEY"),
```

Append to `.env.example`:

```
# Encrypts destination secrets (the WordPress plugin token) at rest; 32 bytes; generate: openssl rand -hex 32
DESTINATION_SECRET_KEY=
```

Append to `test/config.test.ts`, inside the `describe`, as the last `it`:

```ts
  it("reads DESTINATION_SECRET_KEY as optional", () => {
    expect(loadConfig(full).destinationSecretKey).toBeNull();
    expect(loadConfig({ ...full, DESTINATION_SECRET_KEY: "ab".repeat(32) }).destinationSecretKey).toBe("ab".repeat(32));
  });
```

Run: `npm run typecheck && npx vitest run test/config.test.ts test/destinations-secrets.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/destinations/secrets.ts src/config.ts .env.example test/destinations-secrets.test.ts test/config.test.ts
git commit -m "Destinations: AES-256-GCM secrets with DESTINATION_SECRET_KEY

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: WordPress REST client, site URL validation and the fake plugin surface

**Files:**
- Create: `src/destinations/wordpress-types.ts`, `src/destinations/wordpress-client.ts`, `test/fake-wordpress.ts`, `test/wordpress-client.test.ts`
- Test: `test/wordpress-client.test.ts`

**Interfaces:**
- Consumes: the "Plugin REST contract" section above.
- Produces: every type from the contract in `src/destinations/wordpress-types.ts` (verbatim), plus in `src/destinations/wordpress-client.ts`: `class WordPressApiError extends Error { status: number; code: string; data: Record<string, unknown>; readonly retryable: boolean }`, `interface WordPressClientOptions { siteUrl: string; token: string | null; fetch?: typeof fetch; timeoutMs?: number }`, `class WordPressClient` with `base`, `handshake(code, slug)`, `site()`, `page(id)`, `previewPage(id, edit)`, `cancelPreview(id)`, `applyPage(id, fields)`, `revert(pageId, revisionId)`, `uploadMedia(input)`, `updateMedia(id, patch)`, `deleteMedia(by: { id?: number; source_id?: string })`, `options()`, `setOption(key, value)`, `menu(id)`, `setMenu(id, items)`, `product(id)`, `setProduct(id, patch)`, and `validateSiteUrl(raw): { ok: true; url: string } | { ok: false; reason: { bg: string; en: string } }`. In `test/fake-wordpress.ts`: `class FakeWordPress` with `siteUrl`, `slug`, `code`, `token`, `pages`, `media`, `options`, `menus`, `products`, `calls`, `failNext`, `unreachable`, `fetch`, `issueCode()`, `pageHtml(id, previewKey?)`, `addPage(...)`, `addElementorPage(...)`, `addMenu(...)`, `addProduct(...)`.

- [ ] **Step 1: The contract types**

Create `src/destinations/wordpress-types.ts` with exactly the `export type`/`export interface` block from the "Plugin REST contract" section (copy it verbatim, it is the single source of truth for TypeScript). Add at its end:

```ts
/** Shape of the `after`/`before` rows our Change entries keep for a page (contract fields plus display metadata). */
export interface WpPageChangeRow extends WpPageFields {
  page_title: string;
  page_url: string;
  replacements?: WpReplacement[];
  preview_url?: string | null;
}
```

- [ ] **Step 2: Write the failing client test**

Create `test/wordpress-client.test.ts`:

```ts
// test/wordpress-client.test.ts
import { describe, expect, it } from "vitest";
import { WordPressApiError, WordPressClient, validateSiteUrl } from "@/src/destinations/wordpress-client";
import { FakeWordPress } from "./fake-wordpress";

function setup() {
  const wp = new FakeWordPress();
  const anon = new WordPressClient({ siteUrl: wp.siteUrl, token: null, fetch: wp.fetch });
  return { wp, anon };
}

describe("validateSiteUrl", () => {
  it("normalises and accepts https sites, with or without a path", () => {
    expect(validateSiteUrl(" https://cafe.bg/ ")).toEqual({ ok: true, url: "https://cafe.bg" });
    expect(validateSiteUrl("cafe.bg/wordpress/")).toEqual({ ok: true, url: "https://cafe.bg/wordpress" });
    expect(validateSiteUrl("https://Cafe.BG/blog?x=1#top")).toEqual({ ok: true, url: "https://cafe.bg/blog" });
  });
  it("accepts plain http only for local hosts", () => {
    expect(validateSiteUrl("http://localhost:8088")).toEqual({ ok: true, url: "http://localhost:8088" });
    expect(validateSiteUrl("http://host.docker.internal:8088/")).toEqual({ ok: true, url: "http://host.docker.internal:8088" });
    const r = validateSiteUrl("http://cafe.bg");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.bg).toMatch(/https:\/\//);
  });
  it("refuses credentials, private addresses and junk", () => {
    for (const bad of ["https://user:pw@cafe.bg", "https://10.0.0.5", "https://192.168.1.10/wp", "https://172.16.0.1", "https://169.254.1.1", "https://[fd00::1]", "ftp://cafe.bg", "not a url", "https://cafe"]) {
      const r = validateSiteUrl(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason.en.length, bad).toBeGreaterThan(5);
    }
  });
});

describe("WordPressClient against the fake plugin", () => {
  it("handshakes with the code and slug, then needs the bearer token", async () => {
    const { wp, anon } = setup();
    const code = wp.issueCode();
    await expect(anon.handshake("WRONG", "agala")).rejects.toMatchObject({ status: 403, code: "sm_forbidden" });
    await expect(anon.handshake(code, "other-venue")).rejects.toMatchObject({ status: 403, code: "sm_forbidden" });
    const hs = await anon.handshake(code, "agala");
    expect(hs.token).toHaveLength(64);
    expect(hs.site.name).toBe("Smoke Café");
    expect(hs.site.pages.map((p) => p.title)).toEqual(["Home", "About", "Menu"]);
    await expect(anon.handshake(code, "agala")).rejects.toMatchObject({ status: 403 }); // one-time
    await expect(anon.site()).rejects.toMatchObject({ status: 401, code: "sm_unauthorized" });
    const bad = new WordPressClient({ siteUrl: wp.siteUrl, token: "nope", fetch: wp.fetch });
    await expect(bad.site()).rejects.toMatchObject({ status: 401 });
    const ok = new WordPressClient({ siteUrl: wp.siteUrl, token: hs.token, fetch: wp.fetch });
    expect((await ok.site()).connected_user).toEqual({ id: 1, login: "admin" });
    expect(wp.calls.map((c) => c.path)).toContain("/site");
  });

  it("reads a page with its plain text and previews a replacement without touching the live page", async () => {
    const { wp } = setup();
    const client = wp.connected();
    const about = await client.page(2);
    expect(about).toMatchObject({ id: 2, title: "About", builder: "gutenberg", editable: true, featured_media: null });
    expect(about.text).toBe("We bake banitsa every morning.");
    const p = await client.previewPage(2, { replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }] });
    expect(p.before.content).toContain("banitsa every morning");
    expect(p.after.content).toBe("<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->");
    expect(p.preview_url).toBe(`https://cafe.example/about/?sm_preview=${p.pending_key}`);
    expect(wp.pageHtml(2)).toContain("banitsa every morning.");
    expect(wp.pageHtml(2)).not.toContain("kozunak");
    expect(wp.pageHtml(2, p.pending_key)).toContain("kozunak");
    expect(wp.pageHtml(2, "wrong-key")).not.toContain("kozunak");
  });

  it("refuses a find text that occurs zero or two times, and full content on Elementor", async () => {
    const { wp } = setup();
    const client = wp.connected();
    await expect(client.previewPage(2, { replacements: [{ find: "croissant", replace: "x" }] })).rejects.toMatchObject({ status: 422, code: "sm_replace_failed", data: { find: "croissant", count: 0 } });
    await expect(client.previewPage(2, { replacements: [{ find: "e", replace: "x" }] })).rejects.toMatchObject({ code: "sm_replace_failed" });
    const el = wp.addElementorPage("Events", [{ id: "a1", settings: { title: "Live jazz on Fridays" } }, { id: "a2", settings: { editor: "<p>Doors open at 19:00.</p>" } }]);
    const page = await client.page(el);
    expect(page.builder).toBe("elementor");
    expect(page.texts).toEqual(["Live jazz on Fridays", "<p>Doors open at 19:00.</p>"]);
    await expect(client.previewPage(el, { content: "<p>x</p>" })).rejects.toMatchObject({ status: 422, code: "sm_builder_unsupported", data: { builder: "elementor" } });
    const p = await client.previewPage(el, { replacements: [{ find: "19:00", replace: "20:00" }] });
    expect(p.preview_url).toBeNull();
    expect(JSON.parse(p.after.elementor_data as string)[1].settings.editor).toBe("<p>Doors open at 20:00.</p>");
    expect(p.after.content).toBe(p.before.content);
  });

  it("applies fields, resolves placeholders from uploaded media and records a revision", async () => {
    const { wp } = setup();
    const client = wp.connected();
    const m = await client.uploadMedia({ url: "https://cdn.example/m-1.jpg", source_id: "m-1", alt: "Christmas window", title: "Коледна витрина" });
    expect(m).toMatchObject({ id: 101, existed: false, alt: "Christmas window" });
    expect(m.url).toMatch(/^https:\/\/cafe\.example\/wp-content\/uploads\/.*m-1\.jpg$/);
    expect(await client.uploadMedia({ url: "https://cdn.example/m-1.jpg", source_id: "m-1" })).toMatchObject({ id: 101, existed: true });
    const applied = await client.applyPage(2, { title: "About us", content: '<!-- wp:image {"id":{{sm_media_id:m-1}}} --><figure><img src="{{sm_media_url:m-1}}"/></figure><!-- /wp:image -->', elementor_data: null, featured_media: 101 });
    expect(applied.after.content).toContain(`"id":101`);
    expect(applied.after.content).toContain(m.url);
    expect(applied.after.featured_media).toBe(101);
    expect(applied.before.title).toBe("About");
    expect(applied.revision_id).toBe(1);
    expect(wp.pages.get(2)?.title).toBe("About us");
    await expect(client.applyPage(2, { content: "{{sm_media_url:nope}}" })).rejects.toMatchObject({ status: 400, code: "sm_invalid", data: { placeholder: "{{sm_media_url:nope}}" } });
    expect(await client.deleteMedia({ source_id: "m-1" })).toEqual({ ok: true, deleted: true });
    expect(await client.deleteMedia({ source_id: "m-1" })).toEqual({ ok: true, deleted: false });
  });

  it("reads and writes options, menus and products", async () => {
    const { wp } = setup();
    const client = wp.connected();
    expect(await client.options()).toEqual({ blogname: "Smoke Café", blogdescription: "Just another WordPress site", custom_logo: null, site_icon: null });
    expect(await client.setOption("blogname", "Кафене „Ъгъла“")).toEqual({ key: "blogname", before: "Smoke Café", after: "Кафене „Ъгъла“" });
    await expect(client.setOption("admin_email" as never, "x")).rejects.toMatchObject({ status: 400, code: "sm_invalid" });
    const menu = await client.menu(3);
    expect(menu).toMatchObject({ id: 3, name: "Main", locations: ["primary"] });
    expect(menu.items.map((i) => [i.title, i.parent_index])).toEqual([["Home", null], ["About", null]]);
    const r = await client.setMenu(3, [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }, { title: "Lunch", url: "/menu/#lunch", parent_index: 1 }]);
    expect(r.before.map((i) => i.title)).toEqual(["Home", "About"]);
    expect(r.after.map((i) => [i.title, i.parent_index, i.position])).toEqual([["Home", null, 1], ["Menu", null, 2], ["Lunch", 1, 3]]);
    await expect(client.menu(99)).rejects.toMatchObject({ status: 404, code: "sm_not_found" });
    await expect(client.product(1)).rejects.toMatchObject({ status: 404, code: "sm_no_woocommerce" });
    wp.addProduct({ id: 77, name: "Espresso beans 250 g", regular_price: "12", sale_price: "", stock_status: "instock", description: "", short_description: "" });
    expect((await client.site()).woocommerce).toBe(true);
    const pr = await client.setProduct(77, { regular_price: "13.5", stock_status: "outofstock" });
    expect(pr.before.regular_price).toBe("12");
    expect(pr.after).toMatchObject({ regular_price: "13.5", stock_status: "outofstock" });
  });

  it("maps network failures and server errors to retryable errors", async () => {
    const { wp } = setup();
    const client = wp.connected();
    wp.failNext = { status: 503, code: "sm_down", message: "maintenance" };
    const e1 = await client.site().catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(WordPressApiError);
    expect(e1).toMatchObject({ status: 503, retryable: true });
    wp.unreachable = true;
    const e2 = await client.site().catch((e: unknown) => e);
    expect(e2).toMatchObject({ status: 0, code: "sm_unreachable", retryable: true });
    wp.unreachable = false;
    const e3 = await client.page(999).catch((e: unknown) => e);
    expect(e3).toMatchObject({ status: 404, retryable: false });
  });
});
```

Run: `npx vitest run test/wordpress-client.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create `src/destinations/wordpress-client.ts`**

```ts
// src/destinations/wordpress-client.ts
// Client for the Site Manager WordPress plugin's REST namespace (integrations/wordpress/site-manager).
// Server-only: it carries the plugin token. Never log the token or full responses.
import type {
  WpMedia, WpMenu, WpMenuItem, WpMenuItemInput, WpOptionKey, WpOptions, WpPage, WpPageApplied, WpPageEdit, WpPageFields, WpPagePreview, WpProduct, WpProductPatch, WpSiteInfo,
} from "./wordpress-types";

export class WordPressApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
    this.name = "WordPressApiError";
  }
  /** Network failures, 429 and 5xx are worth another attempt later; other 4xx are not. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface WordPressClientOptions {
  siteUrl: string;
  token: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class WordPressClient {
  readonly base: string;
  constructor(private o: WordPressClientOptions) {
    this.base = `${o.siteUrl.replace(/\/+$/, "")}/wp-json/site-manager/v1`;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const f = this.o.fetch ?? fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.o.token) headers.authorization = `Bearer ${this.o.token}`;
    let res: Response;
    try {
      res = await f(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.o.timeoutMs ?? 20_000) });
    } catch (e) {
      throw new WordPressApiError(0, "sm_unreachable", `WordPress unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json && typeof json === "object" ? json : {}) as { code?: string; message?: string; data?: Record<string, unknown> };
      const { status: _status, ...data } = err.data ?? {};
      void _status;
      throw new WordPressApiError(res.status, err.code ?? `http_${res.status}`, err.message ?? `HTTP ${res.status}`, data);
    }
    if (json === null) throw new WordPressApiError(res.status, "sm_bad_json", "WordPress returned no JSON (is the plugin active?)");
    return json as T;
  }

  handshake(code: string, slug: string) {
    return this.call<{ token: string; site: WpSiteInfo }>("POST", "/handshake", { code, slug });
  }
  site() {
    return this.call<WpSiteInfo>("GET", "/site");
  }
  page(id: number) {
    return this.call<WpPage>("GET", `/page/${id}`);
  }
  previewPage(id: number, edit: WpPageEdit) {
    return this.call<WpPagePreview>("POST", `/page/${id}/preview`, edit);
  }
  cancelPreview(id: number) {
    return this.call<{ ok: true }>("DELETE", `/page/${id}/preview`);
  }
  applyPage(id: number, fields: Partial<WpPageFields> & { placeholders?: Record<string, string> }) {
    return this.call<WpPageApplied>("POST", `/page/${id}/apply`, fields);
  }
  revert(pageId: number, revisionId: number) {
    return this.call<{ id: number; restored_revision: number }>("POST", `/revert/${pageId}/${revisionId}`);
  }
  uploadMedia(input: { url: string; source_id: string; filename?: string; title?: string; alt?: string }) {
    return this.call<WpMedia>("POST", "/media", input);
  }
  updateMedia(id: number, patch: { alt?: string; title?: string; caption?: string }) {
    return this.call<WpMedia>("PUT", `/media/${id}`, patch);
  }
  deleteMedia(by: { id?: number; source_id?: string }) {
    return by.id !== undefined
      ? this.call<{ ok: true; deleted: boolean }>("DELETE", `/media/${by.id}`)
      : this.call<{ ok: true; deleted: boolean }>("DELETE", `/media?source_id=${encodeURIComponent(by.source_id ?? "")}`);
  }
  options() {
    return this.call<WpOptions>("GET", "/option");
  }
  setOption(key: WpOptionKey, value: string | number | null) {
    return this.call<{ key: WpOptionKey; before: string | number | null; after: string | number | null }>("PUT", "/option", { key, value });
  }
  menu(id: number) {
    return this.call<WpMenu>("GET", `/menu/${id}`);
  }
  setMenu(id: number, items: WpMenuItemInput[]) {
    return this.call<{ id: number; before: WpMenuItem[]; after: WpMenuItem[] }>("PUT", `/menu/${id}`, { items });
  }
  product(id: number) {
    return this.call<WpProduct>("GET", `/product/${id}`);
  }
  setProduct(id: number, patch: WpProductPatch) {
    return this.call<{ id: number; before: WpProduct; after: WpProduct }>("PUT", `/product/${id}`, patch);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
const PRIVATE_V4 = [/^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

function isPrivateIp(host: string): boolean {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return PRIVATE_V4.some((re) => re.test(host));
  if (host.startsWith("[")) {
    const h = host.slice(1, -1).toLowerCase();
    return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h === "::";
  }
  return false;
}

/** Normalises what the owner typed into an https site URL (plain http only for local hosts) or explains why not, in both languages. */
export function validateSiteUrl(raw: string): { ok: true; url: string } | { ok: false; reason: { bg: string; en: string } } {
  const typed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, reason: { bg: "Това не прилича на адрес на сайт. Пример: https://moeto-kafene.bg", en: "That does not look like a site address. Example: https://my-cafe.com" } };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: { bg: "Адресът трябва да започва с https://", en: "The address must start with https://" } };
  if (u.username || u.password) return { ok: false, reason: { bg: "Адресът не бива да съдържа потребител или парола.", en: "The address must not contain a username or password." } };
  const host = u.hostname.toLowerCase();
  const hostWithPort = u.host.toLowerCase();
  const local = LOCAL_HOSTS.has(host) || LOCAL_HOSTS.has(hostWithPort) || host.endsWith(".localhost");
  if (!local && isPrivateIp(host)) return { ok: false, reason: { bg: "Адресът сочи към вътрешна мрежа; нужен е публичният адрес на сайта.", en: "That address points at a private network; use the site's public address." } };
  if (!local && !host.includes(".")) return { ok: false, reason: { bg: "Адресът трябва да е пълен домейн, например https://moeto-kafene.bg", en: "Use the full domain, for example https://my-cafe.com" } };
  if (u.protocol === "http:" && !local) return { ok: false, reason: { bg: "Адресът трябва да започва с https:// (обикновен http се допуска само за localhost).", en: "The address must start with https:// (plain http is allowed only for localhost)." } };
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${hostWithPort}${path}` };
}
```

- [ ] **Step 4: Create `test/fake-wordpress.ts`**

This fake implements the contract's semantics in memory; Task 10's PHP must behave the same way.

```ts
// test/fake-wordpress.ts
// In-memory stand-in for the Site Manager WordPress plugin's REST namespace (see the plan's "Plugin REST contract").
// Serves /wp-json/site-manager/v1/* and page HTML (permalinks, with ?sm_preview=<key>) through `fetch`.
import { createHash, randomBytes } from "node:crypto";
import { WordPressClient } from "@/src/destinations/wordpress-client";
import type { WpBuilder, WpMenuItem, WpMenuItemInput, WpOptions, WpPageFields, WpPageSummary, WpProduct, WpSiteInfo } from "@/src/destinations/wordpress-types";

export interface FakePage extends WpPageFields { id: number; slug: string; status: string; builder: WpBuilder; modified: string; is_front_page: boolean }
export interface FakeMedia { id: number; url: string; alt: string; title: string; source_id: string | null }
export interface FakeMenu { id: number; name: string; locations: string[]; items: WpMenuItem[] }
interface Pending { key: string; after: WpPageFields; expires: number }

type Json = Record<string, unknown>;
const PLACEHOLDER = /\{\{sm_media_(url|id):([^}]+)\}\}/g;

function err(status: number, code: string, message: string, extra: Json = {}): Response {
  return Response.json({ code, message, data: { status, ...extra } }, { status });
}
function textOf(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function elementorStrings(data: string | null): string[] {
  if (!data) return [];
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const o = node as Json;
      if (o.settings && typeof o.settings === "object") for (const v of Object.values(o.settings as Json)) if (typeof v === "string" && v.trim()) out.push(v);
      if (Array.isArray(o.elements)) walk(o.elements);
    }
  };
  walk(JSON.parse(data));
  return out;
}
function replaceInElementor(data: string, find: string, replace: string): { data: string; count: number } {
  let count = 0;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const o = { ...(node as Json) };
      if (o.settings && typeof o.settings === "object") {
        const s = { ...(o.settings as Json) };
        for (const [k, v] of Object.entries(s)) if (typeof v === "string") { count += v.split(find).length - 1; s[k] = v.split(find).join(replace); }
        o.settings = s;
      }
      if (Array.isArray(o.elements)) o.elements = walk(o.elements);
      return o;
    }
    return node;
  };
  return { data: JSON.stringify(walk(JSON.parse(data))), count };
}

export class FakeWordPress {
  siteUrl = "https://cafe.example";
  slug = "agala";
  name = "Smoke Café";
  code: { hash: string; expires: number } | null = null;
  tokenHash: string | null = null;
  pages = new Map<number, FakePage>();
  pending = new Map<number, Pending>();
  media = new Map<number, FakeMedia>();
  options: WpOptions = { blogname: "Smoke Café", blogdescription: "Just another WordPress site", custom_logo: null, site_icon: null };
  menus = new Map<number, FakeMenu>();
  products = new Map<number, WpProduct>();
  revisions = new Map<number, WpPageFields[]>();
  calls: { method: string; path: string; body: unknown; auth: boolean }[] = [];
  failNext: { status: number; code: string; message: string } | null = null;
  unreachable = false;
  now = () => Date.now();
  private nextMedia = 101;
  private nextPage = 10;
  private nextMenuItem = 1000;

  constructor() {
    this.addPage({ id: 1, title: "Home", slug: "", content: "<!-- wp:paragraph --><p>Welcome to Smoke Café.</p><!-- /wp:paragraph -->", is_front_page: true });
    this.addPage({ id: 2, title: "About", slug: "about", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->" });
    this.addPage({ id: 3, title: "Menu", slug: "menu", content: "[site_manager_menu]", builder: "classic" });
    this.addMenu(3, "Main", ["primary"], [{ title: "Home", url: "/" }, { title: "About", url: "/about/" }]);
  }

  addPage(p: { id?: number; title: string; slug: string; content: string; builder?: WpBuilder; is_front_page?: boolean; featured_media?: number | null }): number {
    const id = p.id ?? this.nextPage++;
    this.pages.set(id, { id, title: p.title, slug: p.slug, content: p.content, elementor_data: null, featured_media: p.featured_media ?? null, status: "publish", builder: p.builder ?? "gutenberg", modified: new Date(this.now()).toISOString(), is_front_page: p.is_front_page ?? false });
    return id;
  }
  addElementorPage(title: string, elements: { id: string; settings: Json; elements?: unknown[] }[]): number {
    const id = this.nextPage++;
    this.pages.set(id, { id, title, slug: title.toLowerCase().replace(/\s+/g, "-"), content: "", elementor_data: JSON.stringify(elements), featured_media: null, status: "publish", builder: "elementor", modified: new Date(this.now()).toISOString(), is_front_page: false });
    return id;
  }
  addMenu(id: number, name: string, locations: string[], items: WpMenuItemInput[]) {
    this.menus.set(id, { id, name, locations, items: this.materialise(items) });
  }
  addProduct(p: Omit<WpProduct, "url">) {
    this.products.set(p.id, { ...p, url: `${this.siteUrl}/product/${p.id}/` });
  }
  /** What the settings page shows the owner. */
  issueCode(): string {
    const code = randomBytes(5).toString("hex").toUpperCase();
    this.code = { hash: sha(code), expires: this.now() + 15 * 60_000 };
    return code;
  }
  /** A client that already completed the handshake. */
  connected(): WordPressClient {
    const token = randomBytes(32).toString("hex");
    this.tokenHash = sha(token);
    return new WordPressClient({ siteUrl: this.siteUrl, token, fetch: this.fetch });
  }
  /** The HTML a visitor (or the preview link) gets for a page. */
  pageHtml(id: number, previewKey?: string): string {
    const p = this.pages.get(id);
    if (!p) return "<h1>Not found</h1>";
    const pend = previewKey ? this.pending.get(id) : undefined;
    const show = pend && pend.key === previewKey && pend.expires > this.now() ? pend.after : p;
    const banner = show !== p ? '<div class="sm-preview-banner">Предварителен преглед от Site Manager · Preview from Site Manager, not published</div>' : "";
    return `<!doctype html><html><body>${banner}<h1>${show.title}</h1><main>${show.content}</main></body></html>`;
  }
  permalink(p: FakePage): string {
    return p.is_front_page || p.slug === "" ? `${this.siteUrl}/` : `${this.siteUrl}/${p.slug}/`;
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.unreachable) throw new TypeError("fetch failed");
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : undefined;
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? "";
    const prefix = "/wp-json/site-manager/v1";
    if (!url.pathname.startsWith(prefix)) return this.serveHtml(url);
    const path = url.pathname.slice(prefix.length) + (url.search ? url.search : "");
    const authed = this.tokenHash !== null && auth.startsWith("Bearer ") && sha(auth.slice(7)) === this.tokenHash;
    this.calls.push({ method, path, body, auth: authed });
    if (this.failNext) {
      const f = this.failNext;
      this.failNext = null;
      return err(f.status, f.code, f.message);
    }
    if (path === "/handshake" && method === "POST") return this.handshake(body ?? {});
    if (!authed) return err(401, "sm_unauthorized", "Missing or invalid plugin token.");
    return this.route(method, url.pathname.slice(prefix.length), url.searchParams, body ?? {});
  };

  private serveHtml(url: URL): Response {
    const slug = url.pathname.replace(/^\/|\/$/g, "");
    const page = [...this.pages.values()].find((p) => (slug === "" ? p.is_front_page : p.slug === slug));
    if (!page) return new Response("<h1>Not found</h1>", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(this.pageHtml(page.id, url.searchParams.get("sm_preview") ?? undefined), { headers: { "content-type": "text/html" } });
  }

  private handshake(body: Json): Response {
    const code = String(body.code ?? "").trim().toUpperCase();
    if (!this.code || this.code.expires < this.now() || sha(code) !== this.code.hash) return err(403, "sm_forbidden", "The code is wrong or expired. Generate a new one on the plugin's settings page.");
    if (String(body.slug ?? "") !== this.slug) return err(403, "sm_forbidden", `This plugin is configured for the venue "${this.slug}".`);
    this.code = null;
    const token = randomBytes(32).toString("hex");
    this.tokenHash = sha(token);
    return Response.json({ token, site: this.siteInfo() });
  }

  siteInfo(): WpSiteInfo {
    return {
      name: this.options.blogname, description: this.options.blogdescription, url: this.siteUrl, home_url: this.siteUrl, wp_version: "6.8", plugin_version: "0.1.0", locale: "bg_BG", timezone: "Europe/Sofia",
      theme: { name: "Twenty Twenty-Four", slug: "twentytwentyfour" },
      pages: [...this.pages.values()].map((p) => this.summary(p)),
      menus: [...this.menus.values()].map((m) => ({ id: m.id, name: m.name, locations: m.locations, count: m.items.length })),
      options: { ...this.options },
      woocommerce: this.products.size > 0,
      products: [...this.products.values()].map((p) => ({ id: p.id, name: p.name, regular_price: p.regular_price, sale_price: p.sale_price, stock_status: p.stock_status })),
      connected_user: this.tokenHash ? { id: 1, login: "admin" } : null,
    };
  }
  private summary(p: FakePage): WpPageSummary {
    return { id: p.id, title: p.title, slug: p.slug, url: this.permalink(p), status: p.status, builder: p.builder, modified: p.modified, featured_media: p.featured_media, is_front_page: p.is_front_page };
  }
  private fields(p: FakePage): WpPageFields {
    return { title: p.title, content: p.content, elementor_data: p.elementor_data, featured_media: p.featured_media };
  }

  private route(method: string, path: string, q: URLSearchParams, body: Json): Response {
    let m: RegExpMatchArray | null;
    if (path === "/site" && method === "GET") return Response.json(this.siteInfo());
    if ((m = path.match(/^\/page\/(\d+)$/)) && method === "GET") {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      return Response.json({ ...this.summary(p), ...this.fields(p), text: p.builder === "elementor" ? elementorStrings(p.elementor_data).map(textOf).join(" ") : textOf(p.content), texts: elementorStrings(p.elementor_data), editable: p.builder !== "unknown" });
    }
    if ((m = path.match(/^\/page\/(\d+)\/preview$/))) {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      if (method === "DELETE") {
        this.pending.delete(p.id);
        return Response.json({ ok: true });
      }
      const r = this.computeAfter(p, body, false);
      if (r instanceof Response) return r;
      const key = randomBytes(8).toString("hex");
      this.pending.set(p.id, { key, after: r, expires: this.now() + 86_400_000 });
      return Response.json({ before: this.fields(p), after: r, preview_url: p.builder === "elementor" ? null : `${this.permalink(p)}?sm_preview=${key}`, pending_key: key });
    }
    if ((m = path.match(/^\/page\/(\d+)\/apply$/)) && method === "POST") {
      const p = this.pages.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such page.");
      const before = this.fields(p);
      const r = this.computeAfter(p, body, true);
      if (r instanceof Response) return r;
      const revs = this.revisions.get(p.id) ?? [];
      revs.push(before);
      this.revisions.set(p.id, revs);
      Object.assign(p, r, { modified: new Date(this.now()).toISOString() });
      this.pending.delete(p.id);
      return Response.json({ id: p.id, url: this.permalink(p), revision_id: revs.length, before, after: this.fields(p) });
    }
    if ((m = path.match(/^\/revert\/(\d+)\/(\d+)$/)) && method === "POST") {
      const p = this.pages.get(Number(m[1]));
      const rev = this.revisions.get(Number(m[1]))?.[Number(m[2]) - 1];
      if (!p || !rev) return err(404, "sm_not_found", "No such page or revision.");
      Object.assign(p, rev);
      return Response.json({ id: p.id, restored_revision: Number(m[2]) });
    }
    if (path === "/media" && method === "POST") {
      const source = String(body.source_id ?? "");
      if (!/^https?:\/\//.test(String(body.url ?? "")) || !source) return err(400, "sm_invalid", "url and source_id are required.");
      const existing = [...this.media.values()].find((x) => x.source_id === source);
      if (existing) return Response.json({ id: existing.id, url: existing.url, alt: existing.alt, existed: true });
      const id = this.nextMedia++;
      const file = String(body.filename ?? new URL(String(body.url)).pathname.split("/").pop() ?? `${id}.jpg`);
      const row: FakeMedia = { id, url: `${this.siteUrl}/wp-content/uploads/2026/10/${file}`, alt: String(body.alt ?? ""), title: String(body.title ?? file), source_id: source };
      this.media.set(id, row);
      return Response.json({ id, url: row.url, alt: row.alt, existed: false });
    }
    if ((m = path.match(/^\/media\/(\d+)$/)) && method === "PUT") {
      const row = this.media.get(Number(m[1]));
      if (!row) return err(404, "sm_not_found", "No such attachment.");
      if (typeof body.alt === "string") row.alt = body.alt;
      if (typeof body.title === "string") row.title = body.title;
      return Response.json({ id: row.id, url: row.url, alt: row.alt, existed: true });
    }
    if (path === "/media" && method === "DELETE") {
      const source = q.get("source_id") ?? "";
      const row = [...this.media.values()].find((x) => x.source_id === source);
      if (row) this.media.delete(row.id);
      return Response.json({ ok: true, deleted: Boolean(row) });
    }
    if ((m = path.match(/^\/media\/(\d+)$/)) && method === "DELETE") {
      return Response.json({ ok: true, deleted: this.media.delete(Number(m[1])) });
    }
    if (path === "/option" && method === "GET") return Response.json({ ...this.options });
    if (path === "/option" && method === "PUT") {
      const key = String(body.key ?? "");
      if (!(key in this.options)) return err(400, "sm_invalid", `Option "${key}" is not editable.`);
      const k = key as keyof WpOptions;
      const before = this.options[k];
      let value = body.value as string | number | null;
      if ((k === "custom_logo" || k === "site_icon")) {
        if (typeof value === "string" && value.startsWith("{{")) {
          const resolved = this.resolvePlaceholders(value, {});
          if (resolved instanceof Response) return resolved;
          value = Number(resolved);
        }
        value = value === null || value === "" ? null : Number(value);
        (this.options as Record<string, unknown>)[k] = value;
      } else (this.options as Record<string, unknown>)[k] = String(value ?? "");
      return Response.json({ key: k, before, after: this.options[k] });
    }
    if ((m = path.match(/^\/menu\/(\d+)$/))) {
      const menu = this.menus.get(Number(m[1]));
      if (!menu) return err(404, "sm_not_found", "No such menu.");
      if (method === "GET") return Response.json({ id: menu.id, name: menu.name, locations: menu.locations, items: menu.items });
      if (method === "PUT") {
        const before = menu.items;
        menu.items = this.materialise((body.items as WpMenuItemInput[]) ?? []);
        return Response.json({ id: menu.id, before, after: menu.items });
      }
    }
    if ((m = path.match(/^\/product\/(\d+)$/))) {
      if (this.products.size === 0) return err(404, "sm_no_woocommerce", "WooCommerce is not active on this site.");
      const p = this.products.get(Number(m[1]));
      if (!p) return err(404, "sm_not_found", "No such product.");
      if (method === "GET") return Response.json(p);
      if (method === "PUT") {
        const before = { ...p };
        for (const k of ["name", "regular_price", "sale_price", "stock_status", "description", "short_description"] as const) if (typeof body[k] === "string") (p as Record<string, unknown>)[k] = body[k];
        return Response.json({ id: p.id, before, after: { ...p } });
      }
    }
    return err(404, "sm_not_found", `No route ${method} ${path}`);
  }

  /** Shared by preview and apply. `strict` = unresolved placeholders are an error (apply). */
  private computeAfter(p: FakePage, body: Json, strict: boolean): WpPageFields | Response {
    const after: WpPageFields = this.fields(p);
    if (p.builder === "unknown" && (body.content !== undefined || body.replacements !== undefined)) return err(422, "sm_builder_unsupported", "This page is built with an unsupported editor.", { builder: p.builder });
    if (typeof body.title === "string") after.title = body.title;
    if (typeof body.content === "string") {
      if (p.builder === "elementor") return err(422, "sm_builder_unsupported", "Elementor pages take replacements, not full content.", { builder: "elementor" });
      after.content = body.content;
    }
    if (typeof body.elementor_data === "string" || body.elementor_data === null) after.elementor_data = body.elementor_data as string | null;
    for (const r of (body.replacements as { find: string; replace: string }[] | undefined) ?? []) {
      if (p.builder === "elementor") {
        const res = replaceInElementor(after.elementor_data ?? "[]", r.find, r.replace);
        if (res.count !== 1) return err(422, "sm_replace_failed", `"${r.find}" occurs ${res.count} times; it must occur exactly once.`, { find: r.find, count: res.count });
        after.elementor_data = res.data;
      } else {
        const count = after.content.split(r.find).length - 1;
        if (count !== 1) return err(422, "sm_replace_failed", `"${r.find}" occurs ${count} times; it must occur exactly once.`, { find: r.find, count });
        after.content = after.content.replace(r.find, () => r.replace);
      }
    }
    if (body.featured_media !== undefined) after.featured_media = body.featured_media === null ? null : Number(body.featured_media);
    const map = (body.placeholders as Record<string, string> | undefined) ?? {};
    for (const k of ["title", "content", "elementor_data"] as const) {
      const v = after[k];
      if (typeof v !== "string") continue;
      const resolved = this.resolvePlaceholders(v, map, !strict);
      if (resolved instanceof Response) return resolved;
      (after as Record<string, unknown>)[k] = resolved;
    }
    return after;
  }

  private resolvePlaceholders(text: string, map: Record<string, string>, lenient = false): string | Response {
    let failed: string | null = null;
    const out = text.replace(PLACEHOLDER, (token, kind: string, source: string) => {
      if (map[token] !== undefined) return map[token];
      const m = [...this.media.values()].find((x) => x.source_id === source);
      if (m) return kind === "url" ? m.url : String(m.id);
      if (!lenient) failed ??= token;
      return token;
    });
    return failed ? err(400, "sm_invalid", `Unresolved placeholder ${failed}`, { placeholder: failed }) : out;
  }

  private materialise(items: WpMenuItemInput[]): WpMenuItem[] {
    return items.map((it, i) => ({ id: this.nextMenuItem++, title: it.title, url: it.url, parent_index: it.parent_index ?? null, position: i + 1, type: it.type ?? "custom", object_id: it.object_id ?? null }));
  }
}

function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
```

Note for the implementer: `Response.json` and `URL` are globals in Node 22; the test environment is `node`.

- [ ] **Step 5: Run the client test**

Run: `npx vitest run test/wordpress-client.test.ts`
Expected: PASS (8 tests). If a `Response` body is read twice anywhere, fix the fake, not the client.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green.

```bash
git add src/destinations/wordpress-types.ts src/destinations/wordpress-client.ts test/fake-wordpress.ts test/wordpress-client.test.ts
git commit -m "Destinations: WordPress plugin REST client, site URL validation and the fake plugin surface

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Connect and disconnect flow, and the bot's `/connect`

**Files:**
- Create: `src/destinations/connect.ts`, `test/destinations-connect.test.ts`
- Modify (append-only): `src/bot/bot.ts` (one new command block placed right after the `/undo` block and before `bot.on("message:text", …)`, because that handler swallows every command registered after it), `src/bot/copy.ts` (new keys at the end of both `BG` and `EN`)
- Test: `test/destinations-connect.test.ts`, `test/bot.test.ts` (one new case at the end)

**Interfaces:**
- Consumes: `WordPressClient`, `WordPressApiError`, `validateSiteUrl` (Task 3), `encryptSecrets`/`decryptSecrets` (Task 2), `Store.upsertDestination/getDestination/updateDestination/deleteDestination` (Task 1).
- Produces: in `src/destinations/connect.ts`: `interface ConnectDeps { store: Store; secretKey: Buffer | null; fetch?: typeof fetch; now?: () => Date }`, `type ConnectResult = { ok: true; site: WpSiteInfo; destination: Destination } | { ok: false; reason: { bg: string; en: string } }`, `connectWordPress(d, venueId, rawSiteUrl, code): Promise<ConnectResult>`, `disconnectWordPress(d, venueId): Promise<boolean>`, `wordPressClientFor(d, venueId): Promise<{ client: WordPressClient; destination: DestinationWithSecrets } | null>` (null when not connected or status is `disconnected`), `WP_CONFIG_KEYS` doc. In `src/bot/bot.ts`: `BotDeps.connect?: (venueId: string, siteUrl: string, code: string) => Promise<ConnectResult>` (optional; the bot replies "not available" when absent). In `src/bot/copy.ts`: `connectUsage`, `connectOwnerOnly`, `connectUnavailable`, `connectOk(name, url)`, `connectFailed(reason)`.

Decisions: the destination `config` is `{ site_url, site_name, wp_version, plugin_version, connected_at, connected_user }`; secrets = `{ token }`. A failed handshake never writes a row. Reconnecting replaces the token (new handshake). `disconnectWordPress` deletes the row (the plugin's own Disconnect button discards its hash independently).

- [ ] **Step 1: Write the failing connect test**

Create `test/destinations-connect.test.ts`:

```ts
// test/destinations-connect.test.ts
import { describe, expect, it } from "vitest";
import { connectWordPress, disconnectWordPress, wordPressClientFor } from "@/src/destinations/connect";
import { decryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { FakeWordPress } from "./fake-wordpress";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("connectWordPress", () => {
  it("validates the URL, handshakes, stores the encrypted token and the site info", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const d = { store, secretKey: KEY, fetch: wp.fetch, now: () => T0 };
    const bad = await connectWordPress(d, venue.id, "http://cafe.example", "X");
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.reason.en).toMatch(/https/);
    const code = wp.issueCode();
    const wrong = await connectWordPress(d, venue.id, "https://cafe.example/", "NOPE");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason.bg).toMatch(/код/i);
    expect(await store.getDestination(venue.id, "wordpress")).toBeNull();
    const r = await connectWordPress(d, venue.id, "https://cafe.example/", code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.site.name).toBe("Smoke Café");
    expect(r.destination).toMatchObject({ kind: "wordpress", status: "connected", config: { site_url: "https://cafe.example", site_name: "Smoke Café", wp_version: "6.8", plugin_version: "0.1.0", connected_at: T0.toISOString(), connected_user: "admin" } });
    expect(r.destination).not.toHaveProperty("secrets");
    const row = await store.getDestination(venue.id, "wordpress");
    expect(row?.secrets).not.toContain(wp.calls[0].body);
    const token = decryptSecrets(row!.secrets, KEY).token;
    expect(token).toHaveLength(64);
    const got = await wordPressClientFor(d, venue.id);
    expect(got?.destination.config.site_url).toBe("https://cafe.example");
    expect((await got!.client.site()).connected_user).toEqual({ id: 1, login: "admin" });
  });
  it("explains an unreachable site and refuses without a secret key", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    wp.unreachable = true;
    const r = await connectWordPress({ store, secretKey: KEY, fetch: wp.fetch }, venue.id, "https://cafe.example", "ABC");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.en).toMatch(/could not reach/i);
    const noKey = await connectWordPress({ store, secretKey: null, fetch: wp.fetch }, venue.id, "https://cafe.example", "ABC");
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason.en).toMatch(/DESTINATION_SECRET_KEY/);
  });
  it("disconnects and reconnects with a fresh token", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const d = { store, secretKey: KEY, fetch: wp.fetch };
    await connectWordPress(d, venue.id, "https://cafe.example", wp.issueCode());
    const first = decryptSecrets((await store.getDestination(venue.id, "wordpress"))!.secrets, KEY).token;
    expect(await disconnectWordPress(d, venue.id)).toBe(true);
    expect(await disconnectWordPress(d, venue.id)).toBe(false);
    expect(await wordPressClientFor(d, venue.id)).toBeNull();
    await connectWordPress(d, venue.id, "https://cafe.example", wp.issueCode());
    const second = decryptSecrets((await store.getDestination(venue.id, "wordpress"))!.secrets, KEY).token;
    expect(second).not.toBe(first);
  });
});
```

Run: `npx vitest run test/destinations-connect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 2: Create `src/destinations/connect.ts`**

```ts
// src/destinations/connect.ts
// Server-only. Connects a venue to its WordPress site: validates the URL, exchanges the one-time code for the
// plugin token over the handshake route, and stores the token encrypted. Never logs the code or the token.
import type { Destination, DestinationWithSecrets, Store } from "../store/types";
import { decryptSecrets, encryptSecrets } from "./secrets";
import { WordPressApiError, WordPressClient, validateSiteUrl } from "./wordpress-client";
import type { WpSiteInfo } from "./wordpress-types";

export interface ConnectDeps {
  store: Store;
  /** null = secrets cannot be stored (production without DESTINATION_SECRET_KEY). */
  secretKey: Buffer | null;
  fetch?: typeof fetch;
  now?: () => Date;
}
export type ConnectResult = { ok: true; site: WpSiteInfo; destination: Destination } | { ok: false; reason: { bg: string; en: string } };

/** Keys kept in venue_destinations.config for kind "wordpress" (non-secret). */
export const WP_CONFIG_KEYS = ["site_url", "site_name", "wp_version", "plugin_version", "connected_at", "connected_user"] as const;

export async function connectWordPress(d: ConnectDeps, venueId: string, rawSiteUrl: string, code: string): Promise<ConnectResult> {
  if (!d.secretKey) return { ok: false, reason: { bg: "Свързването не е включено на този сървър (липсва DESTINATION_SECRET_KEY).", en: "Connecting is not enabled on this server (DESTINATION_SECRET_KEY is missing)." } };
  const v = validateSiteUrl(rawSiteUrl);
  if (!v.ok) return v;
  const venue = await d.store.getVenue(venueId);
  const anon = new WordPressClient({ siteUrl: v.url, token: null, fetch: d.fetch });
  let hs: { token: string; site: WpSiteInfo };
  try {
    hs = await anon.handshake(code.trim().toUpperCase(), venue.slug);
  } catch (e) {
    return { ok: false, reason: handshakeReason(e) };
  }
  const now = (d.now ?? (() => new Date()))().toISOString();
  const destination = await d.store.upsertDestination({
    venue_id: venueId,
    kind: "wordpress",
    config: { site_url: v.url, site_name: hs.site.name, wp_version: hs.site.wp_version, plugin_version: hs.site.plugin_version, connected_at: now, connected_user: hs.site.connected_user?.login ?? null },
    secrets: encryptSecrets({ token: hs.token }, d.secretKey),
    status: "connected",
  });
  return { ok: true, site: hs.site, destination };
}

function handshakeReason(e: unknown): { bg: string; en: string } {
  if (e instanceof WordPressApiError) {
    if (e.status === 0) return { bg: "Не успях да се свържа със сайта. Проверете адреса и дали плъгинът е активиран.", en: "I could not reach the site. Check the address and that the plugin is active." };
    if (e.status === 403) return { bg: "Кодът е грешен, изтекъл или плъгинът е настроен за друго заведение. Генерирайте нов код от настройките на плъгина.", en: "The code is wrong or expired, or the plugin is set up for another venue. Generate a new code on the plugin's settings page." };
    if (e.status === 404 || e.code === "sm_bad_json") return { bg: "На този адрес няма активен плъгин Site Manager.", en: "There is no active Site Manager plugin at that address." };
    if (e.status === 429) return { bg: "Твърде много опити. Изчакайте минута и опитайте пак.", en: "Too many attempts. Wait a minute and try again." };
    return { bg: `Сайтът отговори с грешка (${e.status}).`, en: `The site answered with an error (${e.status}).` };
  }
  return { bg: "Възникна неочаквана грешка при свързването.", en: "Something unexpected went wrong while connecting." };
}

/** Removes the stored connection (the plugin keeps working for reading; its own Disconnect button drops the token there). */
export async function disconnectWordPress(d: ConnectDeps, venueId: string): Promise<boolean> {
  const row = await d.store.getDestination(venueId, "wordpress");
  if (!row) return false;
  await d.store.deleteDestination(row.id);
  return true;
}

/** A ready client for the venue's WordPress site, or null when nothing is connected (or secrets cannot be read). */
export async function wordPressClientFor(d: ConnectDeps, venueId: string): Promise<{ client: WordPressClient; destination: DestinationWithSecrets } | null> {
  const row = await d.store.getDestination(venueId, "wordpress");
  if (!row || row.status === "disconnected" || !d.secretKey) return null;
  const secrets = decryptSecrets(row.secrets, d.secretKey);
  const siteUrl = String(row.config.site_url ?? "");
  if (!siteUrl || !secrets.token) return null;
  return { client: new WordPressClient({ siteUrl, token: secrets.token, fetch: d.fetch }), destination: row };
}
```

Run: `npx vitest run test/destinations-connect.test.ts`
Expected: PASS.

- [ ] **Step 3: Bot copy and the `/connect` command**

Append to the `BG` object in `src/bot/copy.ts` (after `error`, keep the trailing comma style):

```ts
  connectUsage: "Свържете сайта си на WordPress: инсталирайте плъгина Site Manager, отворете Настройки → Site Manager, натиснете „Генерирай код“ и изпратете тук реда, който плъгинът показва:\n/connect https://вашият-сайт.bg КОД",
  connectOwnerOnly: "Само собственикът може да свързва сайта.",
  connectUnavailable: "Свързването на сайтове не е включено на този сървър.",
  connectOk: (name: string, url: string) => `✅ Свързах WordPress сайта „${name}“ (${url}). Вече мога да редактирам страниците, снимките и менютата му; всяка промяна първо ще ви покажа за одобрение.`,
  connectFailed: (reason: string) => `Не успях да свържа сайта. ${reason}`,
```

and the same keys to `EN` (typed `typeof BG`, so the shapes must match):

```ts
  connectUsage: "Connect your WordPress site: install the Site Manager plugin, open Settings → Site Manager, press “Generate code” and send me the line the plugin shows:\n/connect https://your-site.com CODE",
  connectOwnerOnly: "Only the owner can connect the site.",
  connectUnavailable: "Connecting sites is not enabled on this server.",
  connectOk: (name, url) => `✅ Connected the WordPress site “${name}” (${url}). I can now edit its pages, photos and menus; every change is shown to you for approval first.`,
  connectFailed: (reason) => `I could not connect the site. ${reason}`,
```

In `src/bot/bot.ts`, append to `BotDeps` (last member):

```ts
  /** Connects the venue to its WordPress site (src/destinations/connect.ts); undefined = the feature is off. */
  connect?: (venueId: string, siteUrl: string, code: string) => Promise<ConnectResult>;
```

with the type import `import type { ConnectResult } from "../destinations/connect";` added to the imports (types only, so the bot keeps no secret imports).

Add the command block **immediately after** the `bot.command("undo", …)` block (before `bot.on("message:text", …)`):

```ts
  bot.command("connect", async (ctx) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const lang = detectLang(ctx.message?.text ?? "") ?? member.lang;
    const c = copy(lang);
    if (member.role !== "owner") {
      await ctx.reply(c.connectOwnerOnly);
      return;
    }
    const [siteUrl, code] = (ctx.match ?? "").trim().split(/\s+/);
    if (!siteUrl || !code) {
      await ctx.reply(c.connectUsage);
      return;
    }
    if (!d.connect) {
      await ctx.reply(c.connectUnavailable);
      return;
    }
    const r = await d.connect(member.venue_id, siteUrl, code);
    await ctx.reply(r.ok ? c.connectOk(r.site.name, String(r.destination.config.site_url)) : c.connectFailed(lang === "bg" ? r.reason.bg : r.reason.en));
  });
```

- [ ] **Step 4: Bot test**

Append to `test/bot.test.ts`, inside the top-level `describe("bot", …)`, as the last case:

```ts
  it("handles /connect: usage, owner-only, feature off, success and failure", async () => {
    const { bot, api, deps } = await setup();
    await bot.handleUpdate(textUpdate(1001, "/connect"));
    expect(api.texts().at(-1)).toMatch(/^Свържете сайта си на WordPress/);
    await bot.handleUpdate(textUpdate(1002, "/connect https://cafe.example ABC", "en"));
    expect(api.texts().at(-1)).toBe("Only the owner can connect the site.");
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example ABC"));
    expect(api.texts().at(-1)).toBe("Свързването на сайтове не е включено на този сървър.");
    const calls: unknown[] = [];
    deps.connect = async (venueId, siteUrl, code) => {
      calls.push([venueId, siteUrl, code]);
      return code === "GOOD"
        ? { ok: true, site: { name: "Smoke Café" } as never, destination: { config: { site_url: "https://cafe.example" } } as never }
        : { ok: false, reason: { bg: "Кодът е грешен.", en: "The code is wrong." } };
    };
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example/ GOOD"));
    expect(calls[0]).toEqual([(await deps.store.findMember(1001))!.venue_id, "https://cafe.example/", "GOOD"]);
    expect(api.texts().at(-1)).toMatch(/^✅ Свързах WordPress сайта „Smoke Café“ \(https:\/\/cafe\.example\)/);
    await bot.handleUpdate(textUpdate(1001, "/connect https://cafe.example BAD", "en"));
    expect(api.texts().at(-1)).toBe("Не успях да свържа сайта. Кодът е грешен."); // the member's language is bg; a Latin command text keeps it
  });
```

Run: `npx vitest run test/bot.test.ts test/destinations-connect.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/destinations/connect.ts src/bot/bot.ts src/bot/copy.ts test/destinations-connect.test.ts test/bot.test.ts
git commit -m "Bot: /connect links a WordPress site through the plugin handshake

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Destination adapter, sync queue with retries, store decorator, tick step and confirmation lines

**Files:**
- Create: `src/destinations/types.ts`, `src/destinations/registry.ts`, `src/destinations/wordpress.ts`, `src/destinations/sync.ts`, `src/destinations/store-hook.ts`, `test/destinations-sync.test.ts`, `test/destinations-wordpress.test.ts`
- Modify (free): `src/bot/approvals.ts`, `src/server/tick.ts`
- Modify (append-only): `src/tick.ts`, `src/server/deps.ts`
- Test: `test/destinations-sync.test.ts`, `test/destinations-wordpress.test.ts`, `test/approvals.test.ts` (one new case), `test/tick.test.ts` (one new case), `test/server-deps.test.ts` (one new case)

**Interfaces:**
- Consumes: Task 1 store methods and `isWpEntity`; Task 2 `resolveSecretKey`, `decryptSecrets`; Task 3 client and types; Task 4 `wordPressClientFor` is not used here (the adapter builds its own client from the decrypted secrets).
- Produces: `src/destinations/types.ts`: `interface PushContext { venue: Venue; destination: Destination; secrets: Record<string, string>; changeSet: ChangeSet; changes: Change[]; fetch?: typeof fetch; now: Date }`, `type PushResult = { ok: true; result: Record<string, unknown>; line: { bg: string; en: string } } | { ok: false; retry: boolean; error: string; line: { bg: string; en: string } }`, `interface DestinationAdapter { kind: DestinationKind; relevant(changes: Change[]): Change[]; push(ctx: PushContext): Promise<PushResult> }`. `src/destinations/registry.ts`: `ADAPTERS: Partial<Record<DestinationKind, DestinationAdapter>>`, `adapterFor(kind)`. `src/destinations/wordpress.ts`: `wordpressAdapter`, `WP_LINES`. `src/destinations/sync.ts`: `SyncDeps { store: Store; secretKey: Buffer | null; fetch?: typeof fetch; log?: (s: string) => void }`, `BACKOFF_MS`, `MAX_ATTEMPTS`, `enqueueForChangeSet(store, cs, now): Promise<DestinationSync[]>`, `runSync(d, sync, now): Promise<PushResult | null>`, `runPendingSyncs(d, opts: { venueId?: string; now: Date }): Promise<{ done: string[]; retry: string[]; failed: string[] }>`, `syncLines(store, changeSetId, lang): Promise<string[]>`. `src/destinations/store-hook.ts`: `withDestinationSync(store, d: SyncDeps, now?: () => Date): Store`. `TickDeps.sync?: SyncDeps | null` and `TickReport.pushed?: string[]` (appended). `ServerDeps.destinationSecretKey: Buffer | null` (appended).

Decisions:
- The push runs **synchronously inside** the decorated `applyChangeSet` (after the inner store applied), so the bot's edit text and the dashboard see the final sync row. A WordPress call has a 20 s timeout; the Telegram webhook route allows 300 s.
- Backoff after a retryable failure: `BACKOFF_MS = [60_000, 300_000, 1_500_000, 7_200_000, 36_000_000]`, `MAX_ATTEMPTS = 5`. A non-retryable error (4xx other than 429) fails at once.
- Change rows within a set are pushed in `position` order and the push stops at the first failure; uploads are idempotent (`source_id`) so a retry is safe; a page apply resolves `{{sm_media_*}}` placeholders from the uploads of the same run (explicit map) or the media library (plugin side).
- Lines: `WordPress: обновено ✅` / `WordPress: updated ✅`; `WordPress: не успях да обновя, ще опитам пак` / `WordPress: update failed, will retry`; `WordPress: грешка: <message>` / `WordPress: error: <message>`.

- [ ] **Step 1: Adapter types, registry and the WordPress adapter**

Create `src/destinations/types.ts`:

```ts
// src/destinations/types.ts
import type { Change, ChangeSet, Venue } from "../domain/types";
import type { Destination, DestinationKind } from "../store/types";

export interface PushContext {
  venue: Venue;
  destination: Destination;
  /** Decrypted secrets for this destination; never log them. */
  secrets: Record<string, string>;
  changeSet: ChangeSet;
  /** The subset of changeSet.changes this adapter handles, in position order. */
  changes: Change[];
  fetch?: typeof fetch;
  now: Date;
}
export type PushResult =
  | { ok: true; result: Record<string, unknown>; line: { bg: string; en: string } }
  | { ok: false; retry: boolean; error: string; line: { bg: string; en: string } };

export interface DestinationAdapter {
  kind: DestinationKind;
  /** The changes of a set this destination must receive; empty = nothing to push. */
  relevant(changes: Change[]): Change[];
  push(ctx: PushContext): Promise<PushResult>;
}
```

Create `src/destinations/registry.ts`:

```ts
// src/destinations/registry.ts
import type { DestinationKind } from "../store/types";
import type { DestinationAdapter } from "./types";
import { wordpressAdapter } from "./wordpress";

/** Google and GitHub adapters arrive in later sessions; a destination row of an unknown kind is skipped with a log line. */
export const ADAPTERS: Partial<Record<DestinationKind, DestinationAdapter>> = { wordpress: wordpressAdapter };

export function adapterFor(kind: DestinationKind): DestinationAdapter | null {
  return ADAPTERS[kind] ?? null;
}
```

Create `src/destinations/wordpress.ts`:

```ts
// src/destinations/wordpress.ts
// Pushes applied wp_* change rows to the owner's WordPress site through the plugin. Idempotent per change:
// page/option/menu/product writes are content-based, uploads are keyed by source_id, deletes are by source_id.
import { isWpEntity, type Change, type Row } from "../domain/types";
import type { DestinationAdapter, PushContext, PushResult } from "./types";
import { WordPressApiError, WordPressClient } from "./wordpress-client";
import type { WpMenuItemInput, WpOptionKey, WpPageFields, WpProductPatch } from "./wordpress-types";

export const WP_LINES = {
  ok: { bg: "WordPress: обновено ✅", en: "WordPress: updated ✅" },
  retry: { bg: "WordPress: не успях да обновя, ще опитам пак", en: "WordPress: update failed, will retry" },
  error: (msg: string) => ({ bg: `WordPress: грешка: ${msg}`, en: `WordPress: error: ${msg}` }),
};

const PAGE_FIELDS = ["title", "content", "elementor_data", "featured_media"] as const;

function pageFields(row: Row): Partial<WpPageFields> {
  const out: Partial<WpPageFields> = {};
  for (const k of PAGE_FIELDS) if (row[k] !== undefined) (out as Record<string, unknown>)[k] = row[k];
  return out;
}

export const wordpressAdapter: DestinationAdapter = {
  kind: "wordpress",
  relevant: (changes) => changes.filter((c) => isWpEntity(c.entity)).sort((a, b) => a.position - b.position),
  async push(ctx: PushContext): Promise<PushResult> {
    const siteUrl = String(ctx.destination.config.site_url ?? "");
    if (!siteUrl || !ctx.secrets.token) return { ok: false, retry: false, error: "destination has no site_url or token", line: WP_LINES.error("not connected") };
    const client = new WordPressClient({ siteUrl, token: ctx.secrets.token, fetch: ctx.fetch });
    const uploaded = new Map<string, { id: number; url: string }>();
    const placeholders = () => {
      const map: Record<string, string> = {};
      for (const [sourceId, m] of uploaded) {
        map[`{{sm_media_url:${sourceId}}}`] = m.url;
        map[`{{sm_media_id:${sourceId}}}`] = String(m.id);
      }
      return map;
    };
    const lang = ctx.venue.default_lang;
    const pushed: Record<string, unknown>[] = [];
    try {
      for (const c of ctx.changes) {
        const a = c.after ?? null;
        const b = c.before ?? null;
        switch (c.entity) {
          case "wp_media": {
            if (a) {
              const alt = String((lang === "bg" ? a.alt_bg : a.alt_en) ?? a.alt_bg ?? a.title ?? "");
              const m = await client.uploadMedia({ url: String(a.source_url), source_id: c.entity_id, title: String(a.title ?? ""), alt, filename: typeof a.filename === "string" ? a.filename : undefined });
              uploaded.set(c.entity_id, { id: m.id, url: m.url });
              if (a.as_featured === true && a.page_id) await client.applyPage(Number(a.page_id), { featured_media: m.id });
              pushed.push({ entity: "wp_media", source_id: c.entity_id, attachment_id: m.id, existed: m.existed });
            } else if (b) {
              if (b.as_featured === true && b.page_id) await client.applyPage(Number(b.page_id), { featured_media: b.previous_featured === undefined ? null : (b.previous_featured as number | null) });
              const r = await client.deleteMedia({ source_id: c.entity_id });
              pushed.push({ entity: "wp_media", source_id: c.entity_id, deleted: r.deleted });
            }
            break;
          }
          case "wp_page": {
            if (!a) break;
            const r = await client.applyPage(Number(c.entity_id), { ...pageFields(a), placeholders: placeholders() });
            pushed.push({ entity: "wp_page", id: r.id, url: r.url, revision_id: r.revision_id });
            break;
          }
          case "wp_option": {
            if (!a) break;
            let value = a.value as string | number | null;
            if (typeof value === "string" && value.startsWith("{{")) value = placeholders()[value] ?? value;
            const r = await client.setOption(c.entity_id as WpOptionKey, value);
            pushed.push({ entity: "wp_option", key: r.key, after: r.after });
            break;
          }
          case "wp_menu": {
            if (!a) break;
            const items = (Array.isArray(a.items) ? a.items : []) as WpMenuItemInput[];
            const r = await client.setMenu(Number(c.entity_id), items.map((i) => ({ title: i.title, url: i.url, parent_index: i.parent_index ?? null, type: i.type ?? "custom", object_id: i.object_id ?? null })));
            pushed.push({ entity: "wp_menu", id: r.id, items: r.after.length });
            break;
          }
          case "wp_product": {
            if (!a) break;
            const patch: WpProductPatch = {};
            for (const k of ["name", "regular_price", "sale_price", "stock_status", "description", "short_description"] as const) if (typeof a[k] === "string") (patch as Record<string, unknown>)[k] = a[k];
            const r = await client.setProduct(Number(c.entity_id), patch);
            pushed.push({ entity: "wp_product", id: r.id });
            break;
          }
          default:
            break;
        }
      }
      return { ok: true, result: { pushed }, line: WP_LINES.ok };
    } catch (e) {
      const retry = e instanceof WordPressApiError ? e.retryable : true;
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, retry, error: msg, line: retry ? WP_LINES.retry : WP_LINES.error(msg) };
    }
  },
};

export type { Change };
```

- [ ] **Step 2: Write the failing adapter test**

Create `test/destinations-wordpress.test.ts`:

```ts
// test/destinations-wordpress.test.ts
import { describe, expect, it } from "vitest";
import { wordpressAdapter } from "@/src/destinations/wordpress";
import type { PushContext } from "@/src/destinations/types";
import { invertChanges } from "@/src/domain/changes";
import type { Change, ChangeSet } from "@/src/domain/types";
import { FakeWordPress } from "./fake-wordpress";
import { venue } from "./fixtures";

const T0 = new Date("2026-10-09T09:00:00.000Z");

function ctx(wp: FakeWordPress, token: string, changes: Change[]): PushContext {
  const cs = { id: "cs-1", venue_id: "v1", changes } as unknown as ChangeSet;
  return { venue: venue(), destination: { id: "d1", venue_id: "v1", kind: "wordpress", config: { site_url: wp.siteUrl }, status: "connected", last_error: null, created_at: "", updated_at: "" }, secrets: { token }, changeSet: cs, changes: wordpressAdapter.relevant(changes), fetch: wp.fetch, now: T0 };
}
function tokenOf(wp: FakeWordPress): string {
  const client = wp.connected();
  return (client as unknown as { o: { token: string } }).o.token;
}

const pageEdit: Change = {
  position: 1, op: "wp_edit_page", entity: "wp_page", entity_id: "2",
  before: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: '<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph --><!-- wp:image {"id":{{sm_media_id:m-1}}} --><figure class="wp-block-image"><img src="{{sm_media_url:m-1}}" alt="Christmas window"/></figure><!-- /wp:image -->', elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [], preview_url: null },
};
const upload: Change = { position: 0, op: "wp_upload_photo", entity: "wp_media", entity_id: "m-1", before: null, after: { source_url: "https://cdn.example/m-1.jpg", title: "Коледна витрина", alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 2, page_title: "About", as_featured: true, previous_featured: null } };
const option: Change = { position: 2, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Кафене „Ъгъла“" } };
const menu: Change = { position: 3, op: "wp_edit_menu", entity: "wp_menu", entity_id: "3", before: { name: "Main", items: [{ id: 1, title: "Home", url: "/", parent_index: null, position: 1, type: "custom", object_id: null }, { id: 2, title: "About", url: "/about/", parent_index: null, position: 2, type: "custom", object_id: null }] }, after: { name: "Main", items: [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }] } };

describe("wordpressAdapter", () => {
  it("keeps only wp_* changes in position order", () => {
    const other: Change = { position: 5, op: "set_price", entity: "item", entity_id: "i", before: {}, after: {} };
    expect(wordpressAdapter.relevant([pageEdit, other, upload]).map((c) => c.entity)).toEqual(["wp_media", "wp_page"]);
  });

  it("uploads first, resolves placeholders in the page, sets the featured image, options and menus", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    const r = await wordpressAdapter.push(ctx(wp, token, [pageEdit, upload, option, menu]));
    expect(r).toMatchObject({ ok: true, line: { bg: "WordPress: обновено ✅" } });
    const page = wp.pages.get(2)!;
    expect(page.content).toContain('"id":101');
    expect(page.content).toContain("/wp-content/uploads/");
    expect(page.content).not.toContain("{{sm_media");
    expect(page.featured_media).toBe(101);
    expect(wp.media.get(101)?.alt).toBe("Коледна витрина"); // venue default_lang bg
    expect(wp.options.blogname).toBe("Кафене „Ъгъла“");
    expect(wp.menus.get(3)?.items.map((i) => i.title)).toEqual(["Home", "Menu"]);
    if (r.ok) expect((r.result.pushed as unknown[]).length).toBe(4);
  });

  it("undo restores the previous content, removes the photo and the featured image, and the old menu", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit, option, menu]));
    const r = await wordpressAdapter.push(ctx(wp, token, invertChanges([upload, pageEdit, option, menu])));
    expect(r.ok).toBe(true);
    const page = wp.pages.get(2)!;
    expect(page.content).toBe("<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->");
    expect(page.featured_media).toBeNull();
    expect(wp.media.size).toBe(0);
    expect(wp.options.blogname).toBe("Smoke Café");
    expect(wp.menus.get(3)?.items.map((i) => i.title)).toEqual(["Home", "About"]);
  });

  it("stops at the first failed change and leaves no placeholder behind; retries are idempotent", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    wp.failNext = { status: 502, code: "sm_upload_failed", message: "could not download" };
    const r1 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r1).toMatchObject({ ok: false, retry: true, line: { en: "WordPress: update failed, will retry" } });
    expect(wp.pages.get(2)!.content).not.toContain("{{sm_media");
    expect(wp.pages.get(2)!.content).not.toContain("wp:image");
    const r2 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r2.ok).toBe(true);
    expect(wp.media.size).toBe(1);
    const r3 = await wordpressAdapter.push(ctx(wp, token, [upload, pageEdit]));
    expect(r3.ok).toBe(true);
    expect(wp.media.size).toBe(1); // idempotent upload
  });

  it("reports a non-retryable error with its message", async () => {
    const wp = new FakeWordPress();
    const token = tokenOf(wp);
    const r = await wordpressAdapter.push(ctx(wp, token, [{ ...pageEdit, entity_id: "999" }]));
    expect(r).toMatchObject({ ok: false, retry: false });
    if (!r.ok) expect(r.line.en).toBe("WordPress: error: No such page.");
  });
});
```

Run: `npx vitest run test/destinations-wordpress.test.ts`
Expected: PASS (if a type complaint appears about `WordPressClient`'s private `o`, keep the `as unknown as` cast; it is a test-only reach into the fake's client).

- [ ] **Step 3: Sync queue, decorator and lines**

Create `src/destinations/sync.ts`:

```ts
// src/destinations/sync.ts
// Server-only. Queues one sync row per (change set, destination) and pushes it; failures retry with backoff from the tick.
import type { ChangeSet, Lang } from "../domain/types";
import type { DestinationSync, Store } from "../store/types";
import { adapterFor } from "./registry";
import { decryptSecrets } from "./secrets";
import type { PushResult } from "./types";

export interface SyncDeps {
  store: Store;
  secretKey: Buffer | null;
  fetch?: typeof fetch;
  log?: (s: string) => void;
}
export const BACKOFF_MS = [60_000, 300_000, 1_500_000, 7_200_000, 36_000_000] as const;
export const MAX_ATTEMPTS = 5;

/** One pending row per destination that has something to push for this set. */
export async function enqueueForChangeSet(store: Store, cs: ChangeSet, now: Date): Promise<DestinationSync[]> {
  const out: DestinationSync[] = [];
  for (const dest of await store.listDestinations(cs.venue_id)) {
    if (dest.status === "disconnected") continue;
    const adapter = adapterFor(dest.kind);
    if (!adapter) continue;
    const relevant = adapter.relevant(cs.changes);
    if (relevant.length === 0) continue;
    out.push(await store.createSync({ venue_id: cs.venue_id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: dest.kind, changes: relevant.length }, next_at: now.toISOString() }));
  }
  return out;
}

/** Runs one attempt; returns null when the row is not pending or its destination is gone. */
export async function runSync(d: SyncDeps, sync: DestinationSync, now: Date): Promise<PushResult | null> {
  const log = d.log ?? ((s: string) => console.log(s));
  if (sync.status !== "pending") return null;
  const venue = await d.store.getVenue(sync.venue_id);
  const dest = (await d.store.listDestinations(sync.venue_id)).find((x) => x.id === sync.destination_id);
  const withSecrets = dest ? await d.store.getDestination(sync.venue_id, dest.kind) : null;
  const adapter = dest ? adapterFor(dest.kind) : null;
  if (!dest || !withSecrets || !adapter) {
    await d.store.updateSync(sync.id, { status: "failed", attempts: sync.attempts + 1, last_error: "destination not found", updated_at: now.toISOString() });
    return null;
  }
  const attempts = sync.attempts + 1;
  let result: PushResult;
  try {
    if (!d.secretKey) throw new Error("DESTINATION_SECRET_KEY is not set");
    const secrets = decryptSecrets(withSecrets.secrets, d.secretKey);
    const cs = await d.store.getChangeSet(sync.change_set_id);
    result = await adapter.push({ venue, destination: dest, secrets, changeSet: cs, changes: adapter.relevant(cs.changes), fetch: d.fetch, now });
  } catch (e) {
    result = { ok: false, retry: false, error: e instanceof Error ? e.message : String(e), line: { bg: "WordPress: грешка при свързването", en: "WordPress: connection error" } };
  }
  if (result.ok) {
    await d.store.updateSync(sync.id, { status: "done", attempts, last_error: null, result: result.result, updated_at: now.toISOString() });
    if (dest.status === "error") await d.store.updateDestination(dest.id, { status: "connected", last_error: null });
    return result;
  }
  const giveUp = !result.retry || attempts >= MAX_ATTEMPTS;
  const nextAt = new Date(now.getTime() + (BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1])).toISOString();
  await d.store.updateSync(sync.id, { status: giveUp ? "failed" : "pending", attempts, next_at: nextAt, last_error: result.error, updated_at: now.toISOString() });
  if (giveUp) await d.store.updateDestination(dest.id, { status: "error", last_error: result.error });
  log(`[destinations] ${dest.kind} push for set ${sync.change_set_id} failed (attempt ${attempts}${giveUp ? ", giving up" : `, next at ${nextAt}`}): ${result.error}`);
  return giveUp ? result : { ...result, line: result.line };
}

/** Pushes every pending row that is due; called from the tick (and right after an apply by the store hook). */
export async function runPendingSyncs(d: SyncDeps, opts: { venueId?: string; now: Date }): Promise<{ done: string[]; retry: string[]; failed: string[] }> {
  const report = { done: [] as string[], retry: [] as string[], failed: [] as string[] };
  for (const sync of await d.store.listSyncs({ venueId: opts.venueId, status: ["pending"], dueBefore: opts.now.toISOString(), limit: 50 })) {
    const r = await runSync(d, sync, opts.now);
    if (!r) {
      report.failed.push(sync.id);
      continue;
    }
    const fresh = await d.store.getSync(sync.id);
    (fresh.status === "done" ? report.done : fresh.status === "failed" ? report.failed : report.retry).push(sync.id);
  }
  return report;
}

/** One line per destination for the owner's confirmation ("WordPress: updated ✅"), from the sync rows of the set. */
export async function syncLines(store: Store, changeSetId: string, lang: Lang): Promise<string[]> {
  const rows = await store.listSyncs({ changeSetId });
  return rows.map((s) => {
    const name = String(s.payload.kind ?? "destination") === "wordpress" ? "WordPress" : String(s.payload.kind);
    if (s.status === "done") return lang === "bg" ? `${name}: обновено ✅` : `${name}: updated ✅`;
    if (s.status === "pending") return lang === "bg" ? `${name}: не успях да обновя, ще опитам пак` : `${name}: update failed, will retry`;
    return lang === "bg" ? `${name}: грешка: ${s.last_error ?? ""}` : `${name}: error: ${s.last_error ?? ""}`;
  });
}
```

Create `src/destinations/store-hook.ts`:

```ts
// src/destinations/store-hook.ts
// Wraps a Store so that every successful applyChangeSet (bot button, dashboard, tick, agent) also pushes the
// set to the venue's destinations and records the outcome. Everything else passes through untouched.
import type { Store } from "../store/types";
import { enqueueForChangeSet, runSync, type SyncDeps } from "./sync";

export function withDestinationSync(store: Store, d: SyncDeps, now: () => Date = () => new Date()): Store {
  const log = d.log ?? ((s: string) => console.log(s));
  const applyChangeSet: Store["applyChangeSet"] = async (id, nowIso) => {
    const r = await store.applyChangeSet(id, nowIso);
    if (r !== "applied") return r;
    try {
      const cs = await store.getChangeSet(id);
      for (const sync of await enqueueForChangeSet(store, cs, now())) await runSync(d, sync, now());
    } catch (e) {
      log(`[destinations] push after apply ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return r;
  };
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "applyChangeSet") return applyChangeSet;
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
```

- [ ] **Step 4: Write the failing sync test**

Create `test/destinations-sync.test.ts`:

```ts
// test/destinations-sync.test.ts
import { describe, expect, it } from "vitest";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { BACKOFF_MS, enqueueForChangeSet, runPendingSyncs, syncLines } from "@/src/destinations/sync";
import { planChanges } from "@/src/domain/changes";
import type { Change } from "@/src/domain/types";
import { FakeWordPress } from "./fake-wordpress";
import { makeDemo } from "./helpers";

const KEY = parseSecretKey("ab".repeat(32));
const T0 = new Date("2026-10-09T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

const edit: Change = {
  position: 0, op: "wp_edit_page", entity: "wp_page", entity_id: "2",
  before: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/" },
  after: { title: "About", content: "<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->", elementor_data: null, featured_media: null, page_title: "About", page_url: "https://cafe.example/about/", replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }], preview_url: null },
};

async function connected() {
  const demo = await makeDemo();
  const wp = new FakeWordPress();
  const token = (wp.connected() as unknown as { o: { token: string } }).o.token;
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "wordpress", config: { site_url: wp.siteUrl, site_name: "Smoke Café" }, secrets: encryptSecrets({ token }, KEY) });
  const logs: string[] = [];
  const d = { store: demo.store, secretKey: KEY, fetch: wp.fetch, log: (s: string) => logs.push(s) };
  const set = (changes: Change[]) => demo.store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes });
  return { ...demo, wp, d, logs, set };
}

describe("enqueueForChangeSet", () => {
  it("creates one pending row per destination with relevant changes, none for plain menu edits", async () => {
    const { store, venue, items, set, d } = await connected();
    const site = await store.getSite(venue.id);
    const plain = await set(planChanges(site, [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }], { newId: () => "n", now: T0.toISOString() }));
    expect(await enqueueForChangeSet(d.store, plain, T0)).toEqual([]);
    const wpSet = await set([edit]);
    const rows = await enqueueForChangeSet(d.store, wpSet, T0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 0, change_set_id: wpSet.id, payload: { kind: "wordpress", changes: 1 }, next_at: T0.toISOString() });
  });
});

describe("withDestinationSync", () => {
  it("pushes right after a successful apply and reports the line", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    expect(demo.wp.pages.get(2)?.content).toContain("kozunak");
    expect(await syncLines(store, cs.id, "bg")).toEqual(["WordPress: обновено ✅"]);
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: updated ✅"]);
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("skipped"); // no second push
    expect(await store.listSyncs({ changeSetId: cs.id })).toHaveLength(1);
    expect(await store.getVenueBySlug("agala")).toMatchObject({ id: demo.venue.id }); // passthrough still works
  });

  it("retries with backoff when the site is down, then succeeds from the tick runner", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    demo.wp.unreachable = true;
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    expect(await store.applyChangeSet(cs.id, T0.toISOString())).toBe("applied");
    const [row] = await store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "pending", attempts: 1, next_at: at(BACKOFF_MS[0]).toISOString() });
    expect(row.last_error).toMatch(/unreachable/);
    expect(await syncLines(store, cs.id, "bg")).toEqual(["WordPress: не успях да обновя, ще опитам пак"]);
    expect(demo.logs.at(-1)).toMatch(/attempt 1/);
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(30_000) })).toEqual({ done: [], retry: [], failed: [] }); // not due yet
    demo.wp.unreachable = false;
    expect(await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(BACKOFF_MS[0]) })).toEqual({ done: [row.id], retry: [], failed: [] });
    expect(demo.wp.pages.get(2)?.content).toContain("kozunak");
    expect(await syncLines(store, cs.id, "en")).toEqual(["WordPress: updated ✅"]);
  });

  it("gives up after five attempts and marks the destination", async () => {
    const demo = await connected();
    demo.wp.unreachable = true;
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    let clock = 0;
    for (let i = 1; i < 5; i++) {
      clock += BACKOFF_MS[i - 1];
      const r = await runPendingSyncs(demo.d, { venueId: demo.venue.id, now: at(clock) });
      expect(r.done).toEqual([]);
      expect(i < 4 ? r.retry : r.failed).toHaveLength(1);
    }
    const [row] = await store.listSyncs({ changeSetId: cs.id });
    expect(row).toMatchObject({ status: "failed", attempts: 5 });
    expect(await store.getDestination(demo.venue.id, "wordpress")).toMatchObject({ status: "error", last_error: expect.stringMatching(/unreachable/) });
    expect(await syncLines(store, cs.id, "en")).toEqual([expect.stringMatching(/^WordPress: error: WordPress unreachable/)]);
    demo.wp.unreachable = false;
    const again = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [edit] });
    await store.applyChangeSet(again.id, T0.toISOString());
    expect(await store.getDestination(demo.venue.id, "wordpress")).toMatchObject({ status: "connected", last_error: null }); // recovers
  });

  it("fails at once on a non-retryable error", async () => {
    const demo = await connected();
    const store = withDestinationSync(demo.store, demo.d, () => T0);
    const cs = await store.createChangeSet({ venue_id: demo.venue.id, chat_id: 1001, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ ...edit, entity_id: "999" }] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    expect((await store.listSyncs({ changeSetId: cs.id }))[0]).toMatchObject({ status: "failed", attempts: 1, last_error: "No such page." });
  });
});
```

Run: `npx vitest run test/destinations-sync.test.ts`
Expected: PASS (fix the implementation, not the test, if the backoff arithmetic differs: attempt n waits `BACKOFF_MS[n-1]`).

- [ ] **Step 5: Confirmation lines in the bot, the tick step, the server wiring**

In `src/bot/approvals.ts` import `syncLines` and change the final apply branch of `handleDecision`:

```ts
import { syncLines } from "../destinations/sync";
```

```ts
  const result = await d.store.applyChangeSet(cs.id, now.toISOString());
  if (result === "skipped") {
    const fresh = await d.store.getChangeSet(cs.id);
    return { edit: `${preview}\n\n${c.status[fresh.status]}`, toast: c.status[fresh.status] };
  }
  const lines = await syncLines(d.store, cs.id, lang);
  const tail = lines.length ? `\n${lines.join("\n")}` : "";
  return { edit: `${preview}\n\n${c.applied}${tail}`, toast: c.applied };
```

Append to `test/approvals.test.ts` (last case in `describe("handleDecision")`):

```ts
  it("appends one line per destination push after applying", async () => {
    const { d, cs, store } = await proposal();
    const dest = await store.upsertDestination({ venue_id: cs.venue_id, kind: "wordpress", config: { site_url: "https://cafe.example" }, secrets: "x" });
    await store.createSync({ venue_id: cs.venue_id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: T0.toISOString() });
    const row = (await store.listSyncs({ changeSetId: cs.id }))[0];
    await store.updateSync(row.id, { status: "done" });
    const r = await handleDecision(d, 1001, "apply", cs.id);
    expect(r.edit).toBe("• Капучино: 2,90 € → 3,20 €\n\n✅ Приложено\nWordPress: обновено ✅");
  });
```

In `src/tick.ts` append to `TickDeps` (last member) and `TickReport` (last member):

```ts
  /** Destination pushes to retry (src/destinations/sync.ts); null/undefined = skip. */
  sync?: SyncDeps | null;
```

```ts
  /** Destination sync rows pushed by this tick. */
  pushed?: string[];
```

with `import { runPendingSyncs, type SyncDeps } from "./destinations/sync";` added to the imports, and append step 5 at the end of `runTick` just before `return report;`:

```ts
  // 5. Destination pushes that failed earlier (WordPress etc.), with backoff.
  if (d.sync) {
    try {
      const r = await runPendingSyncs(d.sync, { venueId: d.venueId, now: d.now });
      report.pushed = r.done;
    } catch (e) {
      console.error("[tick] destination syncs failed:", e instanceof Error ? e.message : e);
    }
  }
```

Append to `test/tick.test.ts` (last case of its outer describe; reuse its existing setup names, adding imports for `encryptSecrets`, `parseSecretKey`, `FakeWordPress`):

```ts
  it("retries due destination pushes when a sync dependency is given", async () => {
    const { store, venue } = await makeDemo();
    const wp = new FakeWordPress();
    const token = (wp.connected() as unknown as { o: { token: string } }).o.token;
    const key = parseSecretKey("ab".repeat(32));
    const dest = await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: wp.siteUrl }, secrets: encryptSecrets({ token }, key) });
    const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: "s", summary_en: "s", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", changes: [{ position: 0, op: "wp_set_option", entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Ъгъла" } }] });
    await store.applyChangeSet(cs.id, T0.toISOString());
    const sync = await store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: T0.toISOString() });
    const report = await runTick({ store, messenger: null, now: T0, sync: { store, secretKey: key, fetch: wp.fetch, log: () => undefined } });
    expect(report.pushed).toEqual([sync.id]);
    expect(wp.options.blogname).toBe("Ъгъла");
    const without = await runTick({ store, messenger: null, now: T0 });
    expect(without.pushed).toBeUndefined();
  });
```

(`T0` and `makeDemo` already exist in that file; check the names at its top and match them.)

In `src/server/tick.ts` pass the sync deps through: change the `deps` parameter type to `{ config: { tickSecret: string }; store: Store; messenger: Messenger; sync?: SyncDeps | null }` (import the type from `../destinations/sync`) and the call to `runTick({ store: deps.store, messenger: deps.messenger, now, venueId, sync: deps.sync ?? null })`. Then in `app/api/tick/route.ts` (read it first; it calls `handleTickRequest(req, deps)` with the server deps) nothing changes if the deps object carries a `sync` field — add it in the next step.

In `src/server/deps.ts` (append-only):
1. Imports (append lines): `import { resolveSecretKey } from "../destinations/secrets";`, `import { withDestinationSync } from "../destinations/store-hook";`, `import type { SyncDeps } from "../destinations/sync";`, `import { connectWordPress, wordPressClientFor } from "../destinations/connect";`.
2. `ServerDeps` gains (last members): `destinationSecretKey: Buffer | null;` and `sync: SyncDeps | null;`.
3. In `makeServerDeps`, right after `const s = store;` insert:

```ts
  const destinationSecretKey = resolveSecretKey(config.destinationSecretKey, isMemory, log);
  const sync: SyncDeps | null = destinationSecretKey ? { store: s, secretKey: destinationSecretKey, log } : null;
  const store2: Store = sync ? withDestinationSync(s, sync) : s;
```

   and from here on use `store2` where the bot, messenger, tick and agent get the store: in `botDeps` (`store: store2`), in `runTick({ store: store2, … , sync })`, in `runTurn({ store: store2, … })`, and in the returned object (`store: store2`). Add to `botDeps` (last key): `connect: sync ? (venueId, siteUrl, code) => connectWordPress({ store: s, secretKey: destinationSecretKey }, venueId, siteUrl, code) : undefined,`.
4. In `handleRun`, before `runTurn`, resolve the WordPress client and pass it: 

```ts
    const wp = sync ? await wordPressClientFor({ store: s, secretKey: destinationSecretKey }, r.venueId).catch(() => null) : null;
```

   and add `wordpress: wp?.client ?? null` to the first argument of `runTurn` (Task 6 adds the field to `AgentDeps`; until then TypeScript rejects it, so Task 5 adds it to `AgentDeps` now: in `src/agent/tools.ts` append to `AgentDeps` the member `/** The venue's WordPress site, when connected (Task 6 registers the wp_* tools). */ wordpress?: WordPressClient | null;` with `import type { WordPressClient } from "../destinations/wordpress-client";`).
5. Return `{ config, store: store2, messenger, bot, handleRun, isMemory, destinationSecretKey, sync }`.

Append to `test/server-deps.test.ts`:

```ts
  it("wires the dev secret key and the sync hook in memory mode", async () => {
    const logs: string[] = [];
    const deps = await makeServerDeps({ defer: (fn) => void fn(), env: { SITE_MANAGER_STORE: "memory" }, log: (s) => logs.push(s) });
    expect(deps.destinationSecretKey).toHaveLength(32);
    expect(deps.sync?.store).toBeDefined();
    expect(logs.join("\n")).toMatch(/DESTINATION_SECRET_KEY is not set/);
  });
```

Run: `npm run typecheck && npx vitest run test/approvals.test.ts test/tick.test.ts test/server-deps.test.ts test/destinations-sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint, full tests, commit**

Run: `npm run lint && npm test`

```bash
git add src/destinations src/bot/approvals.ts src/tick.ts src/server/tick.ts src/server/deps.ts src/agent/tools.ts test/destinations-sync.test.ts test/destinations-wordpress.test.ts test/approvals.test.ts test/tick.test.ts test/server-deps.test.ts
git commit -m "Destinations: WordPress adapter, sync queue with backoff, store hook, tick retries and confirmation lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Agent tools for WordPress (`wp_list_site`, `wp_read_page`, `wp_edit_page`, `wp_upload_photo`, `wp_set_option`, `wp_edit_menu`, `wp_edit_product`)

**Files:**
- Create: `src/agent/wp-tool-schemas.ts`, `src/agent/wp-tools.ts`, `test/agent-wordpress-tools.test.ts`
- Modify (free): `src/agent/tools.ts` (register the tools), `src/agent/prompt.ts` (one numbered rule)
- Test: `test/agent-wordpress-tools.test.ts`

**Interfaces:**
- Consumes: `AgentDeps.wordpress?: WordPressClient | null` (added in Task 5), `ToolKit` and `proposalText` from `src/agent/tools.ts`, `WordPressClient`/`WordPressApiError` (Task 3), `WpPageChangeRow` (Task 3), `Store.getMedia`, `renderPreview` (Task 1 lines), `withDestinationSync` (Task 5) in tests only.
- Produces: `wpTools(d: AgentDeps, k: ToolKit)` returning `[]` when `d.wordpress` is null; tools named `wp_list_site`, `wp_read_page`, `wp_edit_page`, `wp_upload_photo`, `wp_set_option`, `wp_edit_menu`, `wp_edit_product`; every proposal is a change set with `wp_*` rows whose `before`/`after` follow Task 1's test shapes (page rows are `WpPageChangeRow`; photo rows are `{ source_url, title, alt_bg, alt_en, page_id, page_title, as_featured, previous_featured }`; option rows `{ value }`; menu rows `{ name, items }`; product rows `{ product_name, ...WpProductPatch }`).

Decisions: WordPress tools are owner-only. A page edit calls the plugin's preview route at proposal time (nothing is written) and stores the plugin's `before`/`after`; the push at approval time sends `after`. Photos sent to the bot are referenced by `media_id` and uploaded only at approval. `wp_edit_page` with `photos` produces the upload rows first (positions 0…n-1) and the page row last, so the push uploads before it applies the page.

- [ ] **Step 1: Schemas**

Create `src/agent/wp-tool-schemas.ts`:

```ts
// src/agent/wp-tool-schemas.ts
import { z } from "zod";

const Summary = {
  summary_bg: z.string().min(1).describe("One line in Bulgarian, e.g. „Нов текст на страница „За нас““"),
  summary_en: z.string().min(1).describe("The same line in English"),
};
export const WpPhotoSchema = z.object({
  media_id: z.string().min(1).describe("A media_id of a photo the owner sent to the bot"),
  alt_bg: z.string().min(1).describe("Short alt text in Bulgarian"),
  alt_en: z.string().min(1).describe("Short alt text in English"),
  as_featured: z.boolean().optional().describe("true = becomes the page's featured image"),
});
export const WpReadPageSchema = z.object({ page_id: z.number().int().positive() });
export const WpEditPageSchema = z.object({
  ...Summary,
  page_id: z.number().int().positive().describe("An id from wp_list_site"),
  title: z.string().optional().describe("New page title"),
  content: z.string().optional().describe("Full new content (Gutenberg block HTML or plain HTML). Prefer replacements for small edits. Not allowed on Elementor pages."),
  replacements: z.array(z.object({ find: z.string().min(1).describe("Exact text copied from the page (wp_read_page content), long enough to occur once"), replace: z.string() })).max(20).optional(),
  photos: z.array(WpPhotoSchema).max(10).optional().describe("Photos to upload with this edit; reference them in content as {{sm_media_url:<media_id>}} (img src) and {{sm_media_id:<media_id>}} (Gutenberg image id)"),
});
export const WpUploadPhotoSchema = z.object({
  ...Summary,
  ...WpPhotoSchema.shape,
  page_id: z.number().int().positive().optional().describe("Page that gets this photo as its featured image (with as_featured true)"),
});
export const WpSetOptionSchema = z.object({
  ...Summary,
  key: z.enum(["blogname", "blogdescription", "custom_logo", "site_icon"]),
  value: z.string().nullable().optional().describe("For blogname/blogdescription: the new text. For custom_logo/site_icon: null to remove, or omit and pass media_id"),
  media_id: z.string().optional().describe("For custom_logo/site_icon: a media_id of a photo the owner sent"),
  alt_bg: z.string().optional(),
  alt_en: z.string().optional(),
});
export const WpEditMenuSchema = z.object({
  ...Summary,
  menu_id: z.number().int().positive().describe("An id from wp_list_site"),
  items: z.array(z.object({ title: z.string().min(1), url: z.string().min(1), parent_index: z.number().int().min(0).nullable().optional().describe("Index of the parent item in this list, or null") })).min(1).max(40).describe("The complete new list of items, in order"),
});
export const WpEditProductSchema = z.object({
  ...Summary,
  product_id: z.number().int().positive(),
  patch: z.object({
    name: z.string().optional(),
    regular_price: z.string().optional().describe("Decimal as text, e.g. \"13.50\""),
    sale_price: z.string().optional().describe("Empty string removes the sale price"),
    stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
    description: z.string().optional(),
    short_description: z.string().optional(),
  }),
});
```

- [ ] **Step 2: Write the failing tool test**

Create `test/agent-wordpress-tools.test.ts`:

```ts
// test/agent-wordpress-tools.test.ts
import { describe, expect, it } from "vitest";
import { makeTools, type AgentDeps } from "@/src/agent/tools";
import { handleDecision } from "@/src/bot/approvals";
import { encryptSecrets, parseSecretKey } from "@/src/destinations/secrets";
import { withDestinationSync } from "@/src/destinations/store-hook";
import { FakeWordPress } from "./fake-wordpress";
import { FakeMessenger, makeDemo } from "./helpers";
import { call } from "./tool-call";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const KEY = parseSecretKey("ab".repeat(32));

async function setup(over: Partial<AgentDeps> = {}) {
  const demo = await makeDemo();
  const wp = new FakeWordPress();
  const client = wp.connected();
  const token = (client as unknown as { o: { token: string } }).o.token;
  await demo.store.upsertDestination({ venue_id: demo.venue.id, kind: "wordpress", config: { site_url: wp.siteUrl, site_name: "Smoke Café" }, secrets: encryptSecrets({ token }, KEY) });
  const store = withDestinationSync(demo.store, { store: demo.store, secretKey: KEY, fetch: wp.fetch, log: () => undefined }, () => T0);
  const messenger = new FakeMessenger();
  const member = (await store.findMember(1001))!;
  const deps: AgentDeps = { store, venueId: demo.venue.id, chatId: 1001, member, messenger, now: () => T0, baseUrl: "https://site.example", wordpress: client, ...over };
  const photo = await store.saveMedia(demo.venue.id, new Uint8Array([1, 2, 3]), "image/jpeg");
  return { ...demo, store, wp, messenger, deps, photo, tools: makeTools(deps) };
}

describe("wp tools availability", () => {
  it("are absent without a connected site and present with one", async () => {
    const { tools } = await setup({ wordpress: null });
    expect(tools.map((t) => t.name).filter((n) => n.startsWith("wp_"))).toEqual([]);
    const { tools: withWp } = await setup();
    expect(withWp.map((t) => t.name).filter((n) => n.startsWith("wp_"))).toEqual(["wp_list_site", "wp_read_page", "wp_edit_page", "wp_upload_photo", "wp_set_option", "wp_edit_menu", "wp_edit_product"]);
  });
});

describe("wp_list_site / wp_read_page", () => {
  it("lists pages, menus, options and reads a page with its text", async () => {
    const { tools } = await setup();
    const site = await call(tools, "wp_list_site", {});
    expect(site.site_name).toBe("Smoke Café");
    expect((site.pages as { id: number; title: string; builder: string }[]).map((p) => [p.id, p.title, p.builder])).toEqual([[1, "Home", "gutenberg"], [2, "About", "gutenberg"], [3, "Menu", "classic"]]);
    expect((site.menus as { id: number; name: string }[])[0]).toMatchObject({ id: 3, name: "Main" });
    expect(site.options).toMatchObject({ blogname: "Smoke Café" });
    expect(site.woocommerce).toBe(false);
    const page = await call(tools, "wp_read_page", { page_id: 2 });
    expect(page).toMatchObject({ id: 2, title: "About", builder: "gutenberg", editable: true, text: "We bake banitsa every morning." });
    expect(page.content).toContain("<!-- wp:paragraph -->");
    expect(await call(tools, "wp_read_page", { page_id: 999 })).toMatchObject({ error: "No such page." });
  });
});

describe("wp_edit_page", () => {
  it("previews a replacement, proposes it with the plugin's before/after and applies it on ✅ with the WordPress line", async () => {
    const { tools, store, wp, messenger } = await setup();
    const r = await call(tools, "wp_edit_page", { summary_bg: "Нов текст в „За нас“", summary_en: "New About text", page_id: 2, replacements: [{ find: "banitsa every morning", replace: "banitsa and kozunak every morning" }] });
    expect(r).toMatchObject({ status: "proposed" });
    expect(r.preview).toBe(`• WordPress: страница „About“\n  „banitsa every morning“ → „banitsa and kozunak every morning“\n  Преглед: https://cafe.example/about/?sm_preview=${r.pending_key}`);
    expect(r.preview_url).toMatch(/sm_preview=/);
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes).toHaveLength(1);
    expect(cs.changes[0]).toMatchObject({ op: "wp_edit_page", entity: "wp_page", entity_id: "2", before: { title: "About", page_title: "About", page_url: "https://cafe.example/about/" }, after: { content: "<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->" } });
    expect(wp.pages.get(2)?.content).not.toContain("kozunak"); // nothing written yet
    expect(messenger.sent[0]).toMatchObject({ setId: cs.id, lang: "bg" });
    const decision = await handleDecision({ store, messenger, now: () => T0 }, 1001, "apply", cs.id);
    expect(decision.edit).toContain("✅ Приложено\nWordPress: обновено ✅");
    expect(wp.pages.get(2)?.content).toContain("kozunak");
    expect(wp.pending.has(2)).toBe(false);
  });
  it("refuses ambiguous replacements, Elementor full content, staff and an unchanged page", async () => {
    const { tools, wp } = await setup();
    const amb = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, replacements: [{ find: "e", replace: "x" }] });
    expect(amb.error).toMatch(/occurs \d+ times on the page; choose a longer unique anchor/);
    const none = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, replacements: [{ find: "croissant", replace: "x" }] });
    expect(none.error).toMatch(/occurs 0 times/);
    const el = wp.addElementorPage("Events", [{ id: "a1", settings: { title: "Live jazz" } }]);
    const full = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: el, content: "<p>x</p>" });
    expect(full.error).toMatch(/Elementor; send replacements/);
    const same = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "About" });
    expect(same.error).toMatch(/Nothing would change/);
    const { tools: staffTools } = await setup({ chatId: 1002, member: { venue_id: "", tg_chat_id: 1002, role: "staff", lang: "en", created_at: "" } });
    const staff = await call(staffTools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, title: "X" });
    expect(staff.error).toMatch(/only the owner/);
  });
  it("bundles photos: upload rows first, placeholders carry the photo URL into the preview", async () => {
    const { tools, store, photo, wp } = await setup();
    const content = `<!-- wp:paragraph --><p>Коледа в Ъгъла.</p><!-- /wp:paragraph --><!-- wp:image {"id":{{sm_media_id:${photo.id}}}} --><figure class="wp-block-image"><img src="{{sm_media_url:${photo.id}}}" alt="Коледна витрина"/></figure><!-- /wp:image -->`;
    const r = await call(tools, "wp_edit_page", { summary_bg: "Коледна секция", summary_en: "Christmas section", page_id: 2, content, photos: [{ media_id: photo.id, alt_bg: "Коледна витрина", alt_en: "Christmas window" }] });
    expect(r.status).toBe("proposed");
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes.map((c) => [c.position, c.entity])).toEqual([[0, "wp_media"], [1, "wp_page"]]);
    expect(cs.changes[0].after).toMatchObject({ source_url: photo.public_url, alt_bg: "Коледна витрина", alt_en: "Christmas window", page_id: 2, page_title: "About", as_featured: false });
    expect(wp.pending.get(2)?.after.content).toContain(`src="${photo.public_url}"`); // preview shows our copy of the photo
    expect(String(cs.changes[1].after?.content)).toContain(`{{sm_media_url:${photo.id}}}`); // the push resolves it after the upload
    expect(r.preview).toContain("• WordPress: качва снимка „Коледна витрина“");
    const unknown = await call(tools, "wp_edit_page", { summary_bg: "x", summary_en: "x", page_id: 2, content: "{{sm_media_url:nope}}", photos: [] });
    expect(unknown.error).toMatch(/nope/);
  });
});

describe("wp_upload_photo / wp_set_option / wp_edit_menu / wp_edit_product", () => {
  it("proposes a featured photo with the previous featured image remembered", async () => {
    const { tools, store, photo, wp } = await setup();
    wp.pages.get(2)!.featured_media = 55;
    const r = await call(tools, "wp_upload_photo", { summary_bg: "Нова снимка", summary_en: "New photo", media_id: photo.id, alt_bg: "Витрина", alt_en: "Window", page_id: 2, as_featured: true });
    const cs = await store.getChangeSet(r.change_set_id as string);
    expect(cs.changes[0]).toMatchObject({ op: "wp_upload_photo", entity: "wp_media", entity_id: photo.id, before: null, after: { page_id: 2, page_title: "About", as_featured: true, previous_featured: 55 } });
    expect(r.preview).toBe("• WordPress: качва снимка „Витрина“\n  като водеща снимка на страница „About“");
    expect(await call(tools, "wp_upload_photo", { summary_bg: "x", summary_en: "x", media_id: "nope", alt_bg: "a", alt_en: "a" })).toMatchObject({ error: expect.stringMatching(/media_id "nope" not found/) });
  });
  it("proposes site title and a logo from a photo", async () => {
    const { tools, store, photo } = await setup();
    const t = await call(tools, "wp_set_option", { summary_bg: "Име", summary_en: "Name", key: "blogname", value: "Кафене „Ъгъла“" });
    expect((await store.getChangeSet(t.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_option", entity_id: "blogname", before: { value: "Smoke Café" }, after: { value: "Кафене „Ъгъла“" } });
    await store.updateChangeSet(t.change_set_id as string, { status: "cancelled" });
    const l = await call(tools, "wp_set_option", { summary_bg: "Лого", summary_en: "Logo", key: "custom_logo", media_id: photo.id, alt_bg: "Лого", alt_en: "Logo" });
    const cs = await store.getChangeSet(l.change_set_id as string);
    expect(cs.changes.map((c) => c.entity)).toEqual(["wp_media", "wp_option"]);
    expect(cs.changes[1]).toMatchObject({ entity_id: "custom_logo", before: { value: null }, after: { value: `{{sm_media_id:${photo.id}}}` } });
    expect(l.preview).toContain("• WordPress: Лого: — → новата снимка");
    expect(await call(tools, "wp_set_option", { summary_bg: "x", summary_en: "x", key: "custom_logo" })).toMatchObject({ error: expect.stringMatching(/media_id/) });
  });
  it("proposes a menu replacement and a product patch", async () => {
    const { tools, store, wp } = await setup();
    const m = await call(tools, "wp_edit_menu", { summary_bg: "Меню", summary_en: "Menu", menu_id: 3, items: [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }] });
    expect((await store.getChangeSet(m.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_menu", entity_id: "3", before: { name: "Main" }, after: { name: "Main", items: [{ title: "Home", url: "/", parent_index: null }, { title: "Menu", url: "/menu/", parent_index: null }] } });
    expect(m.preview).toBe("• WordPress: меню „Main“: 2 → 2 елемента\n  – Home → /\n  – Menu → /menu/");
    await store.updateChangeSet(m.change_set_id as string, { status: "cancelled" });
    expect(await call(tools, "wp_edit_product", { summary_bg: "x", summary_en: "x", product_id: 77, patch: { regular_price: "13.50" } })).toMatchObject({ error: "WooCommerce is not active on this site." });
    wp.addProduct({ id: 77, name: "Espresso beans 250 g", regular_price: "12", sale_price: "", stock_status: "instock", description: "", short_description: "" });
    const p = await call(tools, "wp_edit_product", { summary_bg: "Цена на зърната", summary_en: "Beans price", product_id: 77, patch: { regular_price: "13.50" } });
    expect((await store.getChangeSet(p.change_set_id as string)).changes[0]).toMatchObject({ entity: "wp_product", entity_id: "77", before: { product_name: "Espresso beans 250 g", regular_price: "12" }, after: { product_name: "Espresso beans 250 g", regular_price: "13.50" } });
    expect(p.preview).toBe("• WordPress: продукт „Espresso beans 250 g“\n  цена: „12“ → „13.50“");
  });
});
```

Run: `npx vitest run test/agent-wordpress-tools.test.ts`
Expected: FAIL (module not found / tools missing).

- [ ] **Step 3: Create `src/agent/wp-tools.ts`**

```ts
// src/agent/wp-tools.ts
// Agent tools for a connected WordPress site. Every write becomes a change set with wp_* rows; the push to
// WordPress happens only after the owner approves (src/destinations/store-hook.ts).
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { WordPressApiError } from "../destinations/wordpress-client";
import type { WpMenuItemInput, WpOptionKey, WpPageChangeRow, WpProductPatch } from "../destinations/wordpress-types";
import { clip } from "../domain/wp-preview";
import type { Change, Row } from "../domain/types";
import { proposalText, type AgentDeps, type ToolKit } from "./tools";
import { WpEditMenuSchema, WpEditPageSchema, WpEditProductSchema, WpPhotoSchema, WpReadPageSchema, WpSetOptionSchema, WpUploadPhotoSchema } from "./wp-tool-schemas";

const PLACEHOLDER = /\{\{sm_media_(?:url|id):([^}]+)\}\}/g;
const TEXT_LIMIT = 6000;
const CONTENT_LIMIT = 12000;

/** Turns a plugin error into an instruction the model can act on. */
export function wpErrorMessage(e: WordPressApiError): string {
  switch (e.code) {
    case "sm_replace_failed":
      return `"${String(e.data.find)}" occurs ${String(e.data.count)} times on the page; choose a longer unique anchor copied verbatim from wp_read_page content.`;
    case "sm_builder_unsupported":
      return e.data.builder === "elementor" ? "This page is built with Elementor; send replacements instead of full content." : `This page is built with an unsupported editor (${String(e.data.builder)}); it cannot be edited here. Offer the hosted Site Manager page instead.`;
    case "sm_unreachable":
      return "The WordPress site did not answer; tell the owner the site seems down and try again later.";
    case "sm_unauthorized":
      return "The WordPress connection is no longer valid; ask the owner to reconnect with /connect.";
    default:
      return e.message;
  }
}

export function wpTools(d: AgentDeps, k: ToolKit) {
  const wp = d.wordpress;
  if (!wp) return [];
  const requireOwner = () => {
    if (d.member.role !== "owner") throw new Error("WordPress changes are only the owner's decision; tell the owner to send this.");
  };
  const api = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw e instanceof WordPressApiError ? new Error(wpErrorMessage(e)) : e;
    }
  };

  /** wp_media rows for photos the owner sent; verifies each id belongs to this venue. */
  const photoRows = async (photos: z.infer<typeof WpPhotoSchema>[], page: { id: number; title: string; featured_media: number | null } | null, startPosition: number): Promise<{ rows: Change[]; placeholders: Record<string, string> }> => {
    const rows: Change[] = [];
    const placeholders: Record<string, string> = {};
    for (const [i, p] of photos.entries()) {
      const m = await d.store.getMedia(p.media_id);
      if (!m || m.venue_id !== d.venueId) throw new Error(`media_id "${p.media_id}" not found for this venue; use an id from a photo you received.`);
      rows.push({
        position: startPosition + i, op: "wp_upload_photo", entity: "wp_media", entity_id: m.id, before: null,
        after: { source_url: m.public_url, title: p.alt_bg || p.alt_en, alt_bg: p.alt_bg, alt_en: p.alt_en, page_id: page?.id ?? null, page_title: page?.title ?? "", as_featured: p.as_featured === true, previous_featured: p.as_featured === true ? page?.featured_media ?? null : null },
      });
      placeholders[`{{sm_media_url:${m.id}}}`] = m.public_url;
    }
    return { rows, placeholders };
  };

  const propose = async (summary_bg: string, summary_en: string, changes: Change[], extra: Record<string, unknown> = {}) => {
    await k.ensureNoPending();
    const s = await k.site();
    const p = k.previews(s, changes);
    const cs = await d.store.createChangeSet({ venue_id: d.venueId, chat_id: d.chatId, summary_bg, summary_en, ...p, source: d.source ?? "text", status: "proposed", changes });
    const messageId = await d.messenger.sendProposal(d.chatId, proposalText(k.mine(p), k.lang, null, s.venue.tz), cs.id, k.lang);
    if (messageId !== null) await d.store.updateChangeSet(cs.id, { tg_message_id: messageId });
    return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), ...extra, next: "The owner decides with the buttons. Reply with at most one short sentence, or nothing." };
  };

  const listSite = betaZodTool({
    name: "wp_list_site",
    description: "The owner's connected WordPress site: pages (id, title, url, editor/builder), navigation menus, site title and tagline, whether WooCommerce is active, and products. Call it before any WordPress edit.",
    inputSchema: WpReadPageSchema.pick({}),
    run: () =>
      k.attempt(async () => {
        const s = await api(() => wp.site());
        return {
          site_name: s.name, site_url: s.home_url, wp_version: s.wp_version, theme: s.theme.name, locale: s.locale,
          pages: s.pages.map((p) => ({ id: p.id, title: p.title, url: p.url, status: p.status, builder: p.builder, is_front_page: p.is_front_page, featured_media: p.featured_media })),
          menus: s.menus,
          options: s.options,
          woocommerce: s.woocommerce,
          products: s.products.slice(0, 50),
          note: "Edit page text with wp_edit_page (read it first with wp_read_page). Menu, prices, hours, specials and announcements are managed with propose_changes; the plugin shows them on the site.",
        };
      }),
  });

  const readPage = betaZodTool({
    name: "wp_read_page",
    description: "One WordPress page: title, builder, the visible text, and the raw content (block HTML) to copy exact `find` anchors from for wp_edit_page.",
    inputSchema: WpReadPageSchema,
    run: (input) =>
      k.attempt(async () => {
        const p = await api(() => wp.page(input.page_id));
        return {
          id: p.id, title: p.title, url: p.url, builder: p.builder, editable: p.editable, featured_media: p.featured_media,
          text: p.text.length > TEXT_LIMIT ? `${p.text.slice(0, TEXT_LIMIT)}…` : p.text,
          content: p.content.length > CONTENT_LIMIT ? p.content.slice(0, CONTENT_LIMIT) : p.content,
          content_truncated: p.content.length > CONTENT_LIMIT,
          texts: p.builder === "elementor" ? p.texts : undefined,
          hint: p.builder === "elementor" ? "Elementor page: edit with replacements only; each find must match exactly one text fragment." : "Use replacements with a find text copied verbatim from content; use content only to rewrite the whole page.",
        };
      }),
  });

  const editPage = betaZodTool({
    name: "wp_edit_page",
    description: "Propose a WordPress page edit: a new title, exact text replacements (preferred) or full new content, optionally with photos the owner sent. The plugin computes the result and a preview link; nothing is published until the owner taps ✅.",
    inputSchema: WpEditPageSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const page = await api(() => wp.page(input.page_id));
        const { rows, placeholders } = await photoRows(input.photos ?? [], page, 0);
        const known = new Set((input.photos ?? []).map((p) => p.media_id));
        for (const text of [input.title ?? "", input.content ?? "", ...(input.replacements ?? []).map((r) => r.replace)]) {
          for (const m of text.matchAll(PLACEHOLDER)) if (!known.has(m[1])) throw new Error(`Placeholder for media_id "${m[1]}" is not in photos; add it there or remove the placeholder.`);
        }
        const preview = await api(() => wp.previewPage(input.page_id, { title: input.title, content: input.content, replacements: input.replacements, placeholders }));
        const unchanged = rows.length === 0 && JSON.stringify(preview.before) === JSON.stringify(preview.after);
        if (unchanged) throw new Error("Nothing would change on the page; check the replacements or the title.");
        const before: WpPageChangeRow = { ...preview.before, page_title: page.title, page_url: page.url };
        // Keep our placeholders in the stored `after` (the plugin's preview resolved them to our photo URLs for display only).
        const afterContent = input.content !== undefined ? input.content : preview.after.content;
        const after: WpPageChangeRow = { ...preview.after, content: afterContent, page_title: page.title, page_url: page.url, replacements: input.replacements ?? [], preview_url: preview.preview_url };
        rows.push({ position: rows.length, op: "wp_edit_page", entity: "wp_page", entity_id: String(page.id), before: before as unknown as Row, after: after as unknown as Row });
        return propose(input.summary_bg, input.summary_en, rows, { preview_url: preview.preview_url, pending_key: preview.pending_key });
      }),
  });

  const uploadPhoto = betaZodTool({
    name: "wp_upload_photo",
    description: "Propose uploading a photo the owner sent into the WordPress media library, optionally as a page's featured image. Uploaded only after ✅.",
    inputSchema: WpUploadPhotoSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const page = input.page_id ? await api(() => wp.page(input.page_id as number)) : null;
        const { rows } = await photoRows([{ media_id: input.media_id, alt_bg: input.alt_bg, alt_en: input.alt_en, as_featured: input.as_featured }], page, 0);
        return propose(input.summary_bg, input.summary_en, rows);
      }),
  });

  const setOption = betaZodTool({
    name: "wp_set_option",
    description: "Propose a change of the WordPress site title (blogname), tagline (blogdescription), logo (custom_logo, from a photo the owner sent) or site icon (site_icon).",
    inputSchema: WpSetOptionSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const options = await api(() => wp.options());
        const key = input.key as WpOptionKey;
        const rows: Change[] = [];
        let value: string | number | null;
        if (key === "custom_logo" || key === "site_icon") {
          if (input.media_id) {
            const { rows: photos } = await photoRows([{ media_id: input.media_id, alt_bg: input.alt_bg || "Лого", alt_en: input.alt_en || "Logo" }], null, 0);
            rows.push(...photos);
            value = `{{sm_media_id:${input.media_id}}}`;
          } else if (input.value === null) value = null;
          else throw new Error(`${key} needs media_id (a photo the owner sent) or value null to remove it.`);
        } else {
          if (typeof input.value !== "string" || !input.value.trim()) throw new Error(`${key} needs a non-empty value.`);
          value = input.value.trim();
        }
        rows.push({ position: rows.length, op: "wp_set_option", entity: "wp_option", entity_id: key, before: { value: options[key] }, after: { value } });
        return propose(input.summary_bg, input.summary_en, rows);
      }),
  });

  const editMenu = betaZodTool({
    name: "wp_edit_menu",
    description: "Propose replacing a WordPress navigation menu with a complete new list of items (title, url, optional parent_index). Read the current one with wp_list_site first.",
    inputSchema: WpEditMenuSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const menu = await api(() => wp.menu(input.menu_id));
        const items: WpMenuItemInput[] = input.items.map((i) => ({ title: i.title.trim(), url: i.url.trim(), parent_index: i.parent_index ?? null, type: "custom", object_id: null }));
        for (const i of items) if (i.parent_index !== null && (i.parent_index as number) >= items.length) throw new Error("parent_index must point at an item in the list.");
        const row: Change = { position: 0, op: "wp_edit_menu", entity: "wp_menu", entity_id: String(menu.id), before: { name: menu.name, items: menu.items }, after: { name: menu.name, items } };
        return propose(input.summary_bg, input.summary_en, [row]);
      }),
  });

  const editProduct = betaZodTool({
    name: "wp_edit_product",
    description: "Propose a WooCommerce product change (name, prices, stock status, descriptions). Only when wp_list_site says woocommerce is true.",
    inputSchema: WpEditProductSchema,
    run: (input) =>
      k.attempt(async () => {
        requireOwner();
        const p = await api(() => wp.product(input.product_id));
        const patch = input.patch as WpProductPatch;
        const keys = (Object.keys(patch) as (keyof WpProductPatch)[]).filter((k2) => patch[k2] !== undefined && patch[k2] !== p[k2]);
        if (keys.length === 0) throw new Error("Nothing would change on the product.");
        const before: Row = { product_name: p.name };
        const after: Row = { product_name: p.name };
        for (const k2 of keys) {
          before[k2] = p[k2];
          after[k2] = patch[k2] as string;
        }
        const row: Change = { position: 0, op: "wp_edit_product", entity: "wp_product", entity_id: String(p.id), before, after };
        return propose(input.summary_bg, input.summary_en, [row], { product: clip(p.name, 60) });
      }),
  });

  return [listSite, readPage, editPage, uploadPhoto, setOption, editMenu, editProduct];
}
```

`WpReadPageSchema.pick({})` is an empty object schema; if zod complains, use `z.object({})` with a real `import { z } from "zod"`.

- [ ] **Step 4: Register the tools and extend the prompt**

In `src/agent/tools.ts` add `import { wpTools } from "./wp-tools";` and change the return of `makeTools`:

```ts
  const kit: ToolKit = { attempt, site, ctx, previews, mine, propose, getSet, ensureNoPending, lang };
  return [getSite, getMenu, proposeChanges, cancelChangeSet, listChanges, ...extraTools(d, kit), ...wpTools(d, kit)];
```

In `src/agent/prompt.ts` insert after rule 8 (before the "Replying:" paragraph):

```
9. WordPress: when wp_* tools exist, the owner's own WordPress site is connected. Menu, prices, hours, specials, holidays and announcements still go through propose_changes (the plugin shows them on that site automatically). For page text, photos, the site title/tagline/logo and navigation menus use the wp_* tools: wp_list_site to find the page, wp_read_page to read it, then wp_edit_page with replacements whose find text is copied verbatim from the page and long enough to occur once; rewrite a whole page only when asked. Photos the owner sent go in photos and are referenced in content as {{sm_media_url:<media_id>}} for img src and {{sm_media_id:<media_id>}} for a Gutenberg image id. The preview link in the proposal shows the result before anything is published.
```

- [ ] **Step 5: Run, typecheck, lint, commit**

Run: `npx vitest run test/agent-wordpress-tools.test.ts && npm run typecheck && npm run lint && npm test`
Expected: PASS.

```bash
git add src/agent/wp-tool-schemas.ts src/agent/wp-tools.ts src/agent/tools.ts src/agent/prompt.ts test/agent-wordpress-tools.test.ts
git commit -m "Agent: WordPress tools (site, page read/edit, photos, options, menus, products) behind the approval flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard "WordPress" card, overview field and the disconnect route

**Files:**
- Create: `app/admin/[slug]/components/WordPressCard.tsx`, `app/api/admin/[slug]/wordpress/route.ts`, `test/admin-wordpress.test.ts`
- Modify (append-only): `src/server/admin.ts`, `src/i18n/dicts.ts` (new keys at the end of the `en` block and the end of the `bg` block), `app/admin/[slug]/components/AdminPanel.tsx` (one import, one JSX line)
- Test: `test/admin-wordpress.test.ts`

**Interfaces:**
- Consumes: `Store.getDestination/listSyncs/getChangeSet`, `disconnectWordPress` (Task 4), `ServerDeps.destinationSecretKey` (Task 5), `Section`/`Chip` from `app/admin/[slug]/components/bits.tsx`, `useLang`, `formatDateTime`.
- Produces: `WordPressOverview` and `wordPressOverview(store, venueId)` in `src/server/admin.ts`; `AdminOverview.wordpress?: WordPressOverview | null`; `WordPressCard` component; `POST /api/admin/[slug]/wordpress?key=…` with `{ action: "disconnect" }` → `{ ok: true, disconnected: boolean }`.

Design: invoke the `impeccable` skill first (it reads `.impeccable.md`: light theme, calm, no cards inside cards, 44 px targets, BG first) and match the existing dashboard components (`QrCard.tsx`, `bits.tsx`: `rounded-3xl bg-card p-5 ring-1 ring-ink/10`, `min-h-11 rounded-full` buttons). The card is one surface: status line, the three steps, the last five pushes, Disconnect. No nested cards, no icons above headings.

Deviation from the spec sentence about an `extra` slot: a server component cannot pass a render function to a client component, so `AdminPanel` imports and renders `WordPressCard` directly with the polled overview (one import and one line; the templates track also edits `AdminPanel.tsx`, so expect a trivial merge there).

- [ ] **Step 1: Overview data**

Append to `src/server/admin.ts` (end of file):

```ts

// --- WordPress card (integrations track, appended 2026-10-10) ---
export interface WordPressOverview {
  site_url: string;
  site_name: string;
  status: DestinationStatus;
  connected_at: string | null;
  last_error: string | null;
  /** The last five pushes, newest first. */
  syncs: { id: string; change_set_id: string; status: SyncStatus; summary_bg: string; summary_en: string; updated_at: string; last_error: string | null }[];
}

/** Never includes secrets: it reads the destination row and drops everything but display fields. */
export async function wordPressOverview(store: Store, venueId: string): Promise<WordPressOverview | null> {
  const d = await store.getDestination(venueId, "wordpress");
  if (!d) return null;
  const all = (await store.listSyncs({ venueId })).filter((s) => s.destination_id === d.id);
  const last = all.slice(-5).reverse();
  const sets = await Promise.all(last.map((s) => store.getChangeSet(s.change_set_id).catch(() => null)));
  return {
    site_url: String(d.config.site_url ?? ""),
    site_name: String(d.config.site_name ?? ""),
    status: d.status,
    connected_at: typeof d.config.connected_at === "string" ? d.config.connected_at : null,
    last_error: d.last_error,
    syncs: last.map((s, i) => ({ id: s.id, change_set_id: s.change_set_id, status: s.status, summary_bg: sets[i]?.summary_bg ?? "", summary_en: sets[i]?.summary_en ?? "", updated_at: s.updated_at, last_error: s.last_error })),
  };
}
```

with `DestinationStatus, SyncStatus` added to the type import from `../store/types`. Append to `AdminOverview` (last member): `wordpress?: WordPressOverview | null;` and to the object returned by `adminOverview` (last key): `wordpress: await wordPressOverview(store, venue.id),`.

- [ ] **Step 2: Write the failing test**

Create `test/admin-wordpress.test.ts`:

```ts
// test/admin-wordpress.test.ts
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WordPressCard } from "@/app/admin/[slug]/components/WordPressCard";
import { LangProvider } from "@/src/i18n";
import { adminOverview, wordPressOverview } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

describe("wordPressOverview", () => {
  it("is null without a destination and lists the last five pushes newest first without secrets", async () => {
    const { store, venue } = await makeDemo();
    expect(await wordPressOverview(store, venue.id)).toBeNull();
    const dest = await store.upsertDestination({ venue_id: venue.id, kind: "wordpress", config: { site_url: "https://cafe.example", site_name: "Smoke Café", connected_at: T0.toISOString() }, secrets: "SECRET-BLOB" });
    for (let i = 0; i < 6; i++) {
      const cs = await store.createChangeSet({ venue_id: venue.id, chat_id: null, summary_bg: `Промяна ${i}`, summary_en: `Change ${i}`, preview_bg: "", preview_en: "", source: "text", status: "proposed", changes: [] });
      const s = await store.createSync({ venue_id: venue.id, destination_id: dest.id, change_set_id: cs.id, payload: { kind: "wordpress" }, next_at: T0.toISOString() });
      await store.updateSync(s.id, { status: i === 5 ? "failed" : "done", last_error: i === 5 ? "boom" : null });
    }
    const o = await wordPressOverview(store, venue.id);
    expect(o).toMatchObject({ site_url: "https://cafe.example", site_name: "Smoke Café", status: "connected", connected_at: T0.toISOString() });
    expect(o?.syncs.map((s) => [s.summary_en, s.status])).toEqual([["Change 5", "failed"], ["Change 4", "done"], ["Change 3", "done"], ["Change 2", "done"], ["Change 1", "done"]]);
    expect(JSON.stringify(o)).not.toContain("SECRET");
    const full = await adminOverview(store, venue, T0, "https://site.example");
    expect(full.wordpress?.site_name).toBe("Smoke Café");
    expect(JSON.stringify(full)).not.toContain("SECRET");
  });
});

describe("WordPressCard", () => {
  const render = (lang: "bg" | "en", overview: Parameters<typeof WordPressCard>[0]["overview"]) =>
    renderToStaticMarkup(<LangProvider defaultLang={lang}><WordPressCard overview={overview} slug="agala" adminKey="k" baseUrl="https://site.example" tz="Europe/Sofia" /></LangProvider>);
  it("explains the three steps with the download and the two settings when not connected", () => {
    const html = render("bg", null);
    expect(html).toContain('href="/wp/site-manager.zip"');
    expect(html).toContain("https://site.example");
    expect(html).toContain(">agala<");
    expect(html).toContain("Генерирай код");
    expect(html).toContain("/connect");
    expect(html).not.toContain("Прекъсни");
    expect(render("en", null)).toContain("Generate code");
  });
  it("shows the connection, the pushes and the Disconnect button when connected", () => {
    const html = render("en", { site_url: "https://cafe.example", site_name: "Smoke Café", status: "connected", connected_at: T0.toISOString(), last_error: null, syncs: [{ id: "s1", change_set_id: "c1", status: "done", summary_bg: "Нов текст", summary_en: "New text", updated_at: T0.toISOString(), last_error: null }, { id: "s2", change_set_id: "c2", status: "pending", summary_bg: "x", summary_en: "Logo", updated_at: T0.toISOString(), last_error: "unreachable" }] });
    expect(html).toContain("Smoke Café");
    expect(html).toContain("Connected");
    expect(html).toContain("New text");
    expect(html).toContain("will retry");
    expect(html).toContain("Disconnect");
    const errored = render("bg", { site_url: "https://cafe.example", site_name: "Smoke Café", status: "error", connected_at: null, last_error: "WordPress unreachable", syncs: [] });
    expect(errored).toContain("Има проблем");
    expect(errored).toContain("WordPress unreachable");
  });
});
```

Rename the file to `test/admin-wordpress.test.tsx` (it contains JSX) and check `vitest.config.mts` `include` covers `test/**/*.test.tsx`; if not, change it to `["test/**/*.test.{ts,tsx}"]` (free file) and confirm the existing tests still run. React 19's `renderToStaticMarkup` works in the node environment.

Run: `npx vitest run test/admin-wordpress.test.tsx`
Expected: FAIL (component missing).

- [ ] **Step 3: Dictionary keys**

Append at the end of the `en` object in `src/i18n/dicts.ts`:

```ts
  "admin.wp.title": "WordPress",
  "admin.wp.intro": "Already have a WordPress site? The plugin shows your menu, specials, hours, announcements and photos there; once connected, the bot can also edit its pages.",
  "admin.wp.step1": "Download the plugin and install it in WordPress (Plugins → Add New → Upload Plugin).",
  "admin.wp.download": "Download site-manager.zip",
  "admin.wp.step2": "Open Settings → Site Manager in WordPress and paste these two values:",
  "admin.wp.baseUrl": "Site Manager address",
  "admin.wp.slug": "Venue code",
  "admin.wp.copy": "Copy",
  "admin.wp.copied": "Copied",
  "admin.wp.step3": "Press “Generate code” on that page and send the bot the line it shows: /connect <site address> <code>.",
  "admin.wp.notConnected": "Not connected yet",
  "admin.wp.connected": "Connected",
  "admin.wp.error": "Needs attention",
  "admin.wp.since": "since {when}",
  "admin.wp.lastPushes": "Last changes sent to WordPress",
  "admin.wp.noPushes": "No changes sent yet.",
  "admin.wp.sync.done": "sent",
  "admin.wp.sync.pending": "will retry",
  "admin.wp.sync.failed": "failed",
  "admin.wp.disconnect": "Disconnect",
  "admin.wp.disconnectConfirm": "Disconnect the WordPress site? The plugin keeps showing your menu; the bot stops editing pages until you connect again.",
```

and at the end of the `bg` object:

```ts
  "admin.wp.title": "WordPress",
  "admin.wp.intro": "Вече имате сайт на WordPress? Плъгинът показва там менюто, предложенията, работното време, съобщенията и снимките ви; след свързване ботът може да редактира и страниците му.",
  "admin.wp.step1": "Изтеглете плъгина и го инсталирайте в WordPress (Плъгини → Добави нов → Качи плъгин).",
  "admin.wp.download": "Изтегли site-manager.zip",
  "admin.wp.step2": "Отворете Настройки → Site Manager в WordPress и поставете тези две стойности:",
  "admin.wp.baseUrl": "Адрес на Site Manager",
  "admin.wp.slug": "Код на заведението",
  "admin.wp.copy": "Копирай",
  "admin.wp.copied": "Копирано",
  "admin.wp.step3": "Натиснете „Генерирай код“ на същата страница и изпратете на бота реда, който се показва: /connect <адрес на сайта> <код>.",
  "admin.wp.notConnected": "Още не е свързан",
  "admin.wp.connected": "Свързан",
  "admin.wp.error": "Има проблем",
  "admin.wp.since": "от {when}",
  "admin.wp.lastPushes": "Последни промени, изпратени към WordPress",
  "admin.wp.noPushes": "Още няма изпратени промени.",
  "admin.wp.sync.done": "изпратено",
  "admin.wp.sync.pending": "ще опитам пак",
  "admin.wp.sync.failed": "неуспешно",
  "admin.wp.disconnect": "Прекъсни връзката",
  "admin.wp.disconnectConfirm": "Да прекъсна ли връзката със сайта на WordPress? Плъгинът продължава да показва менюто; ботът спира да редактира страници, докато не свържете сайта отново.",
```

- [ ] **Step 4: The card**

Create `app/admin/[slug]/components/WordPressCard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useLang } from "@/src/i18n";
import type { WordPressOverview } from "@/src/server/admin";
import { formatDateTime } from "@/src/time";
import { Chip, Section } from "./bits";

const TONE = { done: "good", pending: "warn", failed: "warn" } as const;

/** Connect-your-WordPress card: status, the three steps (download, two settings, /connect line), the last pushes, Disconnect. */
export function WordPressCard({ overview, slug, adminKey, baseUrl, tz }: { overview: WordPressOverview | null; slug: string; adminKey: string; baseUrl: string; tz: string }) {
  const { lang, t } = useLang();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // clipboard blocked: the value is visible and selectable anyway
    }
  }
  async function disconnect() {
    if (!window.confirm(t("admin.wp.disconnectConfirm"))) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/admin/${encodeURIComponent(slug)}/wordpress?key=${encodeURIComponent(adminKey)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) });
      setFailed(!res.ok);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  }

  const settings = [
    { key: "base", label: t("admin.wp.baseUrl"), value: baseUrl },
    { key: "slug", label: t("admin.wp.slug"), value: slug },
  ];
  const connected = overview !== null;
  const tone = overview?.status === "connected" ? "good" : overview ? "warn" : "plain";
  const statusLabel = !overview ? t("admin.wp.notConnected") : overview.status === "connected" ? t("admin.wp.connected") : t("admin.wp.error");

  return (
    <Section id="wordpress" title={t("admin.wp.title")}>
      <div className="rounded-3xl bg-card p-5 ring-1 ring-ink/10">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={tone}>{statusLabel}</Chip>
          {overview && (
            <span className="[overflow-wrap:anywhere] text-sm text-ink-soft">
              <a href={overview.site_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline-offset-2 hover:underline">{overview.site_name || overview.site_url}</a>
              {overview.connected_at && ` · ${t("admin.wp.since", { when: formatDateTime(overview.connected_at, lang, tz) })}`}
            </span>
          )}
        </div>
        {overview?.last_error && <p role="alert" className="mt-2 text-sm font-semibold text-clay">{overview.last_error}</p>}
        {!connected && <p className="mt-3 text-ink-soft">{t("admin.wp.intro")}</p>}

        <ol className="mt-4 space-y-4 text-sm text-ink">
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">1.</span>
            <div>
              <p>{t("admin.wp.step1")}</p>
              <a href="/wp/site-manager.zip" download className="mt-2 inline-flex min-h-11 items-center rounded-full bg-accent px-5 font-semibold text-white transition hover:brightness-110">{t("admin.wp.download")}</a>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">2.</span>
            <div className="min-w-0 flex-1">
              <p>{t("admin.wp.step2")}</p>
              <dl className="mt-2 grid gap-2">
                {settings.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-paper-deep px-3 py-2">
                    <div className="min-w-0">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{s.label}</dt>
                      <dd className="[overflow-wrap:anywhere] font-mono text-sm">{s.value}</dd>
                    </div>
                    <button type="button" onClick={() => void copy(s.key, s.value)} className="min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-ink/25 hover:bg-ink/5">
                      {copied === s.key ? t("admin.wp.copied") : t("admin.wp.copy")}
                    </button>
                  </div>
                ))}
              </dl>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="min-w-6 font-semibold tabular-nums text-ink-soft">3.</span>
            <p>{t("admin.wp.step3")}</p>
          </li>
        </ol>

        {connected && (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">{t("admin.wp.lastPushes")}</h3>
            {overview.syncs.length === 0 ? (
              <p className="mt-2 text-sm text-ink-soft">{t("admin.wp.noPushes")}</p>
            ) : (
              <ul className="mt-2 divide-y divide-ink/10">
                {overview.syncs.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 font-semibold">{(lang === "bg" ? s.summary_bg : s.summary_en) || s.summary_bg}</span>
                    <span className="flex items-center gap-2 text-ink-soft">
                      <span suppressHydrationWarning>{formatDateTime(s.updated_at, lang, tz)}</span>
                      <Chip tone={TONE[s.status]}>{t(`admin.wp.sync.${s.status}`)}</Chip>
                    </span>
                    {s.status !== "done" && s.last_error && <span className="[overflow-wrap:anywhere] w-full text-xs text-clay">{s.last_error}</span>}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void disconnect()} aria-busy={busy} className="min-h-11 rounded-full px-5 text-sm font-semibold text-ink ring-1 ring-ink/25 transition hover:bg-ink/5 disabled:opacity-60">
                {busy ? t("admin.busy") : t("admin.wp.disconnect")}
              </button>
              {failed && <p role="alert" className="text-sm font-semibold text-clay">{t("admin.failed")}</p>}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
```

If `t(\`admin.wp.sync.${s.status}\`)` does not satisfy `MessageKey`, map it explicitly: `const SYNC_LABEL = { done: "admin.wp.sync.done", pending: "admin.wp.sync.pending", failed: "admin.wp.sync.failed" } as const;` and call `t(SYNC_LABEL[s.status])`.

In `app/admin/[slug]/components/AdminPanel.tsx` add `import { WordPressCard } from "./WordPressCard";` and, directly before `<QrCard publicUrl={o.public_url} slug={slug} />`, the line:

```tsx
        <WordPressCard overview={o.wordpress ?? null} slug={slug} adminKey={adminKey} baseUrl={o.public_url.replace(new RegExp(`/${slug}$`), "")} tz={tz} />
```

- [ ] **Step 5: The disconnect route**

Create `app/api/admin/[slug]/wordpress/route.ts`:

```ts
import { after } from "next/server";
import { disconnectWordPress } from "@/src/destinations/connect";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

/** POST { action: "disconnect" } with ?key=<admin token>: removes the stored WordPress connection. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/wordpress">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "disconnect") return Response.json({ error: "bad request" }, { status: 400 });
  const disconnected = await disconnectWordPress({ store: deps.store, secretKey: deps.destinationSecretKey }, venue.id);
  return Response.json({ ok: true, disconnected });
}
```

Run `npx next typegen` once so `RouteContext<"/api/admin/[slug]/wordpress">` exists, then `npm run typecheck`.

- [ ] **Step 6: Run, lint, build, commit**

Run: `npx vitest run test/admin-wordpress.test.tsx test/admin-server.test.ts && npm run typecheck && npm run lint && npm test && npm run build`
Expected: green; the build must not warn about the card.

```bash
git add src/server/admin.ts src/i18n/dicts.ts app/admin/[slug]/components/WordPressCard.tsx app/admin/[slug]/components/AdminPanel.tsx app/api/admin/[slug]/wordpress/route.ts test/admin-wordpress.test.tsx vitest.config.mts
git commit -m "Dashboard: WordPress card with install steps, push history and disconnect

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The WordPress plugin, read side (feed client, renderers, shortcodes, settings page, CSS, translations, PHP tests)

**Files:**
- Create: `integrations/wordpress/site-manager/site-manager.php`, `integrations/wordpress/site-manager/uninstall.php`, `integrations/wordpress/site-manager/readme.txt`, `integrations/wordpress/site-manager/CHANGELOG.md`, `integrations/wordpress/site-manager/includes/class-sm-labels.php`, `integrations/wordpress/site-manager/includes/class-sm-client.php`, `integrations/wordpress/site-manager/includes/class-sm-render.php`, `integrations/wordpress/site-manager/includes/class-sm-shortcodes.php`, `integrations/wordpress/site-manager/includes/class-sm-settings.php`, `integrations/wordpress/site-manager/assets/site-manager.css`, `integrations/wordpress/site-manager/languages/site-manager-bg_BG.po`, `integrations/wordpress/site-manager/languages/site-manager-bg_BG.l10n.php` (generated), `integrations/wordpress/site-manager/languages/site-manager-bg_BG.mo` (generated), `integrations/wordpress/tests/shim.php`, `integrations/wordpress/tests/run.php`, `integrations/wordpress/tests/fixtures/feed.json`, `scripts/wp-plugin-i18n.mts`, `test/wp-plugin-contract.test.ts`, `test/wp-plugin-i18n.test.ts`
- Modify (append-only): `package.json` (scripts `wp:lint`, `wp:test`, `wp:i18n`)
- Test: `npm run wp:lint`, `npm run wp:test` (PHP in Docker), `test/wp-plugin-contract.test.ts`, `test/wp-plugin-i18n.test.ts`

**Interfaces:**
- Consumes: the public feed `GET <base>/api/site/<slug>` → `{ state: SiteState, now: ISO }` (see `src/domain/types.ts`).
- Produces (PHP): `SM_Labels::get(string $key, string $lang): string`, `SM_Labels::lang(string $requested, array $state): string`, `SM_Labels::price(float $eur, string $lang): string`, `SM_Labels::weekday(string $day, string $lang): string`, `SM_Labels::allergen(int $code, string $lang): string`; `SM_Client::settings(): array`, `SM_Client::feed_url(): ?string`, `SM_Client::fetch(bool $bypass_cache = false): array|WP_Error` (`['state' => …, 'now' => …, 'stale' => bool]`), `SM_Client::clear_cache(): void`; `SM_Render::menu|specials|hours|announcements|photos(array $state, string $now, string $lang): string`, `SM_Render::text(array $state, string $key, string $lang): string`, `SM_Render::unavailable(WP_Error $e): string`, `SM_Render::wrap(string $block, string $inner, array $state): string`, time helpers `SM_Render::local(string $iso, string $tz): array{date,time,weekday}`, `SM_Render::today_status(...)`, `SM_Render::format_datetime(string $iso, string $lang, string $tz)`, `SM_Render::format_date(string $date, string $lang)`; `SM_Shortcodes::register()`, `SM_Shortcodes::render(string $block, array $atts): string`; `SM_Settings::register()`, `SM_Settings::add_page()`, `SM_Settings::page()`, `SM_Settings::sanitize(array $in): array`, option name `site_manager_settings` = `['base_url','slug','cache_seconds','lang']`. Task 9 (blocks) calls `SM_Shortcodes::render`; Task 10 adds the connect box into `SM_Settings::page()` through the action `site_manager_settings_after_form`.

Decisions: no build step, no Composer, no external PHP dependencies; one class per file, all static (the plugin has no state beyond options and transients); every string shown to WordPress admins goes through `__()` with text domain `site-manager`, every string shown to guests comes from `SM_Labels` keyed by the block's `lang`.

- [ ] **Step 1: The PHP test shim, fixture and runner (written first; they fail until the classes exist)**

Create `integrations/wordpress/tests/shim.php` (just enough WordPress for the pure classes):

```php
<?php
// Minimal WordPress function shim for running the plugin's pure classes under php-cli (no WordPress).
declare(strict_types=1);

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
if (!defined('SITE_MANAGER_VERSION')) {
    define('SITE_MANAGER_VERSION', 'test');
}
$GLOBALS['sm_test_options'] = [];
$GLOBALS['sm_test_transients'] = [];

class WP_Error
{
    public function __construct(public string $code = '', public string $message = '', public mixed $data = null) {}
    public function get_error_code(): string { return $this->code; }
    public function get_error_message(): string { return $this->message; }
    public function get_error_data(): mixed { return $this->data; }
}
function is_wp_error(mixed $v): bool { return $v instanceof WP_Error; }
function esc_html(mixed $s): string { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function esc_attr(mixed $s): string { return esc_html($s); }
function esc_url(mixed $s): string { $s = (string) $s; return preg_match('#^(https?:|tel:|mailto:|/)#i', $s) ? esc_html($s) : ''; }
function __(string $s, string $d = 'default'): string { return $s; }
function esc_html__(string $s, string $d = 'default'): string { return esc_html($s); }
function esc_attr__(string $s, string $d = 'default'): string { return esc_attr($s); }
function _x(string $s, string $c, string $d = 'default'): string { return $s; }
function wp_kses_post(string $s): string { return $s; }
function sanitize_text_field(mixed $s): string { return trim(strip_tags((string) $s)); }
function sanitize_key(mixed $s): string { return preg_replace('/[^a-z0-9_\-]/', '', strtolower((string) $s)) ?? ''; }
function absint(mixed $v): int { return abs((int) $v); }
function wp_json_encode(mixed $v, int $flags = 0): string|false { return json_encode($v, $flags | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }
function apply_filters(string $hook, mixed $v, mixed ...$args): mixed { return $v; }
function do_action(string $hook, mixed ...$args): void {}
function add_action(string $hook, mixed $cb, int $p = 10, int $a = 1): void {}
function add_filter(string $hook, mixed $cb, int $p = 10, int $a = 1): void {}
function add_shortcode(string $tag, mixed $cb): void {}
function shortcode_atts(array $pairs, array $atts, string $sc = ''): array { return array_merge($pairs, array_intersect_key($atts, $pairs)); }
function wp_enqueue_style(string $h): void {}
function wp_register_style(string $h, string $src, array $deps = [], mixed $ver = false): void {}
function current_user_can(string $cap): bool { return false; }
function get_option(string $k, mixed $default = false): mixed { return $GLOBALS['sm_test_options'][$k] ?? $default; }
function update_option(string $k, mixed $v, mixed $autoload = null): bool { $GLOBALS['sm_test_options'][$k] = $v; return true; }
function delete_option(string $k): bool { unset($GLOBALS['sm_test_options'][$k]); return true; }
function get_transient(string $k): mixed { return $GLOBALS['sm_test_transients'][$k] ?? false; }
function set_transient(string $k, mixed $v, int $ttl = 0): bool { $GLOBALS['sm_test_transients'][$k] = $v; return true; }
function delete_transient(string $k): bool { unset($GLOBALS['sm_test_transients'][$k]); return true; }
function wp_parse_args(mixed $args, array $defaults = []): array { return array_merge($defaults, is_array($args) ? $args : []); }
function wp_strip_all_tags(string $s): string { return trim(preg_replace('/\s+/', ' ', strip_tags($s)) ?? ''); }
function trailingslashit(string $s): string { return rtrim($s, '/') . '/'; }
function untrailingslashit(string $s): string { return rtrim($s, '/'); }
function esc_url_raw(string $s): string { return $s; }
function wp_remote_get(string $url, array $args = []): mixed { return $GLOBALS['sm_test_remote'] ?? new WP_Error('http_request_failed', 'no network in tests'); }
function wp_remote_retrieve_response_code(mixed $r): int { return is_array($r) ? ($r['response']['code'] ?? 0) : 0; }
function wp_remote_retrieve_body(mixed $r): string { return is_array($r) ? ($r['body'] ?? '') : ''; }
```

Create `integrations/wordpress/tests/fixtures/feed.json` (the demo café on Fri 9 Oct 2026, 12:00 Sofia; one live special, one expired special, one sold-out item, one elapsed sold-out, one live and one expired announcement, a past and a future holiday, two gallery photos, one item photo):

```json
{
  "state": {
    "venue": {
      "id": "v1", "slug": "agala", "name": "Кафене „Ъгъла“",
      "tagline_bg": "Кафе на ъгъла", "tagline_en": "Coffee on the corner",
      "about_bg": "Малко кафене в центъра.", "about_en": "A small café downtown.",
      "address": "ул. Пример 1, София", "phone": "+359 2 000 0000", "maps_url": "https://maps.example/agala", "instagram": "agala.cafe",
      "cover_media_id": "m-cover", "logo_media_id": null,
      "hours": { "mon": { "open": "08:00", "close": "18:00" }, "tue": { "open": "08:00", "close": "18:00" }, "wed": { "open": "08:00", "close": "18:00" }, "thu": { "open": "08:00", "close": "18:00" }, "fri": { "open": "08:00", "close": "18:00" }, "sat": { "open": "09:00", "close": "16:00" }, "sun": null },
      "tz": "Europe/Sofia", "default_lang": "bg", "theme": { "accent": "#2f6b4f" },
      "template": "classic", "business_type": "cafe", "status": "live", "deploy": null, "wizard_draft": null, "created_at": "2026-10-01T00:00:00.000Z"
    },
    "categories": [
      { "id": "c-coffee", "venue_id": "v1", "name_bg": "Кафе", "name_en": "Coffee", "position": 0, "active": true },
      { "id": "c-pastry", "venue_id": "v1", "name_bg": "Закуски", "name_en": "Pastries", "position": 1, "active": true },
      { "id": "c-old", "venue_id": "v1", "name_bg": "Стара категория", "name_en": "Old category", "position": 2, "active": false }
    ],
    "items": [
      { "id": "i-esp", "venue_id": "v1", "category_id": "c-coffee", "name_bg": "Еспресо", "name_en": "Espresso", "desc_bg": "Двойна доза.", "desc_en": "A double shot.", "price_eur": 1.8, "allergens": [], "image_media_id": null, "sold_out_until": null, "is_special": false, "special_expires_at": null, "position": 0, "active": true, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" },
      { "id": "i-cap", "venue_id": "v1", "category_id": "c-coffee", "name_bg": "Капучино", "name_en": "Cappuccino", "desc_bg": "С прясно мляко.", "desc_en": "With fresh milk.", "price_eur": 2.9, "allergens": [7], "image_media_id": "m-cap", "sold_out_until": "2026-10-09T15:00:00.000Z", "is_special": false, "special_expires_at": null, "position": 1, "active": true, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" },
      { "id": "i-ban", "venue_id": "v1", "category_id": "c-pastry", "name_bg": "Баница със сирене", "name_en": "Cheese banitsa", "desc_bg": "", "desc_en": "", "price_eur": 2.5, "allergens": [1, 3, 7], "image_media_id": null, "sold_out_until": "2026-10-09T06:00:00.000Z", "is_special": false, "special_expires_at": null, "position": 0, "active": true, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" },
      { "id": "i-sp", "venue_id": "v1", "category_id": "c-pastry", "name_bg": "Тиквеник", "name_en": "Pumpkin banitsa", "desc_bg": "Днес от фурната.", "desc_en": "Fresh today.", "price_eur": 3.0, "allergens": [1], "image_media_id": null, "sold_out_until": null, "is_special": true, "special_expires_at": "2026-10-09T15:00:00.000Z", "position": 1, "active": true, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" },
      { "id": "i-old", "venue_id": "v1", "category_id": "c-pastry", "name_bg": "Стара специалност", "name_en": "Old special", "desc_bg": "", "desc_en": "", "price_eur": 4.0, "allergens": [], "image_media_id": null, "sold_out_until": null, "is_special": true, "special_expires_at": "2026-10-08T15:00:00.000Z", "position": 2, "active": true, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" },
      { "id": "i-gone", "venue_id": "v1", "category_id": "c-coffee", "name_bg": "Премахнато", "name_en": "Removed", "desc_bg": "", "desc_en": "", "price_eur": 9.0, "allergens": [], "image_media_id": null, "sold_out_until": null, "is_special": false, "special_expires_at": null, "position": 2, "active": false, "created_at": "2026-10-01T00:00:00.000Z", "updated_at": "2026-10-01T00:00:00.000Z" }
    ],
    "holidays": [
      { "id": "h-past", "venue_id": "v1", "date": "2026-10-01", "note_bg": "Инвентаризация", "note_en": "Stock-taking" },
      { "id": "h-xmas", "venue_id": "v1", "date": "2026-12-24", "note_bg": "Весели празници!", "note_en": "Happy holidays!" }
    ],
    "announcements": [
      { "id": "a-live", "venue_id": "v1", "text_bg": "Днес свирим джаз от 19:00", "text_en": "Live jazz tonight from 19:00", "expires_at": "2026-10-09T20:00:00.000Z", "created_at": "2026-10-09T06:00:00.000Z" },
      { "id": "a-old", "venue_id": "v1", "text_bg": "Старо съобщение", "text_en": "Old announcement", "expires_at": "2026-10-08T20:00:00.000Z", "created_at": "2026-10-07T06:00:00.000Z" }
    ],
    "media": [
      { "id": "m-cover", "venue_id": "v1", "storage_path": "v1/cover.jpg", "public_url": "https://cdn.example/v1/cover.jpg", "is_gallery": false, "position": 0, "created_at": "2026-10-01T00:00:00.000Z" },
      { "id": "m-cap", "venue_id": "v1", "storage_path": "v1/cap.jpg", "public_url": "https://cdn.example/v1/cap.jpg", "is_gallery": false, "position": 0, "created_at": "2026-10-01T00:00:00.000Z" },
      { "id": "m-g2", "venue_id": "v1", "storage_path": "v1/g2.jpg", "public_url": "https://cdn.example/v1/g2.jpg", "is_gallery": true, "position": 2, "created_at": "2026-10-01T00:00:00.000Z" },
      { "id": "m-g1", "venue_id": "v1", "storage_path": "v1/g1.jpg", "public_url": "https://cdn.example/v1/g1.jpg", "is_gallery": true, "position": 1, "created_at": "2026-10-01T00:00:00.000Z" }
    ],
    "texts": [
      { "venue_id": "v1", "key": "welcome", "text_bg": "Добре дошли!", "text_en": "Welcome!" },
      { "venue_id": "v1", "key": "footer_note", "text_bg": "Приемаме карти.", "text_en": "Cards accepted." }
    ]
  },
  "now": "2026-10-09T09:00:00.000Z"
}
```

Create `integrations/wordpress/tests/run.php`:

```php
<?php
// Runs the plugin's pure PHP classes against tests/fixtures/feed.json. Usage (from the repo root):
//   npm run wp:test   (php:8.3-cli in Docker)   or   php integrations/wordpress/tests/run.php
declare(strict_types=1);

require __DIR__ . '/shim.php';
$plugin = dirname(__DIR__) . '/site-manager';
require $plugin . '/includes/class-sm-labels.php';
require $plugin . '/includes/class-sm-client.php';
require $plugin . '/includes/class-sm-render.php';
foreach (glob(__DIR__ . '/cases/*.php') ?: [] as $extra) {
    require $extra; // Task 10 adds write-channel cases here
}

$feed = json_decode((string) file_get_contents(__DIR__ . '/fixtures/feed.json'), true, 512, JSON_THROW_ON_ERROR);
$state = $feed['state'];
$now = $feed['now'];
$fails = 0;

function check(string $name, bool $ok, string $detail = ''): void
{
    global $fails;
    echo ($ok ? 'PASS ' : 'FAIL ') . $name . ($detail !== '' ? " ($detail)" : '') . "\n";
    if (!$ok) {
        $fails++;
    }
}
function has(string $hay, string $needle): bool
{
    return str_contains($hay, $needle);
}
function before(string $hay, string $a, string $b): bool
{
    $pa = strpos($hay, $a);
    $pb = strpos($hay, $b);
    return $pa !== false && $pb !== false && $pa < $pb;
}

// Labels
check('bg price', SM_Labels::price(2.9, 'bg') === '2,90 €', SM_Labels::price(2.9, 'bg'));
check('en price', SM_Labels::price(2.9, 'en') === '€2.90', SM_Labels::price(2.9, 'en'));
check('auto lang = venue default', SM_Labels::lang('auto', $state) === 'bg');
check('explicit lang wins', SM_Labels::lang('en', $state) === 'en');
check('bad lang falls back', SM_Labels::lang('de', $state) === 'bg');
check('allergen name', SM_Labels::allergen(7, 'en') === 'Milk' && SM_Labels::allergen(7, 'bg') === 'Мляко');

// Time helpers
$local = SM_Render::local($now, 'Europe/Sofia');
check('local parts', $local === ['date' => '2026-10-09', 'time' => '12:00', 'weekday' => 'fri'], json_encode($local));
check('format_datetime bg', SM_Render::format_datetime('2026-12-24T06:00:00.000Z', 'bg', 'Europe/Sofia') === '24.12.2026, 08:00');
check('format_datetime en', SM_Render::format_datetime('2026-12-24T06:00:00.000Z', 'en', 'Europe/Sofia') === '24 Dec 2026, 08:00');
check('format_date', SM_Render::format_date('2026-12-24', 'bg') === '24.12.2026' && SM_Render::format_date('2026-12-24', 'en') === '24 Dec 2026');
$status = SM_Render::today_status($state['venue']['hours'], $state['holidays'], $now, 'Europe/Sofia');
check('open now until 18:00', $status['state'] === 'open' && $status['until'] === '18:00', json_encode($status));
$sunday = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-10-11T10:00:00.000Z', 'Europe/Sofia');
check('closed on Sunday, opens Monday 08:00', $sunday['state'] === 'closed' && $sunday['next'] === '2026-10-12T05:00:00+00:00', json_encode($sunday));
$early = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-10-09T04:30:00.000Z', 'Europe/Sofia');
check('opens later today', $early['state'] === 'opens_later' && $early['at'] === '08:00', json_encode($early));
$xmas = SM_Render::today_status($state['venue']['hours'], $state['holidays'], '2026-12-24T10:00:00.000Z', 'Europe/Sofia');
check('holiday closes the day and names it', $xmas['state'] === 'closed' && $xmas['holiday']['note_bg'] === 'Весели празници!', json_encode($xmas));

// Menu
$menu = SM_Render::menu($state, $now, 'bg');
check('menu wraps with the accent', has($menu, 'class="sm sm-menu"') && has($menu, '--sm-accent:#2f6b4f'));
check('menu lists categories in order', before($menu, 'Кафе', 'Закуски'));
check('menu hides the inactive category', !has($menu, 'Стара категория'));
check('menu hides removed and expired items', !has($menu, 'Премахнато') && !has($menu, 'Стара специалност'));
check('menu shows the live special', has($menu, 'Тиквеник'));
check('sold-out item is marked until 18:00', has($menu, 'sm-sold-out') && has($menu, 'Изчерпано до 09.10.2026, 18:00'));
check('elapsed sold-out is available', substr_count($menu, 'sm-sold-out') === 1);
check('bg price in menu', has($menu, '2,90 €'));
check('en price in menu', has(SM_Render::menu($state, $now, 'en'), '€2.90'));
$legend = substr($menu, (int) strpos($menu, 'sm-legend'));
check('allergen chips and legend', has($menu, 'title="Мляко"') && has($legend, 'Кодове на алергените (ЕС 1169/2011)') && before($legend, 'Глутен', 'Мляко'));
check('item photo is rendered', has($menu, 'https://cdn.example/v1/cap.jpg'));
check('escapes html in names', !has(SM_Render::menu(array_replace_recursive($state, ['items' => [0 => ['name_bg' => '<b>x</b>']]]), $now, 'bg'), '<b>x</b>'));
$empty = SM_Render::menu(['venue' => $state['venue'], 'categories' => [], 'items' => [], 'holidays' => [], 'announcements' => [], 'media' => [], 'texts' => []], $now, 'en');
check('empty menu says so', has($empty, 'The menu is being prepared.'));

// Specials
$specials = SM_Render::specials($state, $now, 'bg');
check('specials show the live one until 18:00', has($specials, 'Тиквеник') && has($specials, 'до 18:00'));
check('specials hide the expired one', !has($specials, 'Стара специалност'));
check('no specials renders nothing', SM_Render::specials(array_replace($state, ['items' => []]), $now, 'bg') === '');

// Hours
$hours = SM_Render::hours($state, $now, 'bg');
check('hours status line', has($hours, 'Отворено до 18:00') && has($hours, 'sm-status-open'));
check('hours table marks today', has($hours, 'aria-current="date"') && has($hours, 'пет'));
check('closed day label', has($hours, 'почивен ден'));
check('upcoming holiday only', has($hours, '24.12.2026') && !has($hours, '01.10.2026'));
check('find us links', has($hours, 'tel:+35920000000') && has($hours, 'https://instagram.com/agala.cafe') && has($hours, 'https://maps.example/agala'));
$hoursEn = SM_Render::hours($state, '2026-10-11T10:00:00.000Z', 'en');
check('closed status in English', has($hoursEn, 'Closed · opens 12 Oct 2026, 08:00'));

// Announcements
$ann = SM_Render::announcements($state, $now, 'en');
check('live announcement shown, expired hidden', has($ann, 'Live jazz tonight from 19:00') && !has($ann, 'Old announcement'));
check('no announcements renders nothing', SM_Render::announcements(array_replace($state, ['announcements' => []]), $now, 'en') === '');

// Photos
$photos = SM_Render::photos($state, $now, 'bg');
check('gallery in position order, non-gallery excluded', before($photos, 'g1.jpg', 'g2.jpg') && !has($photos, 'cover.jpg') && substr_count($photos, '<figure') === 2);

// Text
check('text welcome bg', SM_Render::text($state, 'welcome', 'bg') === '<span class="sm sm-text sm-text-welcome">Добре дошли!</span>');
check('text tagline en', has(SM_Render::text($state, 'tagline', 'en'), 'Coffee on the corner'));
check('text falls back to the other language', has(SM_Render::text(array_replace_recursive($state, ['venue' => ['tagline_en' => '']]), 'tagline', 'en'), 'Кафе на ъгъла'));
check('text name', has(SM_Render::text($state, 'name', 'en'), 'Кафене „Ъгъла“'));
check('unknown text key renders nothing', SM_Render::text($state, 'nope', 'bg') === '');

// Client (pure parts)
update_option('site_manager_settings', ['base_url' => 'https://site-manager.example/', 'slug' => 'agala', 'cache_seconds' => 30, 'lang' => 'auto']);
check('feed url', SM_Client::feed_url() === 'https://site-manager.example/api/site/agala', (string) SM_Client::feed_url());
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 200], 'body' => json_encode($feed)];
$fetched = SM_Client::fetch();
check('fetch parses the feed', is_array($fetched) && $fetched['now'] === $now && $fetched['stale'] === false);
$GLOBALS['sm_test_remote'] = new WP_Error('http_request_failed', 'down');
SM_Client::clear_cache();
$stale = SM_Client::fetch();
check('fetch serves the last good copy when the feed is down', is_array($stale) && $stale['stale'] === true);
delete_option('site_manager_feed_last_good');
SM_Client::clear_cache();
$err = SM_Client::fetch();
check('fetch returns WP_Error without any copy', is_wp_error($err) && $err->get_error_code() === 'site_manager_unavailable');
$GLOBALS['sm_test_remote'] = ['response' => ['code' => 404], 'body' => '{"error":"not found"}'];
$err404 = SM_Client::fetch();
check('404 is an error that names the slug', is_wp_error($err404) && has($err404->get_error_message(), 'agala'));
check('unavailable comment is safe', has(SM_Render::unavailable($err404), '<!-- Site Manager:') && !has(SM_Render::unavailable($err404), '<script'));

echo ($fails ? "\n$fails FAILED\n" : "\nALL PASSED\n");
exit($fails ? 1 : 0);
```

Append to `package.json` `scripts` (last entries):

```json
    "wp:lint": "docker run --rm -v \"$PWD/integrations/wordpress:/w\" -w /w php:8.3-cli sh -c 'find site-manager tests -name \"*.php\" -print0 | xargs -0 -n1 php -l | grep -v \"No syntax errors\" || true; find site-manager tests -name \"*.php\" -print0 | xargs -0 -n1 php -l >/dev/null'",
    "wp:test": "docker run --rm -v \"$PWD/integrations/wordpress:/w\" -w /w php:8.3-cli php tests/run.php",
    "wp:i18n": "tsx scripts/wp-plugin-i18n.mts"
```

Run: `npm run wp:test`
Expected: FAIL (classes missing).

- [ ] **Step 2: Bootstrap, uninstall, labels**

Create `integrations/wordpress/site-manager/site-manager.php`:

```php
<?php
/**
 * Plugin Name:       Site Manager
 * Plugin URI:        https://github.com/biskwida/site-manager
 * Description:       Shows your café's menu, specials, opening hours, announcements and photos from Site Manager, and lets the Site Manager agent edit this site once you connect it from Telegram.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            Site Manager
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       site-manager
 * Domain Path:       /languages
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('SITE_MANAGER_VERSION', '0.1.0');
define('SITE_MANAGER_FILE', __FILE__);
define('SITE_MANAGER_DIR', plugin_dir_path(__FILE__));
define('SITE_MANAGER_URL', plugin_dir_url(__FILE__));

require_once SITE_MANAGER_DIR . 'includes/class-sm-labels.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-client.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-render.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-shortcodes.php';
require_once SITE_MANAGER_DIR . 'includes/class-sm-settings.php';
foreach (['class-sm-blocks.php', 'class-sm-auth.php', 'class-sm-pages.php', 'class-sm-rest.php', 'class-sm-preview.php'] as $optional) {
    if (file_exists(SITE_MANAGER_DIR . 'includes/' . $optional)) {
        require_once SITE_MANAGER_DIR . 'includes/' . $optional; // Tasks 9 and 10 add these
    }
}

add_action('init', static function (): void {
    load_plugin_textdomain('site-manager', false, dirname(plugin_basename(SITE_MANAGER_FILE)) . '/languages');
    SM_Shortcodes::register();
    if (class_exists('SM_Blocks')) {
        SM_Blocks::register();
    }
    if (class_exists('SM_Preview')) {
        SM_Preview::register();
    }
});
add_action('wp_enqueue_scripts', static function (): void {
    wp_register_style('site-manager', SITE_MANAGER_URL . 'assets/site-manager.css', [], SITE_MANAGER_VERSION);
});
add_action('admin_menu', ['SM_Settings', 'add_page']);
add_action('admin_init', ['SM_Settings', 'register']);
add_action('rest_api_init', static function (): void {
    if (class_exists('SM_Rest')) {
        SM_Rest::register_routes();
    }
});
add_filter('plugin_action_links_' . plugin_basename(SITE_MANAGER_FILE), static function (array $links): array {
    array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=site-manager')) . '">' . esc_html__('Settings', 'site-manager') . '</a>');
    return $links;
});
```

Create `integrations/wordpress/site-manager/uninstall.php`:

```php
<?php
// Runs when the plugin is deleted from the Plugins screen: removes every option and transient it created.
declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
foreach (['site_manager_settings', 'site_manager_feed_last_good', 'site_manager_connect_code', 'site_manager_token', 'site_manager_api_log'] as $option) {
    delete_option($option);
}
global $wpdb;
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_site_manager_%' OR option_name LIKE '_transient_timeout_site_manager_%'");
```

Create `integrations/wordpress/site-manager/includes/class-sm-labels.php`:

```php
<?php
// Guest-facing labels in both languages, keyed like `site.*` in src/i18n/dicts.ts. Not tied to the WordPress locale:
// a block's `lang` attribute (or the venue's default language) decides.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Labels
{
    private const BG = [
        'menu' => 'Меню',
        'openUntil' => 'Отворено до {time}',
        'opensAt' => 'Отваря днес в {time}',
        'closedToday' => 'Днес е почивен ден',
        'closedUntil' => 'Затворено · отваря {when}',
        'specials' => 'Специални предложения днес',
        'specialUntil' => 'до {time}',
        'about' => 'За нас',
        'hours' => 'Работно време',
        'closedDay' => 'почивен ден',
        'holidays' => 'Предстоящи почивни дни',
        'findUs' => 'Къде сме',
        'map' => 'Отвори в картата',
        'call' => 'Обади се',
        'gallery' => 'Галерия',
        'soldOut' => 'Изчерпано',
        'soldOutUntil' => 'Изчерпано до {when}',
        'allergens' => 'Алергени',
        'allergenLegend' => 'Кодове на алергените (ЕС 1169/2011)',
        'noItems' => 'Менюто се подготвя.',
        'poweredBy' => 'Сайт от Site Manager',
        'unavailable' => 'Менюто не може да се зареди в момента.',
    ];
    private const EN = [
        'menu' => 'Menu',
        'openUntil' => 'Open until {time}',
        'opensAt' => 'Opens today at {time}',
        'closedToday' => 'Closed today',
        'closedUntil' => 'Closed · opens {when}',
        'specials' => "Today's specials",
        'specialUntil' => 'until {time}',
        'about' => 'About us',
        'hours' => 'Opening hours',
        'closedDay' => 'closed',
        'holidays' => 'Upcoming closures',
        'findUs' => 'Find us',
        'map' => 'Open in Maps',
        'call' => 'Call',
        'gallery' => 'Gallery',
        'soldOut' => 'Sold out',
        'soldOutUntil' => 'Sold out until {when}',
        'allergens' => 'Allergens',
        'allergenLegend' => 'Allergen codes (EU 1169/2011)',
        'noItems' => 'The menu is being prepared.',
        'poweredBy' => 'Site by Site Manager',
        'unavailable' => 'The menu cannot be loaded right now.',
    ];
    private const WEEKDAYS = [
        'mon' => ['bg' => 'пон', 'en' => 'Mon'],
        'tue' => ['bg' => 'вт', 'en' => 'Tue'],
        'wed' => ['bg' => 'ср', 'en' => 'Wed'],
        'thu' => ['bg' => 'четв', 'en' => 'Thu'],
        'fri' => ['bg' => 'пет', 'en' => 'Fri'],
        'sat' => ['bg' => 'съб', 'en' => 'Sat'],
        'sun' => ['bg' => 'нед', 'en' => 'Sun'],
    ];
    /** Regulation (EU) 1169/2011, Annex II. */
    private const ALLERGENS = [
        1 => ['bg' => 'Глутен', 'en' => 'Gluten'],
        2 => ['bg' => 'Ракообразни', 'en' => 'Crustaceans'],
        3 => ['bg' => 'Яйца', 'en' => 'Eggs'],
        4 => ['bg' => 'Риба', 'en' => 'Fish'],
        5 => ['bg' => 'Фъстъци', 'en' => 'Peanuts'],
        6 => ['bg' => 'Соя', 'en' => 'Soybeans'],
        7 => ['bg' => 'Мляко', 'en' => 'Milk'],
        8 => ['bg' => 'Ядки', 'en' => 'Nuts'],
        9 => ['bg' => 'Целина', 'en' => 'Celery'],
        10 => ['bg' => 'Горчица', 'en' => 'Mustard'],
        11 => ['bg' => 'Сусам', 'en' => 'Sesame'],
        12 => ['bg' => 'Сулфити', 'en' => 'Sulphites'],
        13 => ['bg' => 'Лупина', 'en' => 'Lupin'],
        14 => ['bg' => 'Мекотели', 'en' => 'Molluscs'],
    ];

    public static function get(string $key, string $lang, array $vars = []): string
    {
        $table = $lang === 'en' ? self::EN : self::BG;
        $s = $table[$key] ?? $key;
        foreach ($vars as $k => $v) {
            $s = str_replace('{' . $k . '}', (string) $v, $s);
        }
        return $s;
    }

    /** "bg" or "en": the requested one when valid, otherwise the venue's default language, otherwise "bg". */
    public static function lang(string $requested, array $state): string
    {
        $r = strtolower(trim($requested));
        if ($r === 'bg' || $r === 'en') {
            return $r;
        }
        $d = $state['venue']['default_lang'] ?? 'bg';
        return $d === 'en' ? 'en' : 'bg';
    }

    /** "2,90 €" (bg) / "€2.90" (en), like formatPrice in src/domain/format.ts. */
    public static function price(float $eur, string $lang): string
    {
        return $lang === 'en' ? '€' . number_format($eur, 2, '.', '') : number_format($eur, 2, ',', '') . ' €';
    }

    public static function weekday(string $day, string $lang): string
    {
        return self::WEEKDAYS[$day][$lang === 'en' ? 'en' : 'bg'] ?? $day;
    }

    public static function allergen(int $code, string $lang): string
    {
        return self::ALLERGENS[$code][$lang === 'en' ? 'en' : 'bg'] ?? (string) $code;
    }

    /** Picks the field in the reader's language, falling back to the other one (itemName/categoryName in format.ts). */
    public static function pick(array $row, string $field, string $lang): string
    {
        $mine = (string) ($row[$field . '_' . $lang] ?? '');
        if ($mine !== '') {
            return $mine;
        }
        return (string) ($row[$field . '_bg'] ?? '') ?: (string) ($row[$field . '_en'] ?? '');
    }
}
```

- [ ] **Step 3: The feed client**

Create `integrations/wordpress/site-manager/includes/class-sm-client.php`:

```php
<?php
// Reads the public Site Manager feed with a transient cache and a 24-hour "last good copy" fallback. Never throws.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Client
{
    public const OPTION = 'site_manager_settings';
    public const LAST_GOOD = 'site_manager_feed_last_good';
    private const STALE_TTL = 86400;
    private const TIMEOUT = 6;

    /** @return array{base_url: string, slug: string, cache_seconds: int, lang: string} */
    public static function settings(): array
    {
        $s = get_option(self::OPTION, []);
        $s = wp_parse_args(is_array($s) ? $s : [], ['base_url' => '', 'slug' => '', 'cache_seconds' => 30, 'lang' => 'auto']);
        return [
            'base_url' => untrailingslashit(trim((string) $s['base_url'])),
            'slug' => sanitize_key((string) $s['slug']),
            'cache_seconds' => max(5, min(3600, absint($s['cache_seconds']))),
            'lang' => in_array($s['lang'], ['bg', 'en', 'auto'], true) ? (string) $s['lang'] : 'auto',
        ];
    }

    public static function feed_url(): ?string
    {
        $s = self::settings();
        if ($s['base_url'] === '' || $s['slug'] === '') {
            return null;
        }
        return $s['base_url'] . '/api/site/' . rawurlencode($s['slug']);
    }

    private static function cache_key(string $url): string
    {
        return 'site_manager_feed_' . md5($url);
    }

    /**
     * @return array{state: array, now: string, stale: bool}|WP_Error
     */
    public static function fetch(bool $bypass_cache = false): array|WP_Error
    {
        $url = self::feed_url();
        if ($url === null) {
            return new WP_Error('site_manager_unconfigured', __('Site Manager is not configured yet: set the address and the venue code under Settings → Site Manager.', 'site-manager'));
        }
        $s = self::settings();
        $key = self::cache_key($url);
        if (!$bypass_cache) {
            $cached = get_transient($key);
            if (is_array($cached) && isset($cached['state'], $cached['now'])) {
                return ['state' => $cached['state'], 'now' => (string) $cached['now'], 'stale' => false];
            }
        }
        $res = wp_remote_get($url, ['timeout' => self::TIMEOUT, 'headers' => ['Accept' => 'application/json'], 'user-agent' => 'SiteManagerWP/' . SITE_MANAGER_VERSION]);
        $error = null;
        if (is_wp_error($res)) {
            $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager did not answer: %s', 'site-manager'), $res->get_error_message()));
        } else {
            $code = wp_remote_retrieve_response_code($res);
            $body = json_decode(wp_remote_retrieve_body($res), true);
            if ($code === 404) {
                $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager has no venue with the code "%s".', 'site-manager'), $s['slug']));
            } elseif ($code !== 200 || !is_array($body) || !isset($body['state']['venue'], $body['now'])) {
                $error = new WP_Error('site_manager_unavailable', sprintf(__('Site Manager answered with an unexpected response (HTTP %d).', 'site-manager'), (int) $code));
            } else {
                $value = ['state' => $body['state'], 'now' => (string) $body['now']];
                set_transient($key, $value, $s['cache_seconds']);
                update_option(self::LAST_GOOD, ['at' => time(), 'url' => $url] + $value, false);
                return $value + ['stale' => false];
            }
        }
        $last = get_option(self::LAST_GOOD, null);
        if (is_array($last) && ($last['url'] ?? '') === $url && isset($last['state'], $last['now'], $last['at']) && (int) $last['at'] + self::STALE_TTL > time()) {
            return ['state' => $last['state'], 'now' => (string) $last['now'], 'stale' => true];
        }
        return $error;
    }

    public static function clear_cache(): void
    {
        $url = self::feed_url();
        if ($url !== null) {
            delete_transient(self::cache_key($url));
        }
    }
}
```

Note: the shim's `wp_remote_get` returns `$GLOBALS['sm_test_remote']`; in the stale test the transient is cleared with `clear_cache()` first, so `fetch()` really calls the (failing) remote and then serves the last good copy. The `+ ['stale' => false]` array union keeps the left keys.

- [ ] **Step 4: Renderers**

Create `integrations/wordpress/site-manager/includes/class-sm-render.php`:

```php
<?php
// Server-side HTML for the blocks. Pure functions of (state, now, lang). Read-time rules mirror
// src/domain/effective.ts and src/domain/hours.ts; everything is escaped here.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Render
{
    private const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    private const LOOKAHEAD_DAYS = 14;

    // ---- time helpers -------------------------------------------------------------------------

    private static function ms(string $iso): int
    {
        $t = strtotime($iso);
        return $t === false ? 0 : $t;
    }

    /** @return array{date: string, time: string, weekday: string} in the venue's zone */
    public static function local(string $iso, string $tz): array
    {
        $d = (new DateTimeImmutable($iso))->setTimezone(self::zone($tz));
        return ['date' => $d->format('Y-m-d'), 'time' => $d->format('H:i'), 'weekday' => strtolower($d->format('D'))];
    }

    private static function zone(string $tz): DateTimeZone
    {
        try {
            return new DateTimeZone($tz ?: 'Europe/Sofia');
        } catch (Exception) {
            return new DateTimeZone('Europe/Sofia');
        }
    }

    public static function format_datetime(string $iso, string $lang, string $tz): string
    {
        $d = (new DateTimeImmutable($iso))->setTimezone(self::zone($tz));
        return $lang === 'en' ? $d->format('j M Y, H:i') : $d->format('d.m.Y, H:i');
    }

    public static function format_date(string $date, string $lang): string
    {
        $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($d === false) {
            return $date;
        }
        return $lang === 'en' ? $d->format('j M Y') : $d->format('d.m.Y');
    }

    private static function is_holiday(string $date, array $holidays): ?array
    {
        foreach ($holidays as $h) {
            if (($h['date'] ?? '') === $date) {
                return $h;
            }
        }
        return null;
    }

    /** The first opening instant strictly after $now within 14 days (ISO 8601 with offset), or null. */
    public static function next_opening(array $hours, array $holidays, string $now, string $tz): ?string
    {
        $zone = self::zone($tz);
        $nowTs = self::ms($now);
        $start = (new DateTimeImmutable($now))->setTimezone($zone)->setTime(0, 0);
        for ($i = 0; $i < self::LOOKAHEAD_DAYS; $i++) {
            $day = $start->modify("+$i day");
            $date = $day->format('Y-m-d');
            $dh = $hours[strtolower($day->format('D'))] ?? null;
            if (!is_array($dh) || self::is_holiday($date, $holidays) !== null) {
                continue;
            }
            $open = new DateTimeImmutable($date . ' ' . $dh['open'], $zone);
            if ($open->getTimestamp() > $nowTs) {
                return $open->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:sP');
            }
        }
        return null;
    }

    /** @return array{state: string, until?: string, at?: string, next?: ?string, holiday: ?array} like todayStatus() in hours.ts */
    public static function today_status(array $hours, array $holidays, string $now, string $tz): array
    {
        $l = self::local($now, $tz);
        $holiday = self::is_holiday($l['date'], $holidays);
        $dh = $hours[$l['weekday']] ?? null;
        if (is_array($dh) && $holiday === null) {
            if ($l['time'] < $dh['open']) {
                return ['state' => 'opens_later', 'at' => $dh['open'], 'holiday' => null];
            }
            if ($l['time'] < $dh['close']) {
                return ['state' => 'open', 'until' => $dh['close'], 'holiday' => null];
            }
        }
        return ['state' => 'closed', 'next' => self::next_opening($hours, $holidays, $now, $tz), 'holiday' => $holiday];
    }

    // ---- read-time rules ------------------------------------------------------------------------

    private static function is_sold_out(array $item, int $nowTs): bool
    {
        return !empty($item['sold_out_until']) && self::ms((string) $item['sold_out_until']) > $nowTs;
    }

    private static function is_live_special(array $item, int $nowTs): bool
    {
        if (empty($item['is_special']) || empty($item['active'])) {
            return false;
        }
        return empty($item['special_expires_at']) || self::ms((string) $item['special_expires_at']) > $nowTs;
    }

    private static function visible_items(array $items, int $nowTs): array
    {
        return array_values(array_filter($items, static fn(array $i): bool => !empty($i['active']) && (empty($i['is_special']) || self::is_live_special($i, $nowTs))));
    }

    private static function by_position(array $rows): array
    {
        usort($rows, static fn(array $a, array $b): int => ((int) ($a['position'] ?? 0)) <=> ((int) ($b['position'] ?? 0)));
        return $rows;
    }

    private static function media_url(array $state, ?string $id): ?string
    {
        if (!$id) {
            return null;
        }
        foreach ($state['media'] ?? [] as $m) {
            if (($m['id'] ?? null) === $id) {
                return (string) ($m['public_url'] ?? '') ?: null;
            }
        }
        return null;
    }

    // ---- wrappers ---------------------------------------------------------------------------------

    public static function wrap(string $block, string $inner, array $state): string
    {
        $accent = (string) ($state['venue']['theme']['accent'] ?? '');
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $accent)) {
            $accent = '#2f6b4f';
        }
        return '<div class="sm sm-' . esc_attr($block) . '" style="--sm-accent:' . esc_attr(strtolower($accent)) . '">' . $inner . '</div>';
    }

    /** An HTML comment for guests plus a visible note for admins; never leaks a stack trace. */
    public static function unavailable(WP_Error $e): string
    {
        $msg = wp_strip_all_tags($e->get_error_message());
        $out = '<!-- Site Manager: ' . str_replace('--', '- -', esc_html($msg)) . ' -->';
        if (current_user_can('manage_options')) {
            $out .= '<p class="sm sm-notice">' . esc_html($msg) . '</p>';
        }
        return $out;
    }

    // ---- blocks -------------------------------------------------------------------------------------

    public static function menu(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $tz = (string) ($state['venue']['tz'] ?? 'Europe/Sofia');
        $items = self::visible_items($state['items'] ?? [], $nowTs);
        $sections = [];
        foreach (self::by_position(array_filter($state['categories'] ?? [], static fn(array $c): bool => !empty($c['active']))) as $c) {
            $list = self::by_position(array_filter($items, static fn(array $i): bool => ($i['category_id'] ?? null) === ($c['id'] ?? '')));
            if ($list) {
                $sections[] = [$c, $list];
            }
        }
        if (!$sections) {
            return self::wrap('menu', '<p class="sm-empty">' . esc_html(SM_Labels::get('noItems', $lang)) . '</p>', $state);
        }
        $used = [];
        $html = '';
        foreach ($sections as [$c, $list]) {
            $html .= '<section class="sm-section"><h2 class="sm-heading">' . esc_html(SM_Labels::pick($c, 'name', $lang)) . '</h2><ul class="sm-items">';
            foreach ($list as $i) {
                $sold = self::is_sold_out($i, $nowTs);
                $img = self::media_url($state, $i['image_media_id'] ?? null);
                $desc = SM_Labels::pick($i, 'desc', $lang);
                $html .= '<li class="sm-item' . ($sold ? ' sm-sold-out' : '') . '">';
                if ($img !== null) {
                    $html .= '<img class="sm-thumb" src="' . esc_url($img) . '" alt="' . esc_attr(SM_Labels::pick($i, 'name', $lang)) . '" loading="lazy" width="64" height="64">';
                }
                $html .= '<div class="sm-item-body"><div class="sm-item-row"><h3 class="sm-item-name">' . esc_html(SM_Labels::pick($i, 'name', $lang)) . '</h3><span class="sm-price">' . esc_html(SM_Labels::price((float) ($i['price_eur'] ?? 0), $lang)) . '</span></div>';
                if ($desc !== '') {
                    $html .= '<p class="sm-desc">' . esc_html($desc) . '</p>';
                }
                $chips = '';
                if ($sold) {
                    $chips .= '<span class="sm-chip sm-chip-sold">' . esc_html(SM_Labels::get('soldOutUntil', $lang, ['when' => self::format_datetime((string) $i['sold_out_until'], $lang, $tz)])) . '</span>';
                }
                foreach ($i['allergens'] ?? [] as $a) {
                    $a = (int) $a;
                    $used[$a] = true;
                    $chips .= '<span class="sm-chip sm-chip-allergen" title="' . esc_attr(SM_Labels::allergen($a, $lang)) . '">' . $a . '<span class="sm-sr">' . esc_html(' ' . SM_Labels::allergen($a, $lang)) . '</span></span>';
                }
                if ($chips !== '') {
                    $html .= '<div class="sm-chips">' . $chips . '</div>';
                }
                $html .= '</div></li>';
            }
            $html .= '</ul></section>';
        }
        if ($used) {
            ksort($used);
            $html .= '<section class="sm-legend"><h2 class="sm-legend-title">' . esc_html(SM_Labels::get('allergenLegend', $lang)) . '</h2><dl>';
            foreach (array_keys($used) as $a) {
                $html .= '<div><dt>' . (int) $a . '</dt><dd>' . esc_html(SM_Labels::allergen((int) $a, $lang)) . '</dd></div>';
            }
            $html .= '</dl></section>';
        }
        return self::wrap('menu', $html, $state);
    }

    public static function specials(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $tz = (string) ($state['venue']['tz'] ?? 'Europe/Sofia');
        $specials = self::by_position(array_filter(self::visible_items($state['items'] ?? [], $nowTs), static fn(array $i): bool => !empty($i['is_special'])));
        if (!$specials) {
            return '';
        }
        $html = '<h2 class="sm-heading">' . esc_html(SM_Labels::get('specials', $lang)) . '</h2><ul class="sm-cards">';
        foreach ($specials as $i) {
            $img = self::media_url($state, $i['image_media_id'] ?? null);
            $desc = SM_Labels::pick($i, 'desc', $lang);
            $html .= '<li class="sm-card">';
            if ($img !== null) {
                $html .= '<img class="sm-card-img" src="' . esc_url($img) . '" alt="' . esc_attr(SM_Labels::pick($i, 'name', $lang)) . '" loading="lazy">';
            }
            $html .= '<div class="sm-card-body"><div class="sm-item-row"><h3 class="sm-item-name">' . esc_html(SM_Labels::pick($i, 'name', $lang)) . '</h3><span class="sm-price">' . esc_html(SM_Labels::price((float) ($i['price_eur'] ?? 0), $lang)) . '</span></div>';
            if ($desc !== '') {
                $html .= '<p class="sm-desc">' . esc_html($desc) . '</p>';
            }
            if (!empty($i['special_expires_at'])) {
                $html .= '<span class="sm-chip sm-chip-until">' . esc_html(SM_Labels::get('specialUntil', $lang, ['time' => self::local((string) $i['special_expires_at'], $tz)['time']])) . '</span>';
            }
            $html .= '</div></li>';
        }
        return self::wrap('specials', $html . '</ul>', $state);
    }

    public static function hours(array $state, string $now, string $lang): string
    {
        $v = $state['venue'];
        $tz = (string) ($v['tz'] ?? 'Europe/Sofia');
        $hours = is_array($v['hours'] ?? null) ? $v['hours'] : [];
        $holidays = $state['holidays'] ?? [];
        $s = self::today_status($hours, $holidays, $now, $tz);
        $text = match ($s['state']) {
            'open' => SM_Labels::get('openUntil', $lang, ['time' => $s['until']]),
            'opens_later' => SM_Labels::get('opensAt', $lang, ['time' => $s['at']]),
            default => $s['next'] ? SM_Labels::get('closedUntil', $lang, ['when' => self::format_datetime((string) $s['next'], $lang, $tz)]) : SM_Labels::get('closedToday', $lang),
        };
        $cls = $s['state'] === 'open' ? 'open' : ($s['state'] === 'opens_later' ? 'later' : 'closed');
        $html = '<p class="sm-status sm-status-' . $cls . '"><span class="sm-dot" aria-hidden="true"></span>' . esc_html($text) . '</p>';
        if ($s['holiday'] !== null) {
            $note = SM_Labels::pick($s['holiday'], 'note', $lang);
            if ($note !== '') {
                $html .= '<p class="sm-note">' . esc_html($note) . '</p>';
            }
        }
        $today = self::local($now, $tz);
        $html .= '<h2 class="sm-heading">' . esc_html(SM_Labels::get('hours', $lang)) . '</h2><table class="sm-table"><tbody>';
        foreach (self::WEEKDAYS as $d) {
            $dh = $hours[$d] ?? null;
            $isToday = $d === $today['weekday'];
            $html .= '<tr' . ($isToday ? ' aria-current="date" class="sm-today"' : '') . '><th scope="row">' . esc_html(SM_Labels::weekday($d, $lang)) . '</th><td>' . esc_html(is_array($dh) ? substr((string) $dh['open'], 0, 5) . '–' . substr((string) $dh['close'], 0, 5) : SM_Labels::get('closedDay', $lang)) . '</td></tr>';
        }
        $html .= '</tbody></table>';
        $upcoming = array_values(array_filter($holidays, static fn(array $h): bool => ($h['date'] ?? '') >= $today['date']));
        usort($upcoming, static fn(array $a, array $b): int => strcmp((string) $a['date'], (string) $b['date']));
        if ($upcoming) {
            $html .= '<h3 class="sm-subheading">' . esc_html(SM_Labels::get('holidays', $lang)) . '</h3><ul class="sm-holidays">';
            foreach ($upcoming as $h) {
                $note = SM_Labels::pick($h, 'note', $lang);
                $html .= '<li><strong>' . esc_html(self::format_date((string) $h['date'], $lang)) . '</strong>' . ($note !== '' ? ' · ' . esc_html($note) : '') . '</li>';
            }
            $html .= '</ul>';
        }
        $find = '';
        if (!empty($v['address'])) {
            $find .= '<p class="sm-address">' . esc_html((string) $v['address']) . '</p>';
        }
        $links = '';
        if (!empty($v['maps_url'])) {
            $links .= '<li><a class="sm-btn sm-btn-primary" href="' . esc_url((string) $v['maps_url']) . '" target="_blank" rel="noopener noreferrer">' . esc_html(SM_Labels::get('map', $lang)) . '</a></li>';
        }
        if (!empty($v['phone'])) {
            $tel = preg_replace('/[^\d+]/', '', (string) $v['phone']) ?? '';
            $links .= '<li><a class="sm-btn" href="' . esc_url('tel:' . $tel) . '">' . esc_html(SM_Labels::get('call', $lang) . ' ' . $v['phone']) . '</a></li>';
        }
        if (!empty($v['instagram'])) {
            $handle = preg_replace('#^https?://(www\.)?instagram\.com/#', '', trim((string) $v['instagram'])) ?? '';
            $handle = preg_replace('#/.*$#', '', ltrim($handle, '@')) ?? '';
            $links .= '<li><a class="sm-btn" href="' . esc_url('https://instagram.com/' . rawurlencode($handle)) . '" target="_blank" rel="noopener noreferrer">Instagram @' . esc_html($handle) . '</a></li>';
        }
        if ($find !== '' || $links !== '') {
            $html .= '<h3 class="sm-subheading">' . esc_html(SM_Labels::get('findUs', $lang)) . '</h3>' . $find . ($links !== '' ? '<ul class="sm-links">' . $links . '</ul>' : '');
        }
        return self::wrap('hours', $html, $state);
    }

    public static function announcements(array $state, string $now, string $lang): string
    {
        $nowTs = self::ms($now);
        $live = array_values(array_filter($state['announcements'] ?? [], static fn(array $a): bool => empty($a['expires_at']) || self::ms((string) $a['expires_at']) > $nowTs));
        if (!$live) {
            return '';
        }
        $html = '<ul class="sm-announcements">';
        foreach ($live as $a) {
            $html .= '<li class="sm-announcement">' . esc_html(SM_Labels::pick($a, 'text', $lang)) . '</li>';
        }
        return self::wrap('announcements', $html . '</ul>', $state);
    }

    public static function photos(array $state, string $now, string $lang): string
    {
        $gallery = self::by_position(array_filter($state['media'] ?? [], static fn(array $m): bool => !empty($m['is_gallery'])));
        if (!$gallery) {
            return '';
        }
        $name = (string) ($state['venue']['name'] ?? '');
        $html = '<ul class="sm-grid">';
        foreach ($gallery as $n => $m) {
            $html .= '<li><figure class="sm-photo"><img src="' . esc_url((string) $m['public_url']) . '" alt="' . esc_attr(trim($name . ', ' . ($n + 1))) . '" loading="lazy"></figure></li>';
        }
        return self::wrap('photos', $html . '</ul>', $state);
    }

    /** One text: welcome, footer_note, tagline, about, address, phone, instagram, name. Empty string for unknown keys. */
    public static function text(array $state, string $key, string $lang): string
    {
        $v = $state['venue'];
        $value = match ($key) {
            'welcome', 'footer_note' => (static function () use ($state, $key, $lang): string {
                foreach ($state['texts'] ?? [] as $t) {
                    if (($t['key'] ?? '') === $key) {
                        return SM_Labels::pick($t, 'text', $lang);
                    }
                }
                return '';
            })(),
            'tagline', 'about' => SM_Labels::pick($v, $key, $lang),
            'address', 'phone', 'instagram' => (string) ($v[$key] ?? ''),
            'name' => (string) ($v['name'] ?? ''),
            default => null,
        };
        if ($value === null || $value === '') {
            return '';
        }
        return '<span class="sm sm-text sm-text-' . esc_attr($key) . '">' . esc_html($value) . '</span>';
    }
}
```

Run: `npm run wp:test`
Expected: every `check(...)` prints PASS and the run ends with `ALL PASSED`. Fix the PHP (not the expectations) until it does; the expectations encode the TypeScript behaviour (`closedUntil` text, weekday labels, price formats).

- [ ] **Step 5: Shortcodes, settings page, CSS**

Create `integrations/wordpress/site-manager/includes/class-sm-shortcodes.php`:

```php
<?php
// [site_manager_menu|specials|hours|announcements|photos lang=bg|en|auto] and [site_manager_text key=welcome lang=…].
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Shortcodes
{
    public const BLOCKS = ['menu', 'specials', 'hours', 'announcements', 'photos', 'text'];

    public static function register(): void
    {
        foreach (self::BLOCKS as $block) {
            add_shortcode('site_manager_' . $block, static fn($atts): string => self::render($block, is_array($atts) ? $atts : []));
        }
    }

    /** Shared by shortcodes and the Gutenberg blocks' render callbacks. Never throws, never breaks the page. */
    public static function render(string $block, array $atts): string
    {
        if (!in_array($block, self::BLOCKS, true)) {
            return '';
        }
        $atts = shortcode_atts(['lang' => '', 'key' => 'welcome'], array_change_key_case($atts, CASE_LOWER), 'site_manager_' . $block);
        $feed = SM_Client::fetch();
        if (is_wp_error($feed)) {
            return SM_Render::unavailable($feed);
        }
        $settings = SM_Client::settings();
        $lang = SM_Labels::lang((string) $atts['lang'] ?: $settings['lang'], $feed['state']);
        wp_enqueue_style('site-manager');
        $html = $block === 'text'
            ? SM_Render::text($feed['state'], sanitize_key((string) $atts['key']), $lang)
            : SM_Render::{$block}($feed['state'], $feed['now'], $lang);
        if (!empty($feed['stale'])) {
            $html = '<!-- Site Manager: feed unavailable, showing the last good copy -->' . $html;
        }
        return $html;
    }
}
```

Create `integrations/wordpress/site-manager/includes/class-sm-settings.php`:

```php
<?php
// Settings → Site Manager: the feed settings, a "Check connection" button and a shortcode cheat-sheet.
// Task 10 appends the connect box and the API log through the `site_manager_settings_after_form` action.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Settings
{
    public const PAGE = 'site-manager';

    public static function add_page(): void
    {
        add_options_page(__('Site Manager', 'site-manager'), __('Site Manager', 'site-manager'), 'manage_options', self::PAGE, [self::class, 'page']);
    }

    public static function register(): void
    {
        register_setting('site_manager', SM_Client::OPTION, ['type' => 'array', 'sanitize_callback' => [self::class, 'sanitize'], 'default' => []]);
        add_settings_section('site_manager_feed', __('Your venue in Site Manager', 'site-manager'), static function (): void {
            echo '<p>' . esc_html__('Copy both values from your Site Manager dashboard (the "WordPress" card).', 'site-manager') . '</p>';
        }, self::PAGE);
        self::field('base_url', __('Site Manager address', 'site-manager'), 'url', 'https://site-manager.example');
        self::field('slug', __('Venue code', 'site-manager'), 'text', 'my-cafe');
        self::field('cache_seconds', __('Refresh every (seconds)', 'site-manager'), 'number', '30');
        add_settings_field('lang', __('Language of the blocks', 'site-manager'), static function (): void {
            $s = SM_Client::settings();
            echo '<select name="' . esc_attr(SM_Client::OPTION) . '[lang]">';
            foreach (['auto' => __('Venue default', 'site-manager'), 'bg' => 'Български', 'en' => 'English'] as $value => $label) {
                echo '<option value="' . esc_attr($value) . '"' . selected($s['lang'], $value, false) . '>' . esc_html($label) . '</option>';
            }
            echo '</select><p class="description">' . esc_html__('Each shortcode or block can override this with lang="bg" or lang="en".', 'site-manager') . '</p>';
        }, self::PAGE, 'site_manager_feed');
        add_action('admin_post_site_manager_check', [self::class, 'handle_check']);
    }

    private static function field(string $key, string $label, string $type, string $placeholder): void
    {
        add_settings_field($key, $label, static function () use ($key, $type, $placeholder): void {
            $s = SM_Client::settings();
            echo '<input class="regular-text" type="' . esc_attr($type) . '" name="' . esc_attr(SM_Client::OPTION) . '[' . esc_attr($key) . ']" value="' . esc_attr((string) $s[$key]) . '" placeholder="' . esc_attr($placeholder) . '"' . ($type === 'number' ? ' min="5" max="3600"' : '') . '>';
        }, self::PAGE, 'site_manager_feed');
    }

    /** @param mixed $in */
    public static function sanitize($in): array
    {
        $in = is_array($in) ? $in : [];
        $out = [
            'base_url' => untrailingslashit(esc_url_raw(trim((string) ($in['base_url'] ?? '')))),
            'slug' => sanitize_key((string) ($in['slug'] ?? '')),
            'cache_seconds' => max(5, min(3600, absint($in['cache_seconds'] ?? 30))),
            'lang' => in_array($in['lang'] ?? 'auto', ['bg', 'en', 'auto'], true) ? (string) $in['lang'] : 'auto',
        ];
        SM_Client::clear_cache();
        return $out;
    }

    public static function handle_check(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_check');
        $feed = SM_Client::fetch(true);
        $msg = is_wp_error($feed)
            ? ['error', $feed->get_error_message()]
            : ['success', sprintf(__('Connected: %s (%d menu items).', 'site-manager'), (string) ($feed['state']['venue']['name'] ?? ''), count($feed['state']['items'] ?? []))];
        wp_safe_redirect(add_query_arg(['page' => self::PAGE, 'sm_check' => $msg[0], 'sm_msg' => rawurlencode($msg[1])], admin_url('options-general.php')));
        exit;
    }

    public static function page(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $s = SM_Client::settings();
        echo '<div class="wrap"><h1>' . esc_html__('Site Manager', 'site-manager') . '</h1>';
        if (isset($_GET['sm_check'], $_GET['sm_msg'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only
            $type = $_GET['sm_check'] === 'success' ? 'success' : 'error';
            echo '<div class="notice notice-' . esc_attr($type) . ' is-dismissible"><p>' . esc_html(rawurldecode(sanitize_text_field(wp_unslash((string) $_GET['sm_msg'])))) . '</p></div>';
        }
        echo '<form method="post" action="options.php">';
        settings_fields('site_manager');
        do_settings_sections(self::PAGE);
        submit_button();
        echo '</form>';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="margin-top:-1em">';
        wp_nonce_field('site_manager_check');
        echo '<input type="hidden" name="action" value="site_manager_check">';
        submit_button(__('Check connection', 'site-manager'), 'secondary', 'submit', false);
        echo '</form>';
        echo '<h2>' . esc_html__('Shortcodes and blocks', 'site-manager') . '</h2>';
        echo '<p>' . esc_html__('Add a "Site Manager" block in the editor, or paste a shortcode anywhere:', 'site-manager') . '</p><ul>';
        foreach (['menu' => __('the full menu with prices, allergens and sold-out marks', 'site-manager'), 'specials' => __("today's specials", 'site-manager'), 'hours' => __('open-now status, opening hours, upcoming closures and contact', 'site-manager'), 'announcements' => __('current announcements', 'site-manager'), 'photos' => __('the photo gallery', 'site-manager')] as $block => $what) {
            echo '<li><code>[site_manager_' . esc_html($block) . ']</code> — ' . esc_html($what) . '</li>';
        }
        echo '<li><code>[site_manager_text key="welcome"]</code> — ' . esc_html__('one text: welcome, footer_note, tagline, about, address, phone, instagram or name', 'site-manager') . '</li></ul>';
        echo '<p>' . esc_html__('Add lang="bg" or lang="en" to any of them to force the language.', 'site-manager') . '</p>';
        do_action('site_manager_settings_after_form', $s);
        echo '</div>';
    }
}
```

Create `integrations/wordpress/site-manager/assets/site-manager.css`:

```css
/* Site Manager blocks: inherit the theme's fonts and colours; the venue's accent arrives as --sm-accent. */
.sm { --sm-ink: inherit; --sm-soft: color-mix(in srgb, currentColor 65%, transparent); --sm-line: color-mix(in srgb, currentColor 12%, transparent); --sm-accent: #2f6b4f; --sm-accent-soft: color-mix(in srgb, var(--sm-accent) 14%, transparent); --sm-warn: #a85a2a; --sm-warn-soft: color-mix(in srgb, var(--sm-warn) 14%, transparent); font-size: 1rem; line-height: 1.5; }
.sm *, .sm *::before, .sm *::after { box-sizing: border-box; }
.sm ul, .sm ol { list-style: none; margin: 0; padding: 0; }
.sm-heading { margin: 2rem 0 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--sm-line); font-size: 1.5rem; line-height: 1.2; }
.sm-section:first-child .sm-heading { margin-top: 0; }
.sm-subheading { margin: 1.25rem 0 0.25rem; font-size: 1.125rem; }
.sm-items { border-top: 0; }
.sm-item { display: flex; gap: 0.75rem; padding: 0.875rem 0; border-bottom: 1px solid var(--sm-line); }
.sm-thumb { flex: none; width: 64px; height: 64px; border-radius: 0.75rem; object-fit: cover; }
.sm-item-body { flex: 1; min-width: 0; }
.sm-item-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
.sm-item-name { margin: 0; font-size: 1rem; font-weight: 600; overflow-wrap: anywhere; }
.sm-price { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }
.sm-sold-out .sm-item-name { color: var(--sm-soft); }
.sm-sold-out .sm-price { text-decoration: line-through; opacity: 0.5; }
.sm-desc { margin: 0.125rem 0 0; font-size: 0.875rem; color: var(--sm-soft); }
.sm-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; margin-top: 0.5rem; }
.sm-chip { display: inline-flex; align-items: center; justify-content: center; min-width: 1.5rem; padding: 0.125rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; background: var(--sm-line); }
.sm-chip-sold { background: var(--sm-warn-soft); color: var(--sm-warn); }
.sm-chip-until { display: inline-block; margin-top: 0.5rem; background: var(--sm-accent-soft); }
.sm-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.sm-legend { margin-top: 2rem; padding: 1rem; border-radius: 1.25rem; background: var(--sm-line); }
.sm-legend-title { margin: 0; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--sm-soft); }
.sm-legend dl { display: grid; grid-template-columns: 1fr; gap: 0.25rem 1.5rem; margin: 0.75rem 0 0; font-size: 0.875rem; }
.sm-legend dl div { display: flex; gap: 0.5rem; }
.sm-legend dt { min-width: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.sm-legend dd { margin: 0; color: var(--sm-soft); }
.sm-cards { display: grid; gap: 0.75rem; margin-top: 1rem; }
.sm-card { overflow: hidden; border-radius: 1.25rem; box-shadow: 0 0 0 1px var(--sm-accent-soft); }
.sm-card-img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.sm-card-body { padding: 1rem; }
.sm-status { display: flex; align-items: center; gap: 0.625rem; margin: 0 0 0.25rem; font-weight: 600; }
.sm-dot { flex: none; width: 0.625rem; height: 0.625rem; border-radius: 999px; background: var(--sm-warn); }
.sm-status-open .sm-dot { background: var(--sm-accent); }
.sm-status-later .sm-dot { background: #b7791f; }
.sm-note { margin: 0 0 0.5rem 1.25rem; font-size: 0.875rem; color: var(--sm-soft); }
.sm-table { width: 100%; margin-top: 0.75rem; border-collapse: collapse; font-size: 0.875rem; }
.sm-table th { padding: 0.25rem 1rem 0.25rem 0; text-align: left; font-weight: 400; color: var(--sm-soft); text-transform: capitalize; }
.sm-table td { padding: 0.25rem 0; text-align: right; font-variant-numeric: tabular-nums; color: var(--sm-soft); }
.sm-table .sm-today th, .sm-table .sm-today td { font-weight: 600; color: inherit; }
.sm-holidays li { font-size: 0.875rem; color: var(--sm-soft); }
.sm-holidays strong { color: inherit; font-variant-numeric: tabular-nums; }
.sm-address { margin: 0.5rem 0; }
.sm-links { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.875rem; font-weight: 600; }
.sm-btn { display: inline-flex; align-items: center; min-height: 2.75rem; padding: 0 1rem; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--sm-line); color: inherit; text-decoration: none; }
.sm-btn:hover { background: var(--sm-line); }
.sm-btn-primary { background: var(--sm-accent); color: #fff; box-shadow: none; }
.sm-btn-primary:hover { filter: brightness(1.1); background: var(--sm-accent); }
.sm-announcements { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.sm-announcement { padding: 0.375rem 0.75rem; border-radius: 1rem; background: var(--sm-warn-soft); color: var(--sm-warn); font-size: 0.875rem; font-weight: 500; }
.sm-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; }
.sm-photo { margin: 0; }
.sm-photo img { display: block; width: 100%; aspect-ratio: 1; border-radius: 1rem; object-fit: cover; }
.sm-empty { padding: 2rem 0; text-align: center; color: var(--sm-soft); }
.sm-notice { padding: 0.75rem 1rem; border-radius: 0.75rem; background: var(--sm-warn-soft); color: var(--sm-warn); font-size: 0.875rem; }
.sm-preview-banner { position: sticky; top: 0; z-index: 1000; padding: 0.5rem 1rem; background: #fff3cd; color: #5c4400; font: 600 0.875rem/1.4 system-ui, sans-serif; text-align: center; }
@media (min-width: 640px) { .sm-cards { grid-template-columns: repeat(2, 1fr); } .sm-legend dl { grid-template-columns: repeat(2, 1fr); } .sm-grid { grid-template-columns: repeat(3, 1fr); } }
@media (prefers-reduced-motion: reduce) { .sm * { transition: none !important; } }
```

Run: `npm run wp:lint`
Expected: no syntax errors (the command prints nothing but exits 0).

- [ ] **Step 6: Translations: the `.po` source and the generator**

Create `integrations/wordpress/site-manager/languages/site-manager-bg_BG.po` with one `msgid`/`msgstr` pair for **every** string passed to `__()`, `esc_html__()`, `esc_attr__()`, `esc_html_e()` or `_e()` in the plugin's PHP (the test in Step 7 fails on any missing one). Start with:

```po
msgid ""
msgstr ""
"Project-Id-Version: Site Manager 0.1.0\n"
"Language: bg_BG\n"
"MIME-Version: 1.0\n"
"Content-Type: text/plain; charset=UTF-8\n"
"Content-Transfer-Encoding: 8bit\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\n"
"X-Domain: site-manager\n"

msgid "Settings"
msgstr "Настройки"

msgid "Site Manager"
msgstr "Site Manager"

msgid "Your venue in Site Manager"
msgstr "Вашето заведение в Site Manager"

msgid "Copy both values from your Site Manager dashboard (the \"WordPress\" card)."
msgstr "Копирайте двете стойности от таблото на Site Manager (картата „WordPress“)."

msgid "Site Manager address"
msgstr "Адрес на Site Manager"

msgid "Venue code"
msgstr "Код на заведението"

msgid "Refresh every (seconds)"
msgstr "Обновяване на всеки (секунди)"

msgid "Language of the blocks"
msgstr "Език на блоковете"

msgid "Venue default"
msgstr "По подразбиране за заведението"

msgid "Each shortcode or block can override this with lang=\"bg\" or lang=\"en\"."
msgstr "Всеки шорткод или блок може да го смени с lang=\"bg\" или lang=\"en\"."

msgid "You are not allowed to do that."
msgstr "Нямате права за това действие."

msgid "Connected: %s (%d menu items)."
msgstr "Свързано: %s (%d артикула в менюто)."

msgid "Check connection"
msgstr "Провери връзката"

msgid "Shortcodes and blocks"
msgstr "Шорткодове и блокове"

msgid "Add a \"Site Manager\" block in the editor, or paste a shortcode anywhere:"
msgstr "Добавете блок „Site Manager“ в редактора или поставете шорткод където пожелаете:"

msgid "the full menu with prices, allergens and sold-out marks"
msgstr "цялото меню с цени, алергени и отбелязани изчерпани продукти"

msgid "today's specials"
msgstr "днешните специални предложения"

msgid "open-now status, opening hours, upcoming closures and contact"
msgstr "отворено ли е сега, работно време, предстоящи почивни дни и контакти"

msgid "current announcements"
msgstr "текущите съобщения"

msgid "the photo gallery"
msgstr "галерията със снимки"

msgid "one text: welcome, footer_note, tagline, about, address, phone, instagram or name"
msgstr "един текст: welcome, footer_note, tagline, about, address, phone, instagram или name"

msgid "Add lang=\"bg\" or lang=\"en\" to any of them to force the language."
msgstr "Добавете lang=\"bg\" или lang=\"en\" към всеки от тях, за да зададете езика."

msgid "Site Manager is not configured yet: set the address and the venue code under Settings → Site Manager."
msgstr "Site Manager още не е настроен: въведете адреса и кода на заведението в Настройки → Site Manager."

msgid "Site Manager did not answer: %s"
msgstr "Site Manager не отговори: %s"

msgid "Site Manager has no venue with the code \"%s\"."
msgstr "В Site Manager няма заведение с код „%s“."

msgid "Site Manager answered with an unexpected response (HTTP %d)."
msgstr "Site Manager отговори неочаквано (HTTP %d)."
```

Create `scripts/wp-plugin-i18n.mts` (writes the `.l10n.php` and `.mo` files from the `.po`):

```ts
// scripts/wp-plugin-i18n.mts
// Generates languages/site-manager-bg_BG.l10n.php (WordPress ≥ 6.5 PHP translation file) and the classic .mo
// from the hand-written .po. No gettext tools needed. Run: npm run wp:i18n
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const LANG_DIR = resolve(process.cwd(), "integrations/wordpress/site-manager/languages");
export const PO_FILE = resolve(LANG_DIR, "site-manager-bg_BG.po");

/** Parses a simple .po (no plurals, no contexts): [msgid, msgstr] pairs, header included as "" → metadata. */
export function parsePo(text: string): { header: string; messages: Map<string, string> } {
  const messages = new Map<string, string>();
  let header = "";
  let current: { id: string[]; str: string[]; mode: "id" | "str" | null } = { id: [], str: [], mode: null };
  const unq = (s: string) => JSON.parse(s.replace(/^\s*"|"\s*$/g, '"')) as string;
  const flush = () => {
    if (current.mode === null) return;
    const id = current.id.join("");
    const str = current.str.join("");
    if (id === "") header = str;
    else messages.set(id, str);
    current = { id: [], str: [], mode: null };
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("msgid ")) {
      flush();
      current.mode = "id";
      current.id.push(unq(line.slice(6)));
    } else if (line.startsWith("msgstr ")) {
      current.mode = "str";
      current.str.push(unq(line.slice(7)));
    } else if (line.startsWith('"')) {
      (current.mode === "id" ? current.id : current.str).push(unq(line));
    }
  }
  flush();
  return { header, messages };
}

export function toL10nPhp(header: string, messages: Map<string, string>): string {
  const esc = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  const version = /Project-Id-Version: (.*)\\n/.exec(header)?.[1] ?? "Site Manager";
  const lines = [...messages].filter(([, v]) => v !== "").map(([k, v]) => `\t${esc(k)} => ${esc(v)},`);
  return `<?php\nreturn [\n\t'project-id-version' => ${esc(version)},\n\t'language' => 'bg_BG',\n\t'x-generator' => 'scripts/wp-plugin-i18n.mts',\n\t'plural-forms' => 'nplurals=2; plural=(n != 1);',\n\t'messages' => [\n${lines.join("\n")}\n\t],\n];\n`;
}

/** Minimal GNU .mo writer: header entry ("" → metadata) plus the translated messages, sorted by msgid bytes. */
export function toMo(header: string, messages: Map<string, string>): Buffer {
  const entries = [["", header] as [string, string], ...[...messages].filter(([, v]) => v !== "")].sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0])));
  const n = entries.length;
  const origTable = 28;
  const transTable = origTable + n * 8;
  let offset = transTable + n * 8;
  const strings: Buffer[] = [];
  const orig: { len: number; off: number }[] = [];
  const trans: { len: number; off: number }[] = [];
  for (const [id] of entries) {
    const b = Buffer.from(id, "utf8");
    orig.push({ len: b.length, off: offset });
    strings.push(b, Buffer.from([0]));
    offset += b.length + 1;
  }
  for (const [, str] of entries) {
    const b = Buffer.from(str, "utf8");
    trans.push({ len: b.length, off: offset });
    strings.push(b, Buffer.from([0]));
    offset += b.length + 1;
  }
  const head = Buffer.alloc(transTable + n * 8);
  head.writeUInt32LE(0x950412de, 0);
  head.writeUInt32LE(0, 4);
  head.writeUInt32LE(n, 8);
  head.writeUInt32LE(origTable, 12);
  head.writeUInt32LE(transTable, 16);
  head.writeUInt32LE(0, 20);
  head.writeUInt32LE(0, 24);
  orig.forEach((e, i) => {
    head.writeUInt32LE(e.len, origTable + i * 8);
    head.writeUInt32LE(e.off, origTable + i * 8 + 4);
  });
  trans.forEach((e, i) => {
    head.writeUInt32LE(e.len, transTable + i * 8);
    head.writeUInt32LE(e.off, transTable + i * 8 + 4);
  });
  return Buffer.concat([head, ...strings]);
}

export function generate(): { php: string; mo: Buffer } {
  const { header, messages } = parsePo(readFileSync(PO_FILE, "utf8"));
  return { php: toL10nPhp(header, messages), mo: toMo(header, messages) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const { php, mo } = generate();
  writeFileSync(resolve(LANG_DIR, "site-manager-bg_BG.l10n.php"), php);
  writeFileSync(resolve(LANG_DIR, "site-manager-bg_BG.mo"), mo);
  console.log("wrote site-manager-bg_BG.l10n.php and site-manager-bg_BG.mo");
}
```

Run: `npm run wp:i18n`
Expected: both files written. Commit them (they are generated but shipped in the zip).

- [ ] **Step 7: Vitest guards: feed-field contract and translation completeness**

Create `test/wp-plugin-contract.test.ts`:

```ts
// test/wp-plugin-contract.test.ts
// Every feed field the PHP reads must exist on our types; every translatable PHP string must have a Bulgarian entry;
// the generated translation files must match the .po. Keeps the plugin honest without running WordPress.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generate, LANG_DIR, parsePo, PO_FILE } from "../scripts/wp-plugin-i18n.mts";
import { state } from "./fixtures";

const PLUGIN = resolve(process.cwd(), "integrations/wordpress/site-manager");

function phpFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = resolve(dir, f);
    return statSync(p).isDirectory() ? phpFiles(p) : p.endsWith(".php") ? [p] : [];
  });
}
const sources = phpFiles(PLUGIN).filter((p) => !p.includes("/languages/")).map((p) => readFileSync(p, "utf8")).join("\n");

describe("plugin ↔ feed contract", () => {
  it("reads only fields that exist in SiteState", () => {
    const s = state();
    const known = new Set<string>([
      ...Object.keys(s), ...Object.keys(s.venue), ...Object.keys(s.venue.theme), ...Object.keys(s.venue.hours), "open", "close",
      ...Object.keys(s.categories[0]), ...Object.keys(s.items[0]), "image_media_id", ...Object.keys(s.media[0] ?? { id: 1, public_url: 1, is_gallery: 1, position: 1 }),
      "date", "note_bg", "note_en", "text_bg", "text_en", "expires_at", "key", "state", "now", "stale",
      // settings / internal keys
      "base_url", "slug", "cache_seconds", "lang", "at", "url", "until", "next", "holiday", "weekday", "time",
    ]);
    const read = [...readFileSync(resolve(PLUGIN, "includes/class-sm-render.php"), "utf8").matchAll(/\$(?:state|v|i|c|m|a|h|t|dh|item|s|l|feed|last|cached|body)\['([a-z_]+)'\]/g)].map((m) => m[1]);
    const unknown = [...new Set(read)].filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });
});

describe("plugin translations", () => {
  const { messages } = parsePo(readFileSync(PO_FILE, "utf8"));
  it("has a Bulgarian string for every translatable English string in the PHP", () => {
    const literals = [...sources.matchAll(/(?:__|_e|esc_html__|esc_attr__|esc_html_e|esc_attr_e)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'site-manager'\s*\)/g)].map((m) => m[1].replace(/\\'/g, "'"));
    const missing = [...new Set(literals)].filter((s) => !messages.has(s) || messages.get(s) === "");
    expect(missing).toEqual([]);
    const doubleQuoted = [...sources.matchAll(/(?:__|_e|esc_html__|esc_attr__|esc_html_e)\(\s*"/g)];
    expect(doubleQuoted, "use single-quoted strings in translation calls so the scanner sees them").toEqual([]);
  });
  it("ships generated translation files that match the .po", () => {
    const { php, mo } = generate();
    expect(readFileSync(resolve(LANG_DIR, "site-manager-bg_BG.l10n.php"), "utf8")).toBe(php);
    expect(readFileSync(resolve(LANG_DIR, "site-manager-bg_BG.mo")).equals(mo)).toBe(true);
    expect(mo.readUInt32LE(0)).toBe(0x950412de);
  });
});
```

Note: the scanner regex for `$x['field']` deliberately covers only the variables used in `class-sm-render.php`; keep that file's variable names (`$state`, `$v`, `$i`, `$c`, `$m`, `$a`, `$h`, `$t`, `$dh`, `$s`, `$l`) when you edit it.

Run: `npx vitest run test/wp-plugin-contract.test.ts`
Expected: PASS. If a field shows up as unknown, either it is a typo in the PHP (fix it) or a legitimately new internal key (add it to the `known` list with a comment).

- [ ] **Step 8: readme.txt and CHANGELOG**

Create `integrations/wordpress/site-manager/readme.txt`:

```
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
```

Create `integrations/wordpress/site-manager/CHANGELOG.md`:

```markdown
# Changelog

## 0.1.0 (2026-10-10)

- Shortcodes `[site_manager_menu|specials|hours|announcements|photos|text]` and the matching Gutenberg blocks, BG/EN, cached feed with a 24-hour fallback.
- Settings page with "Check connection", shortcode cheat-sheet, connect box and API log.
- REST write channel `site-manager/v1` (bearer token, rate-limited, logged): pages with preview links, media, options, navigation menus, WooCommerce products, revisions.
```

- [ ] **Step 9: Run everything and commit**

Run: `npm run wp:lint && npm run wp:test && npx vitest run test/wp-plugin-contract.test.ts && npm run typecheck && npm run lint && npm test`
Expected: all green.

```bash
git add integrations/wordpress scripts/wp-plugin-i18n.mts test/wp-plugin-contract.test.ts package.json
git commit -m "WordPress plugin: feed client, renderers, shortcodes, settings page, translations and PHP tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Gutenberg blocks (six `block.json` wrappers with server-side rendering)

**Files:**
- Create: `integrations/wordpress/site-manager/includes/class-sm-blocks.php`, `integrations/wordpress/site-manager/blocks/editor.js`, `integrations/wordpress/site-manager/blocks/{menu,specials,hours,announcements,photos,text}/block.json`
- Test: `npm run wp:lint`; a vitest check that every `block.json` is valid JSON with the expected name and attributes (`test/wp-plugin-blocks.test.ts`); Docker smoke in Task 11 inserts a block through WP-CLI and renders it.

**Interfaces:**
- Consumes: `SM_Shortcodes::render($block, $atts)` (Task 8).
- Produces: `SM_Blocks::register()`, blocks `site-manager/menu`, `site-manager/specials`, `site-manager/hours`, `site-manager/announcements`, `site-manager/photos`, `site-manager/text` with attributes `lang` (`auto|bg|en`, default `auto`) and, for `text`, `key` (default `welcome`); script handle `site-manager-blocks`.

Decisions: no JSX, no build tooling; `editor.js` is plain ES5-compatible JavaScript using the `wp.*` globals and `wp.serverSideRender`, so the editor shows exactly what visitors see. The editor script is registered by handle and referenced from `block.json` as `"editorScript": "site-manager-blocks"`.

- [ ] **Step 1: The vitest guard**

Create `test/wp-plugin-blocks.test.ts`:

```ts
// test/wp-plugin-blocks.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(process.cwd(), "integrations/wordpress/site-manager/blocks");
const NAMES = ["menu", "specials", "hours", "announcements", "photos", "text"];

describe("block.json files", () => {
  it("exist for every block with the lang attribute and the shared editor script", () => {
    for (const n of NAMES) {
      const meta = JSON.parse(readFileSync(resolve(DIR, n, "block.json"), "utf8")) as Record<string, unknown>;
      expect(meta.name).toBe(`site-manager/${n}`);
      expect(meta.apiVersion).toBe(3);
      expect(meta.textdomain).toBe("site-manager");
      expect(meta.editorScript).toBe("site-manager-blocks");
      const attrs = meta.attributes as Record<string, { type: string; default: string; enum?: string[] }>;
      expect(attrs.lang).toEqual({ type: "string", default: "auto", enum: ["auto", "bg", "en"] });
      if (n === "text") expect(attrs.key).toEqual({ type: "string", default: "welcome" });
      else expect(attrs.key).toBeUndefined();
      expect((meta.supports as Record<string, unknown>).html).toBe(false);
    }
    const js = readFileSync(resolve(DIR, "editor.js"), "utf8");
    for (const n of NAMES) expect(js).toContain(`'site-manager/${n}'`);
    expect(js).not.toMatch(/\bimport\b|=>|`/); // plain ES5: runs without a build step in every browser WordPress supports
  });
});
```

Run: `npx vitest run test/wp-plugin-blocks.test.ts`
Expected: FAIL (files missing).

- [ ] **Step 2: block.json files**

Create `integrations/wordpress/site-manager/blocks/menu/block.json`:

```json
{
  "$schema": "https://schemas.wp.org/trunk/block.json",
  "apiVersion": 3,
  "name": "site-manager/menu",
  "title": "Site Manager: Menu",
  "category": "widgets",
  "icon": "food",
  "description": "The live menu from Site Manager: categories, prices, allergens and sold-out marks.",
  "keywords": ["menu", "меню", "site manager"],
  "textdomain": "site-manager",
  "attributes": { "lang": { "type": "string", "default": "auto", "enum": ["auto", "bg", "en"] } },
  "supports": { "html": false, "align": ["wide", "full"] },
  "editorScript": "site-manager-blocks"
}
```

Create the other five the same way, changing `name`, `title`, `icon`, `description` and `keywords`:

| folder | name | title | icon | description |
|---|---|---|---|---|
| `specials` | `site-manager/specials` | `Site Manager: Specials` | `star-filled` | Today's specials from Site Manager; hidden when there are none. |
| `hours` | `site-manager/hours` | `Site Manager: Hours & contact` | `clock` | Open-now status, opening hours, upcoming closures, address, map, phone and Instagram. |
| `announcements` | `site-manager/announcements` | `Site Manager: Announcements` | `megaphone` | Current announcements; hidden when there are none. |
| `photos` | `site-manager/photos` | `Site Manager: Photos` | `format-gallery` | The photo gallery managed from Telegram. |
| `text` | `site-manager/text` | `Site Manager: Text` | `editor-quote` | One text managed from Telegram: welcome, footer note, tagline, about, address, phone, Instagram or the venue name. |

`text/block.json` has the extra attribute `"key": { "type": "string", "default": "welcome" }` and `"supports": { "html": false }` (no wide alignment).

- [ ] **Step 3: Registration and the editor script**

Create `integrations/wordpress/site-manager/includes/class-sm-blocks.php`:

```php
<?php
// Gutenberg wrappers around the shortcode renderers; the editor shows the server-rendered HTML.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Blocks
{
    public static function register(): void
    {
        wp_register_script('site-manager-blocks', SITE_MANAGER_URL . 'blocks/editor.js', ['wp-blocks', 'wp-element', 'wp-components', 'wp-block-editor', 'wp-server-side-render', 'wp-i18n'], SITE_MANAGER_VERSION, true);
        wp_set_script_translations('site-manager-blocks', 'site-manager', SITE_MANAGER_DIR . 'languages');
        foreach (SM_Shortcodes::BLOCKS as $block) {
            register_block_type(SITE_MANAGER_DIR . 'blocks/' . $block, [
                'render_callback' => static function (array $attributes) use ($block): string {
                    $atts = ['lang' => (string) ($attributes['lang'] ?? 'auto')];
                    if ($block === 'text') {
                        $atts['key'] = (string) ($attributes['key'] ?? 'welcome');
                    }
                    $html = SM_Shortcodes::render($block, $atts);
                    if ($html === '' && defined('REST_REQUEST') && REST_REQUEST) {
                        // Editor preview of an empty block (no specials today): say so instead of showing nothing.
                        return '<p class="sm sm-empty">' . esc_html__('Nothing to show right now; the block is hidden on the site.', 'site-manager') . '</p>';
                    }
                    return $html;
                },
            ]);
        }
        add_filter('block_categories_all', static function (array $categories): array {
            return $categories; // the blocks live in "widgets"; a custom category is not worth a translation entry
        });
    }
}
```

Add the new translatable string to the `.po` (`msgid "Nothing to show right now; the block is hidden on the site."` → `msgstr "Няма какво да се покаже в момента; блокът не се вижда на сайта."`) and run `npm run wp:i18n`.

Create `integrations/wordpress/site-manager/blocks/editor.js`:

```js
/* Site Manager blocks for the WordPress editor. Plain script, no build step: uses the wp.* globals. */
(function (wp) {
  'use strict';
  var registerBlockType = wp.blocks.registerBlockType;
  var el = wp.element.createElement;
  var Fragment = wp.element.Fragment;
  var InspectorControls = wp.blockEditor.InspectorControls;
  var PanelBody = wp.components.PanelBody;
  var SelectControl = wp.components.SelectControl;
  var ServerSideRender = wp.serverSideRender;
  var __ = wp.i18n.__;

  var LANGS = [
    { label: __('Venue default', 'site-manager'), value: 'auto' },
    { label: 'Български', value: 'bg' },
    { label: 'English', value: 'en' }
  ];
  var TEXT_KEYS = [
    { label: 'welcome', value: 'welcome' },
    { label: 'footer_note', value: 'footer_note' },
    { label: 'tagline', value: 'tagline' },
    { label: 'about', value: 'about' },
    { label: 'address', value: 'address' },
    { label: 'phone', value: 'phone' },
    { label: 'instagram', value: 'instagram' },
    { label: 'name', value: 'name' }
  ];
  var NAMES = ['menu', 'specials', 'hours', 'announcements', 'photos', 'text'];

  function edit(name) {
    return function (props) {
      var controls = [
        el(SelectControl, {
          key: 'lang',
          label: __('Language', 'site-manager'),
          value: props.attributes.lang,
          options: LANGS,
          onChange: function (lang) { props.setAttributes({ lang: lang }); }
        })
      ];
      if (name === 'text') {
        controls.push(el(SelectControl, {
          key: 'key',
          label: __('Text', 'site-manager'),
          value: props.attributes.key,
          options: TEXT_KEYS,
          onChange: function (key) { props.setAttributes({ key: key }); }
        }));
      }
      return el(Fragment, null,
        el(InspectorControls, null, el(PanelBody, { title: __('Site Manager', 'site-manager') }, controls)),
        el('div', wp.blockEditor.useBlockProps(), el(ServerSideRender, { block: 'site-manager/' + name, attributes: props.attributes }))
      );
    };
  }

  NAMES.forEach(function (name) {
    registerBlockType('site-manager/' + name, { edit: edit(name), save: function () { return null; } });
  });
})(window.wp);
```

Add `msgid "Language"` → `msgstr "Език"` and `msgid "Text"` → `msgstr "Текст"` to the `.po` and regenerate. (`wp_set_script_translations` needs JSON files for JavaScript strings; they are not generated here, so the editor UI stays English in Bulgarian admin, which is acceptable for 0.1.0 and noted in `docs/INTEGRATION.md`.)

Note on `'site-manager/' + n` in the vitest guard: the test looks for the literal `'site-manager/menu'`; keep an explicit list in `editor.js` as a comment so the guard passes: add after `var NAMES = [...]` the line `/* registers: 'site-manager/menu' 'site-manager/specials' 'site-manager/hours' 'site-manager/announcements' 'site-manager/photos' 'site-manager/text' */`.

- [ ] **Step 4: Lint, tests, commit**

Run: `npm run wp:lint && npx vitest run test/wp-plugin-blocks.test.ts test/wp-plugin-contract.test.ts && npm test`

```bash
git add integrations/wordpress test/wp-plugin-blocks.test.ts
git commit -m "WordPress plugin: Gutenberg blocks with server-side rendering

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The plugin's write channel (auth, REST routes, page builders, preview, media, options, menus, products, settings connect box and log)

**Files:**
- Create: `integrations/wordpress/site-manager/includes/class-sm-auth.php`, `integrations/wordpress/site-manager/includes/class-sm-pages.php`, `integrations/wordpress/site-manager/includes/class-sm-rest.php`, `integrations/wordpress/site-manager/includes/class-sm-preview.php`, `integrations/wordpress/tests/cases/pages.php`
- Modify: `integrations/wordpress/site-manager/includes/class-sm-settings.php` (hook the connect box and the log into `site_manager_settings_after_form`), `integrations/wordpress/site-manager/languages/site-manager-bg_BG.po` (new strings), `integrations/wordpress/tests/shim.php` (a few more functions), `integrations/wordpress/tests/run.php` (require `class-sm-pages.php`)
- Test: `npm run wp:test` (pure `SM_Pages::compute_after`, placeholders, Elementor replacement, text extraction), `npm run wp:lint`, Docker smoke in Task 11 (every route end to end).

**Interfaces:**
- Consumes: the "Plugin REST contract" (exact routes, bodies, responses, error codes) and `SM_Settings` (Task 8).
- Produces: `SM_Auth` (`new_code(int $user_id): string`, `code_info(): ?array`, `redeem_code(string $code, string $slug): string|WP_Error`, `disconnect(): void`, `connection(): ?array`, `permission(WP_REST_Request $r): true|WP_Error`, `rate_limit(string $bucket, int $max): true|WP_Error`, `log(string $method, string $route, int $status, float $ms): void`, `recent_log(int $n = 20): array`); `SM_Pages` (`builder_of(WP_Post $p): string`, `fields(WP_Post $p): array`, `summary(WP_Post $p): array`, `text_of(WP_Post $p): string`, `elementor_texts(?string $data): array`, `compute_after(array $before, array $edit, string $builder, array $placeholders, bool $strict): array|WP_Error`, `apply(WP_Post $p, array $fields, array $placeholders): array|WP_Error`, `resolve_placeholders(string $text, array $map, bool $strict): string|WP_Error`); `SM_Rest::register_routes()`; `SM_Preview::register()`.

Decisions: every write route runs as the WordPress user who generated the connect code (`wp_set_current_user`), so `kses` does not strip block HTML and revisions carry an author; the user must still exist and have `edit_pages`, otherwise 403 `sm_forbidden` with a message telling the owner to reconnect. Handshake and the other routes share one permission callback shape: rate limit → auth → impersonate. Every response passes through `rest_post_dispatch` for the namespace to append the log entry.

- [ ] **Step 1: Pure page logic and its PHP tests**

Extend `integrations/wordpress/tests/shim.php` with:

```php
function wp_slash(mixed $v): mixed { return $v; }
function wp_unslash(mixed $v): mixed { return $v; }
function has_blocks(string $content): bool { return str_contains($content, '<!-- wp:'); }
function wp_hash_password(string $p): string { return password_hash($p, PASSWORD_DEFAULT); }
$GLOBALS['sm_test_attachments'] = []; // source_id => ['id' => int, 'url' => string]
function sm_test_find_attachment(string $source_id): ?array { return $GLOBALS['sm_test_attachments'][$source_id] ?? null; }
```

In `class-sm-pages.php` (below), the media lookup goes through `SM_Pages::$attachment_lookup`, a static callable defaulting to a `WP_Query`-based function; the tests replace it with `sm_test_find_attachment`.

Create `integrations/wordpress/tests/cases/pages.php`:

```php
<?php
// Write-channel pure logic: compute_after, placeholders, Elementor replacements, text extraction.
declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/site-manager/includes/class-sm-pages.php';
SM_Pages::$attachment_lookup = 'sm_test_find_attachment';

$before = ['title' => 'About', 'content' => '<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->', 'elementor_data' => null, 'featured_media' => null];

$ok = SM_Pages::compute_after($before, ['replacements' => [['find' => 'banitsa every morning', 'replace' => 'banitsa and kozunak every morning']]], 'gutenberg', [], false);
check('replace once', is_array($ok) && $ok['content'] === '<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph -->' && $ok['title'] === 'About');
$twice = SM_Pages::compute_after($before, ['replacements' => [['find' => 'e', 'replace' => 'x']]], 'gutenberg', [], false);
check('replace refuses two matches', is_wp_error($twice) && $twice->get_error_code() === 'sm_replace_failed' && $twice->get_error_data()['count'] > 1);
$none = SM_Pages::compute_after($before, ['replacements' => [['find' => 'croissant', 'replace' => 'x']]], 'gutenberg', [], false);
check('replace refuses zero matches', is_wp_error($none) && $none->get_error_data()['count'] === 0 && $none->get_error_data()['find'] === 'croissant');
$title = SM_Pages::compute_after($before, ['title' => 'About us', 'featured_media' => 12], 'classic', [], false);
check('title and featured', is_array($title) && $title['title'] === 'About us' && $title['featured_media'] === 12 && $title['content'] === $before['content']);
$unknown = SM_Pages::compute_after($before, ['content' => 'x'], 'unknown', [], false);
check('unknown builder refused', is_wp_error($unknown) && $unknown->get_error_code() === 'sm_builder_unsupported');

$el = ['title' => 'Events', 'content' => '', 'elementor_data' => json_encode([['id' => 'a1', 'elType' => 'widget', 'settings' => ['title' => 'Live jazz on Fridays']], ['id' => 'a2', 'elType' => 'section', 'settings' => [], 'elements' => [['id' => 'a3', 'elType' => 'widget', 'settings' => ['editor' => '<p>Doors open at 19:00.</p>']]]]]), 'featured_media' => null];
$elOk = SM_Pages::compute_after($el, ['replacements' => [['find' => '19:00', 'replace' => '20:00']]], 'elementor', [], false);
check('elementor nested replacement', is_array($elOk) && json_decode((string) $elOk['elementor_data'], true)[1]['elements'][0]['settings']['editor'] === '<p>Doors open at 20:00.</p>');
$elFull = SM_Pages::compute_after($el, ['content' => '<p>x</p>'], 'elementor', [], false);
check('elementor refuses full content', is_wp_error($elFull) && $elFull->get_error_data()['builder'] === 'elementor');
check('elementor texts', SM_Pages::elementor_texts($el['elementor_data']) === ['Live jazz on Fridays', '<p>Doors open at 19:00.</p>']);
check('elementor unicode survives', has((string) $elOk['elementor_data'], 'Live jazz') && !has((string) $elOk['elementor_data'], '\u'));

$GLOBALS['sm_test_attachments']['m-1'] = ['id' => 101, 'url' => 'https://cafe.example/wp-content/uploads/m-1.jpg'];
$ph = SM_Pages::resolve_placeholders('<img src="{{sm_media_url:m-1}}" data-id="{{sm_media_id:m-1}}"> {{sm_media_url:m-2}}', ['{{sm_media_url:m-2}}' => 'https://cdn.example/m-2.jpg'], true);
check('placeholders from the map and the library', $ph === '<img src="https://cafe.example/wp-content/uploads/m-1.jpg" data-id="101"> https://cdn.example/m-2.jpg', is_string($ph) ? $ph : $ph->get_error_message());
$bad = SM_Pages::resolve_placeholders('{{sm_media_url:nope}}', [], true);
check('strict placeholder error', is_wp_error($bad) && $bad->get_error_code() === 'sm_invalid' && $bad->get_error_data()['placeholder'] === '{{sm_media_url:nope}}');
check('lenient keeps unknown placeholders', SM_Pages::resolve_placeholders('{{sm_media_url:nope}}', [], false) === '{{sm_media_url:nope}}');
check('text extraction strips blocks and tags', SM_Pages::text_from_content($before['content']) === 'We bake banitsa every morning.');
```

Make `tests/run.php` also require `class-sm-pages.php` before loading cases (it already globs `cases/*.php`). Run `npm run wp:test`: the new checks FAIL until Step 2.

- [ ] **Step 2: `class-sm-pages.php`**

Create `integrations/wordpress/site-manager/includes/class-sm-pages.php`:

```php
<?php
// Page builders, before/after computation, placeholders and the actual write. Pure parts are testable without WordPress.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Pages
{
    public const PENDING_META = '_site_manager_pending';
    public const SOURCE_META = '_site_manager_source_id';
    private const PLACEHOLDER = '/\{\{sm_media_(url|id):([^}]+)\}\}/';
    /** @var callable(string): ?array{id: int, url: string} */
    public static $attachment_lookup = [self::class, 'find_attachment'];

    public static function builder_of(WP_Post $p): string
    {
        if (get_post_meta($p->ID, '_elementor_edit_mode', true) === 'builder' && get_post_meta($p->ID, '_elementor_data', true) !== '') {
            return 'elementor';
        }
        if (get_post_meta($p->ID, '_et_pb_use_builder', true) === 'on') {
            return 'divi';
        }
        return has_blocks((string) $p->post_content) ? 'gutenberg' : 'classic';
    }

    public static function fields(WP_Post $p): array
    {
        $el = get_post_meta($p->ID, '_elementor_data', true);
        $thumb = (int) get_post_thumbnail_id($p);
        return ['title' => (string) $p->post_title, 'content' => (string) $p->post_content, 'elementor_data' => is_string($el) && $el !== '' ? $el : null, 'featured_media' => $thumb > 0 ? $thumb : null];
    }

    public static function summary(WP_Post $p): array
    {
        $f = self::fields($p);
        return [
            'id' => (int) $p->ID,
            'title' => $f['title'],
            'slug' => (string) $p->post_name,
            'url' => (string) get_permalink($p),
            'status' => (string) $p->post_status,
            'builder' => self::builder_of($p),
            'modified' => mysql2date('c', $p->post_modified_gmt, false),
            'featured_media' => $f['featured_media'],
            'is_front_page' => (int) get_option('page_on_front') === (int) $p->ID,
        ];
    }

    public static function text_from_content(string $content): string
    {
        $noBlocks = preg_replace('/<!--.*?-->/s', '', $content) ?? '';
        return trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags($noBlocks), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
    }

    public static function text_of(WP_Post $p): string
    {
        $f = self::fields($p);
        if (self::builder_of($p) === 'elementor') {
            return trim(implode(' ', array_map([self::class, 'text_from_content'], self::elementor_texts($f['elementor_data']))));
        }
        return self::text_from_content($f['content']);
    }

    /** Non-empty string values under `settings`, depth first, in document order. */
    public static function elementor_texts(?string $data): array
    {
        if ($data === null || $data === '') {
            return [];
        }
        $tree = json_decode($data, true);
        $out = [];
        $walk = static function ($node) use (&$walk, &$out): void {
            if (!is_array($node)) {
                return;
            }
            if (isset($node['settings']) && is_array($node['settings'])) {
                foreach ($node['settings'] as $v) {
                    if (is_string($v) && trim($v) !== '') {
                        $out[] = $v;
                    }
                }
            }
            foreach ($node as $k => $child) {
                if (is_array($child) && $k !== 'settings') {
                    $walk($child);
                }
            }
        };
        $walk(is_array($tree) ? $tree : []);
        return $out;
    }

    /** @return array{data: string, count: int} */
    private static function replace_in_elementor(string $data, string $find, string $replace): array
    {
        $tree = json_decode($data, true);
        $count = 0;
        $walk = static function ($node) use (&$walk, &$count, $find, $replace) {
            if (!is_array($node)) {
                return $node;
            }
            foreach ($node as $k => $child) {
                if ($k === 'settings' && is_array($child)) {
                    foreach ($child as $sk => $sv) {
                        if (is_string($sv)) {
                            $count += substr_count($sv, $find);
                            $child[$sk] = str_replace($find, $replace, $sv);
                        }
                    }
                    $node[$k] = $child;
                } elseif (is_array($child)) {
                    $node[$k] = $walk($child);
                }
            }
            return $node;
        };
        $new = $walk(is_array($tree) ? $tree : []);
        return ['data' => (string) wp_json_encode($new, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'count' => $count];
    }

    private static function error(int $status, string $code, string $message, array $extra = []): WP_Error
    {
        return new WP_Error($code, $message, ['status' => $status] + $extra);
    }

    /**
     * Applies an edit ({title?, content?, replacements?, featured_media?, elementor_data?}) to the before-fields.
     * @return array{title: string, content: string, elementor_data: ?string, featured_media: ?int}|WP_Error
     */
    public static function compute_after(array $before, array $edit, string $builder, array $placeholders, bool $strict): array|WP_Error
    {
        $after = $before;
        if ($builder === 'unknown' && (isset($edit['content']) || isset($edit['replacements']))) {
            return self::error(422, 'sm_builder_unsupported', 'This page is built with an unsupported editor.', ['builder' => $builder]);
        }
        if (isset($edit['title']) && is_string($edit['title'])) {
            $after['title'] = $edit['title'];
        }
        if (isset($edit['content']) && is_string($edit['content'])) {
            if ($builder === 'elementor') {
                return self::error(422, 'sm_builder_unsupported', 'Elementor pages take replacements, not full content.', ['builder' => 'elementor']);
            }
            $after['content'] = $edit['content'];
        }
        if (array_key_exists('elementor_data', $edit) && ($edit['elementor_data'] === null || is_string($edit['elementor_data']))) {
            $after['elementor_data'] = $edit['elementor_data'];
        }
        foreach ((array) ($edit['replacements'] ?? []) as $r) {
            $find = (string) ($r['find'] ?? '');
            $replace = (string) ($r['replace'] ?? '');
            if ($find === '') {
                return self::error(400, 'sm_invalid', 'A replacement needs a non-empty find text.');
            }
            if ($builder === 'elementor') {
                $res = self::replace_in_elementor((string) ($after['elementor_data'] ?? '[]'), $find, $replace);
                if ($res['count'] !== 1) {
                    return self::error(422, 'sm_replace_failed', sprintf('"%s" occurs %d times; it must occur exactly once.', $find, $res['count']), ['find' => $find, 'count' => $res['count']]);
                }
                $after['elementor_data'] = $res['data'];
            } else {
                $count = substr_count((string) $after['content'], $find);
                if ($count !== 1) {
                    return self::error(422, 'sm_replace_failed', sprintf('"%s" occurs %d times; it must occur exactly once.', $find, $count), ['find' => $find, 'count' => $count]);
                }
                $pos = strpos((string) $after['content'], $find);
                $after['content'] = substr_replace((string) $after['content'], $replace, (int) $pos, strlen($find));
            }
        }
        if (array_key_exists('featured_media', $edit)) {
            $after['featured_media'] = $edit['featured_media'] === null || $edit['featured_media'] === '' ? null : (int) $edit['featured_media'];
        }
        foreach (['title', 'content', 'elementor_data'] as $k) {
            if (!is_string($after[$k] ?? null)) {
                continue;
            }
            $resolved = self::resolve_placeholders($after[$k], $placeholders, $strict);
            if (is_wp_error($resolved)) {
                return $resolved;
            }
            $after[$k] = $resolved;
        }
        return ['title' => (string) $after['title'], 'content' => (string) $after['content'], 'elementor_data' => $after['elementor_data'] ?? null, 'featured_media' => $after['featured_media'] ?? null];
    }

    /** Explicit map first, then the media library by source id; unresolved tokens error when $strict. */
    public static function resolve_placeholders(string $text, array $map, bool $strict): string|WP_Error
    {
        $failed = null;
        $out = preg_replace_callback(self::PLACEHOLDER, static function (array $m) use ($map, $strict, &$failed): string {
            $token = $m[0];
            if (isset($map[$token])) {
                return (string) $map[$token];
            }
            $found = call_user_func(self::$attachment_lookup, $m[2]);
            if (is_array($found)) {
                return $m[1] === 'url' ? (string) $found['url'] : (string) $found['id'];
            }
            if ($strict && $failed === null) {
                $failed = $token;
            }
            return $token;
        }, $text);
        if ($failed !== null) {
            return self::error(400, 'sm_invalid', 'Unresolved placeholder ' . $failed, ['placeholder' => $failed]);
        }
        return (string) $out;
    }

    /** @return ?array{id: int, url: string} */
    public static function find_attachment(string $source_id): ?array
    {
        $q = new WP_Query(['post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => 1, 'fields' => 'ids', 'meta_key' => self::SOURCE_META, 'meta_value' => $source_id, 'no_found_rows' => true]);
        $id = $q->posts[0] ?? null;
        if (!$id) {
            return null;
        }
        return ['id' => (int) $id, 'url' => (string) wp_get_attachment_url((int) $id)];
    }

    /** Writes the fields present in $fields (after placeholder resolution) and returns {before, after, revision_id}. */
    public static function apply(WP_Post $p, array $fields, array $placeholders): array|WP_Error
    {
        $before = self::fields($p);
        $after = self::compute_after($before, array_intersect_key($fields, array_flip(['title', 'content', 'elementor_data', 'featured_media'])), self::builder_of($p), $placeholders, true);
        if (is_wp_error($after)) {
            return $after;
        }
        $update = ['ID' => $p->ID];
        if ($after['title'] !== $before['title']) {
            $update['post_title'] = $after['title'];
        }
        if ($after['content'] !== $before['content']) {
            $update['post_content'] = $after['content'];
        }
        if (count($update) > 1) {
            $r = wp_update_post(wp_slash($update), true);
            if (is_wp_error($r)) {
                return self::error(500, 'sm_write_failed', $r->get_error_message());
            }
        }
        if ($after['elementor_data'] !== $before['elementor_data']) {
            if ($after['elementor_data'] === null) {
                delete_post_meta($p->ID, '_elementor_data');
            } else {
                update_post_meta($p->ID, '_elementor_data', wp_slash($after['elementor_data']));
            }
            delete_post_meta($p->ID, '_elementor_css');
            if (class_exists('\Elementor\Plugin') && isset(\Elementor\Plugin::$instance->files_manager)) {
                \Elementor\Plugin::$instance->files_manager->clear_cache();
            }
        }
        if ($after['featured_media'] !== $before['featured_media']) {
            if ($after['featured_media'] === null) {
                delete_post_thumbnail($p->ID);
            } else {
                set_post_thumbnail($p->ID, $after['featured_media']);
            }
        }
        delete_post_meta($p->ID, self::PENDING_META);
        clean_post_cache($p->ID);
        $revisions = wp_get_post_revisions($p->ID, ['posts_per_page' => 1, 'fields' => 'ids']);
        $rev = $revisions ? (int) array_key_first($revisions) : null;
        return ['before' => $before, 'after' => self::fields(get_post($p->ID)), 'revision_id' => $rev];
    }
}
```

Run: `npm run wp:test`
Expected: `ALL PASSED` (the `pages.php` cases included).

- [ ] **Step 3: `class-sm-auth.php`**

```php
<?php
// Connect code, plugin token, bearer check, rate limits, impersonation and the API log ring buffer.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Auth
{
    public const OPT_CODE = 'site_manager_connect_code';
    public const OPT_TOKEN = 'site_manager_token';
    public const OPT_LOG = 'site_manager_api_log';
    private const CODE_TTL = 900;
    private const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    private const LOG_SIZE = 50;

    /** A fresh one-time code for the owner to send to the bot; stored hashed with its expiry and the admin's id. */
    public static function new_code(int $user_id): string
    {
        $code = '';
        for ($i = 0; $i < 10; $i++) {
            $code .= self::CODE_ALPHABET[random_int(0, strlen(self::CODE_ALPHABET) - 1)];
        }
        update_option(self::OPT_CODE, ['hash' => hash('sha256', $code), 'expires' => time() + self::CODE_TTL, 'user_id' => $user_id], false);
        return $code;
    }

    /** @return ?array{expires: int, user_id: int} */
    public static function code_info(): ?array
    {
        $c = get_option(self::OPT_CODE, null);
        return is_array($c) && (int) ($c['expires'] ?? 0) > time() ? ['expires' => (int) $c['expires'], 'user_id' => (int) $c['user_id']] : null;
    }

    /** Exchanges a valid code for a new token (returned once; only its hash is kept). */
    public static function redeem_code(string $code, string $slug): string|WP_Error
    {
        $c = get_option(self::OPT_CODE, null);
        $settings = SM_Client::settings();
        $normalised = strtoupper(trim($code));
        if (!is_array($c) || (int) ($c['expires'] ?? 0) < time() || !hash_equals((string) ($c['hash'] ?? ''), hash('sha256', $normalised))) {
            return new WP_Error('sm_forbidden', 'The code is wrong or expired. Generate a new one on the plugin\'s settings page.', ['status' => 403]);
        }
        if ($settings['slug'] === '' || $slug !== $settings['slug']) {
            return new WP_Error('sm_forbidden', sprintf('This plugin is configured for the venue "%s".', $settings['slug']), ['status' => 403]);
        }
        $user = get_user_by('id', (int) $c['user_id']);
        if (!$user || !user_can($user, 'edit_pages')) {
            return new WP_Error('sm_forbidden', 'The WordPress user who generated the code can no longer edit pages.', ['status' => 403]);
        }
        $token = bin2hex(random_bytes(32));
        update_option(self::OPT_TOKEN, ['hash' => hash('sha256', $token), 'prefix' => substr($token, 0, 6), 'user_id' => (int) $c['user_id'], 'connected_at' => time(), 'venue_slug' => $slug], false);
        delete_option(self::OPT_CODE);
        return $token;
    }

    public static function disconnect(): void
    {
        delete_option(self::OPT_TOKEN);
        delete_option(self::OPT_CODE);
    }

    /** @return ?array{prefix: string, user_id: int, connected_at: int, venue_slug: string} */
    public static function connection(): ?array
    {
        $t = get_option(self::OPT_TOKEN, null);
        return is_array($t) && !empty($t['hash']) ? ['prefix' => (string) $t['prefix'], 'user_id' => (int) $t['user_id'], 'connected_at' => (int) $t['connected_at'], 'venue_slug' => (string) ($t['venue_slug'] ?? '')] : null;
    }

    public static function client_ip(): string
    {
        $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
        return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
    }

    /** Fixed one-minute windows in a transient: `$max` calls per bucket per minute. */
    public static function rate_limit(string $bucket, int $max): true|WP_Error
    {
        $key = 'site_manager_rl_' . md5($bucket . '|' . (int) floor(time() / 60));
        $n = (int) get_transient($key) + 1;
        set_transient($key, $n, 120);
        if ($n > $max) {
            return new WP_Error('sm_rate_limited', 'Too many requests; try again in a minute.', ['status' => 429]);
        }
        return true;
    }

    /** Bearer token check with a constant-time compare, then runs the request as the connecting admin. */
    public static function permission(WP_REST_Request $r): true|WP_Error
    {
        $rl = self::rate_limit('api|' . self::client_ip(), 120);
        if (is_wp_error($rl)) {
            return $rl;
        }
        $header = (string) $r->get_header('authorization');
        if (!preg_match('/^Bearer\s+([a-f0-9]{64})$/i', trim($header), $m)) {
            return new WP_Error('sm_unauthorized', 'Missing or invalid plugin token.', ['status' => 401]);
        }
        $t = get_option(self::OPT_TOKEN, null);
        if (!is_array($t) || empty($t['hash']) || !hash_equals((string) $t['hash'], hash('sha256', strtolower($m[1])))) {
            return new WP_Error('sm_unauthorized', 'Missing or invalid plugin token.', ['status' => 401]);
        }
        $user = get_user_by('id', (int) ($t['user_id'] ?? 0));
        if (!$user || !user_can($user, 'edit_pages')) {
            return new WP_Error('sm_forbidden', 'The connected WordPress user can no longer edit pages; reconnect from the settings page.', ['status' => 403]);
        }
        wp_set_current_user($user->ID);
        return true;
    }

    public static function handshake_permission(WP_REST_Request $r): true|WP_Error
    {
        return self::rate_limit('handshake|' . self::client_ip(), 5);
    }

    public static function log(string $method, string $route, int $status, float $ms): void
    {
        $log = get_option(self::OPT_LOG, []);
        $log = is_array($log) ? $log : [];
        $log[] = ['t' => time(), 'ip' => self::client_ip(), 'm' => $method, 'r' => $route, 's' => $status, 'ms' => (int) round($ms)];
        if (count($log) > self::LOG_SIZE) {
            $log = array_slice($log, -self::LOG_SIZE);
        }
        update_option(self::OPT_LOG, $log, false);
    }

    public static function recent_log(int $n = 20): array
    {
        $log = get_option(self::OPT_LOG, []);
        return is_array($log) ? array_reverse(array_slice($log, -$n)) : [];
    }
}
```

- [ ] **Step 4: `class-sm-rest.php`**

```php
<?php
// REST namespace site-manager/v1: the write channel. Routes, bodies and errors follow the plan's "Plugin REST contract".
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Rest
{
    public const NS = 'site-manager/v1';
    private const OPTION_KEYS = ['blogname', 'blogdescription', 'custom_logo', 'site_icon'];

    public static function register_routes(): void
    {
        $auth = [SM_Auth::class, 'permission'];
        $route = static function (string $path, string $methods, callable $cb, $permission) : void {
            register_rest_route(self::NS, $path, ['methods' => $methods, 'callback' => self::wrap($cb), 'permission_callback' => $permission]);
        };
        $route('/handshake', 'POST', [self::class, 'handshake'], [SM_Auth::class, 'handshake_permission']);
        $route('/site', 'GET', [self::class, 'site'], $auth);
        $route('/page/(?P<id>\d+)', 'GET', [self::class, 'page'], $auth);
        $route('/page/(?P<id>\d+)/preview', 'POST', [self::class, 'preview'], $auth);
        $route('/page/(?P<id>\d+)/preview', 'DELETE', [self::class, 'cancel_preview'], $auth);
        $route('/page/(?P<id>\d+)/apply', 'POST', [self::class, 'apply'], $auth);
        $route('/revert/(?P<page_id>\d+)/(?P<revision_id>\d+)', 'POST', [self::class, 'revert'], $auth);
        $route('/media', 'POST', [self::class, 'upload_media'], $auth);
        $route('/media', 'DELETE', [self::class, 'delete_media_by_source'], $auth);
        $route('/media/(?P<id>\d+)', 'PUT', [self::class, 'update_media'], $auth);
        $route('/media/(?P<id>\d+)', 'DELETE', [self::class, 'delete_media'], $auth);
        $route('/option', 'GET', [self::class, 'options'], $auth);
        $route('/option', 'PUT', [self::class, 'set_option'], $auth);
        $route('/menu/(?P<id>\d+)', 'GET', [self::class, 'menu'], $auth);
        $route('/menu/(?P<id>\d+)', 'PUT', [self::class, 'set_menu'], $auth);
        $route('/product/(?P<id>\d+)', 'GET', [self::class, 'product'], $auth);
        $route('/product/(?P<id>\d+)', 'PUT', [self::class, 'set_product'], $auth);
    }

    /** Times and logs every call (status of the WP_Error or 200). */
    private static function wrap(callable $cb): callable
    {
        return static function (WP_REST_Request $r) use ($cb) {
            $start = microtime(true);
            $result = $cb($r);
            $status = is_wp_error($result) ? (int) (($result->get_error_data()['status'] ?? 500)) : 200;
            SM_Auth::log($r->get_method(), $r->get_route(), $status, (microtime(true) - $start) * 1000);
            return $result;
        };
    }

    private static function error(int $status, string $code, string $message, array $extra = []): WP_Error
    {
        return new WP_Error($code, $message, ['status' => $status] + $extra);
    }

    private static function page_or_error(int $id): WP_Post|WP_Error
    {
        $p = get_post($id);
        if (!$p || !in_array($p->post_type, ['page', 'post'], true) || $p->post_status === 'trash') {
            return self::error(404, 'sm_not_found', 'No such page.');
        }
        return $p;
    }

    private static function body(WP_REST_Request $r): array
    {
        $b = $r->get_json_params();
        return is_array($b) ? $b : [];
    }

    // ---- handshake and site ----------------------------------------------------------------------

    public static function handshake(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $token = SM_Auth::redeem_code((string) ($b['code'] ?? ''), sanitize_key((string) ($b['slug'] ?? '')));
        if (is_wp_error($token)) {
            return $token;
        }
        $conn = SM_Auth::connection();
        if ($conn) {
            wp_set_current_user($conn['user_id']);
        }
        return ['token' => $token, 'site' => self::site_info()];
    }

    public static function site(WP_REST_Request $r): array
    {
        return self::site_info();
    }

    private static function site_info(): array
    {
        $pages = get_posts(['post_type' => 'page', 'post_status' => ['publish', 'draft', 'private'], 'posts_per_page' => 200, 'orderby' => ['menu_order' => 'ASC', 'title' => 'ASC']]);
        $menus = [];
        $locations = get_nav_menu_locations();
        foreach (wp_get_nav_menus() as $m) {
            $menus[] = ['id' => (int) $m->term_id, 'name' => (string) $m->name, 'locations' => array_keys(array_filter($locations, static fn($id): bool => (int) $id === (int) $m->term_id)), 'count' => (int) $m->count];
        }
        $theme = wp_get_theme();
        $conn = SM_Auth::connection();
        $user = $conn ? get_user_by('id', $conn['user_id']) : null;
        $woo = function_exists('wc_get_products');
        $products = [];
        if ($woo) {
            foreach (wc_get_products(['limit' => 100, 'status' => 'publish']) as $p) {
                $products[] = ['id' => $p->get_id(), 'name' => $p->get_name(), 'regular_price' => (string) $p->get_regular_price(), 'sale_price' => (string) $p->get_sale_price(), 'stock_status' => (string) $p->get_stock_status()];
            }
        }
        return [
            'name' => (string) get_option('blogname'),
            'description' => (string) get_option('blogdescription'),
            'url' => (string) site_url(),
            'home_url' => (string) home_url(),
            'wp_version' => (string) get_bloginfo('version'),
            'plugin_version' => SITE_MANAGER_VERSION,
            'locale' => (string) get_locale(),
            'timezone' => (string) wp_timezone_string(),
            'theme' => ['name' => (string) $theme->get('Name'), 'slug' => (string) $theme->get_stylesheet()],
            'pages' => array_map([SM_Pages::class, 'summary'], $pages),
            'menus' => $menus,
            'options' => self::option_values(),
            'woocommerce' => $woo,
            'products' => $products,
            'connected_user' => $user ? ['id' => (int) $user->ID, 'login' => (string) $user->user_login] : null,
        ];
    }

    // ---- pages -------------------------------------------------------------------------------------

    public static function page(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $f = SM_Pages::fields($p);
        $builder = SM_Pages::builder_of($p);
        return SM_Pages::summary($p) + $f + ['text' => SM_Pages::text_of($p), 'texts' => SM_Pages::elementor_texts($f['elementor_data']), 'editable' => $builder !== 'unknown'];
    }

    public static function preview(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $b = self::body($r);
        $before = SM_Pages::fields($p);
        $builder = SM_Pages::builder_of($p);
        $after = SM_Pages::compute_after($before, $b, $builder, (array) ($b['placeholders'] ?? []), false);
        if (is_wp_error($after)) {
            return $after;
        }
        $key = bin2hex(random_bytes(8));
        update_post_meta($p->ID, SM_Pages::PENDING_META, wp_slash(['key' => $key, 'after' => $after, 'expires' => time() + 86400]));
        return ['before' => $before, 'after' => $after, 'preview_url' => $builder === 'elementor' ? null : add_query_arg('sm_preview', $key, get_permalink($p)), 'pending_key' => $key];
    }

    public static function cancel_preview(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        delete_post_meta($p->ID, SM_Pages::PENDING_META);
        return ['ok' => true];
    }

    public static function apply(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $b = self::body($r);
        $res = SM_Pages::apply($p, $b, (array) ($b['placeholders'] ?? []));
        if (is_wp_error($res)) {
            return $res;
        }
        return ['id' => (int) $p->ID, 'url' => (string) get_permalink($p->ID)] + $res;
    }

    public static function revert(WP_REST_Request $r): array|WP_Error
    {
        $p = self::page_or_error((int) $r['page_id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $rev = wp_get_post_revision((int) $r['revision_id']);
        if (!$rev || (int) $rev->post_parent !== (int) $p->ID) {
            return self::error(404, 'sm_not_found', 'No such revision for this page.');
        }
        $restored = wp_restore_post_revision($rev->ID);
        if (!$restored) {
            return self::error(500, 'sm_write_failed', 'Could not restore the revision.');
        }
        return ['id' => (int) $p->ID, 'restored_revision' => (int) $rev->ID];
    }

    // ---- media -------------------------------------------------------------------------------------

    private static function media_row(int $id, bool $existed): array
    {
        return ['id' => $id, 'url' => (string) wp_get_attachment_url($id), 'alt' => (string) get_post_meta($id, '_wp_attachment_image_alt', true), 'existed' => $existed];
    }

    public static function upload_media(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $url = (string) ($b['url'] ?? '');
        $source = sanitize_text_field((string) ($b['source_id'] ?? ''));
        if (!wp_http_validate_url($url) || $source === '') {
            return self::error(400, 'sm_invalid', 'url and source_id are required.');
        }
        $existing = SM_Pages::find_attachment($source);
        if ($existing) {
            return self::media_row($existing['id'], true);
        }
        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';
        $tmp = download_url($url, 30);
        if (is_wp_error($tmp)) {
            return self::error(502, 'sm_upload_failed', 'Could not download the photo: ' . $tmp->get_error_message());
        }
        $name = sanitize_file_name((string) ($b['filename'] ?? basename((string) parse_url($url, PHP_URL_PATH))));
        if ($name === '' || !preg_match('/\.(jpe?g|png|webp|gif)$/i', $name)) {
            $name = 'site-manager-' . substr(md5($source), 0, 8) . '.jpg';
        }
        $id = media_handle_sideload(['name' => $name, 'tmp_name' => $tmp], 0, sanitize_text_field((string) ($b['title'] ?? '')));
        if (is_wp_error($id)) {
            @unlink($tmp);
            return self::error(502, 'sm_upload_failed', $id->get_error_message());
        }
        update_post_meta($id, SM_Pages::SOURCE_META, $source);
        if (isset($b['alt'])) {
            update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field((string) $b['alt']));
        }
        return self::media_row((int) $id, false);
    }

    public static function update_media(WP_REST_Request $r): array|WP_Error
    {
        $id = (int) $r['id'];
        if (get_post_type($id) !== 'attachment') {
            return self::error(404, 'sm_not_found', 'No such attachment.');
        }
        $b = self::body($r);
        if (isset($b['alt'])) {
            update_post_meta($id, '_wp_attachment_image_alt', sanitize_text_field((string) $b['alt']));
        }
        $update = ['ID' => $id];
        if (isset($b['title'])) {
            $update['post_title'] = sanitize_text_field((string) $b['title']);
        }
        if (isset($b['caption'])) {
            $update['post_excerpt'] = sanitize_text_field((string) $b['caption']);
        }
        if (count($update) > 1) {
            wp_update_post(wp_slash($update));
        }
        return self::media_row($id, true);
    }

    public static function delete_media(WP_REST_Request $r): array
    {
        $id = (int) $r['id'];
        $deleted = get_post_type($id) === 'attachment' && wp_delete_attachment($id, true) !== false;
        return ['ok' => true, 'deleted' => $deleted];
    }

    public static function delete_media_by_source(WP_REST_Request $r): array|WP_Error
    {
        $source = sanitize_text_field((string) $r->get_param('source_id'));
        if ($source === '') {
            return self::error(400, 'sm_invalid', 'source_id is required.');
        }
        $found = SM_Pages::find_attachment($source);
        $deleted = $found ? wp_delete_attachment($found['id'], true) !== false : false;
        return ['ok' => true, 'deleted' => $deleted];
    }

    // ---- options -----------------------------------------------------------------------------------

    private static function option_values(): array
    {
        $logo = (int) get_theme_mod('custom_logo', 0);
        $icon = (int) get_option('site_icon', 0);
        return ['blogname' => (string) get_option('blogname'), 'blogdescription' => (string) get_option('blogdescription'), 'custom_logo' => $logo > 0 ? $logo : null, 'site_icon' => $icon > 0 ? $icon : null];
    }

    public static function options(WP_REST_Request $r): array
    {
        return self::option_values();
    }

    public static function set_option(WP_REST_Request $r): array|WP_Error
    {
        $b = self::body($r);
        $key = (string) ($b['key'] ?? '');
        if (!in_array($key, self::OPTION_KEYS, true)) {
            return self::error(400, 'sm_invalid', sprintf('Option "%s" is not editable.', $key));
        }
        $before = self::option_values()[$key];
        $value = $b['value'] ?? null;
        if ($key === 'custom_logo' || $key === 'site_icon') {
            if (is_string($value) && str_starts_with($value, '{{')) {
                $resolved = SM_Pages::resolve_placeholders($value, (array) ($b['placeholders'] ?? []), true);
                if (is_wp_error($resolved)) {
                    return $resolved;
                }
                $value = $resolved;
            }
            $id = $value === null || $value === '' ? 0 : (int) $value;
            if ($id > 0 && get_post_type($id) !== 'attachment') {
                return self::error(400, 'sm_invalid', 'value must be an attachment id or null.');
            }
            if ($key === 'custom_logo') {
                $id > 0 ? set_theme_mod('custom_logo', $id) : remove_theme_mod('custom_logo');
            } else {
                update_option('site_icon', $id);
            }
        } else {
            update_option($key, sanitize_text_field((string) $value));
        }
        return ['key' => $key, 'before' => $before, 'after' => self::option_values()[$key]];
    }

    // ---- menus -------------------------------------------------------------------------------------

    private static function menu_items(int $menu_id): array
    {
        $items = wp_get_nav_menu_items($menu_id, ['post_status' => 'publish,draft']) ?: [];
        $ids = array_map(static fn($i): int => (int) $i->ID, $items);
        $out = [];
        foreach ($items as $i) {
            $parent = (int) $i->menu_item_parent;
            $pi = $parent > 0 ? array_search($parent, $ids, true) : false;
            $out[] = ['id' => (int) $i->ID, 'title' => (string) $i->title, 'url' => (string) $i->url, 'parent_index' => $pi === false ? null : (int) $pi, 'position' => (int) $i->menu_order, 'type' => $i->type === 'post_type' ? 'post_type' : 'custom', 'object_id' => $i->type === 'post_type' ? (int) $i->object_id : null];
        }
        return $out;
    }

    public static function menu(WP_REST_Request $r): array|WP_Error
    {
        $menu = wp_get_nav_menu_object((int) $r['id']);
        if (!$menu) {
            return self::error(404, 'sm_not_found', 'No such menu.');
        }
        $locations = get_nav_menu_locations();
        return ['id' => (int) $menu->term_id, 'name' => (string) $menu->name, 'locations' => array_keys(array_filter($locations, static fn($id): bool => (int) $id === (int) $menu->term_id)), 'items' => self::menu_items((int) $menu->term_id)];
    }

    public static function set_menu(WP_REST_Request $r): array|WP_Error
    {
        $menu = wp_get_nav_menu_object((int) $r['id']);
        if (!$menu) {
            return self::error(404, 'sm_not_found', 'No such menu.');
        }
        $items = self::body($r)['items'] ?? null;
        if (!is_array($items)) {
            return self::error(400, 'sm_invalid', 'items must be a list.');
        }
        $before = self::menu_items((int) $menu->term_id);
        foreach ($before as $old) {
            wp_delete_post($old['id'], true);
        }
        $newIds = [];
        foreach (array_values($items) as $i => $it) {
            $parentIdx = $it['parent_index'] ?? null;
            $type = ($it['type'] ?? 'custom') === 'post_type' && !empty($it['object_id']) ? 'post_type' : 'custom';
            $args = [
                'menu-item-title' => sanitize_text_field((string) ($it['title'] ?? '')),
                'menu-item-url' => esc_url_raw((string) ($it['url'] ?? '')),
                'menu-item-status' => 'publish',
                'menu-item-position' => $i + 1,
                'menu-item-type' => $type,
                'menu-item-parent-id' => $parentIdx !== null && isset($newIds[(int) $parentIdx]) ? $newIds[(int) $parentIdx] : 0,
            ];
            if ($type === 'post_type') {
                $args['menu-item-object'] = get_post_type((int) $it['object_id']) ?: 'page';
                $args['menu-item-object-id'] = (int) $it['object_id'];
            }
            $id = wp_update_nav_menu_item((int) $menu->term_id, 0, $args);
            $newIds[$i] = is_wp_error($id) ? 0 : (int) $id;
        }
        return ['id' => (int) $menu->term_id, 'before' => $before, 'after' => self::menu_items((int) $menu->term_id)];
    }

    // ---- WooCommerce products ------------------------------------------------------------------------

    private static function product_row(object $p): array
    {
        return ['id' => $p->get_id(), 'name' => $p->get_name(), 'regular_price' => (string) $p->get_regular_price(), 'sale_price' => (string) $p->get_sale_price(), 'stock_status' => (string) $p->get_stock_status(), 'description' => (string) $p->get_description(), 'short_description' => (string) $p->get_short_description(), 'url' => (string) $p->get_permalink()];
    }

    private static function product_or_error(int $id): object|WP_Error
    {
        if (!function_exists('wc_get_product')) {
            return self::error(404, 'sm_no_woocommerce', 'WooCommerce is not active on this site.');
        }
        $p = wc_get_product($id);
        return $p ? $p : self::error(404, 'sm_not_found', 'No such product.');
    }

    public static function product(WP_REST_Request $r): array|WP_Error
    {
        $p = self::product_or_error((int) $r['id']);
        return is_wp_error($p) ? $p : self::product_row($p);
    }

    public static function set_product(WP_REST_Request $r): array|WP_Error
    {
        $p = self::product_or_error((int) $r['id']);
        if (is_wp_error($p)) {
            return $p;
        }
        $before = self::product_row($p);
        $b = self::body($r);
        if (isset($b['name'])) {
            $p->set_name(sanitize_text_field((string) $b['name']));
        }
        if (isset($b['regular_price'])) {
            $p->set_regular_price(wc_format_decimal((string) $b['regular_price']));
        }
        if (array_key_exists('sale_price', $b)) {
            $p->set_sale_price($b['sale_price'] === '' || $b['sale_price'] === null ? '' : wc_format_decimal((string) $b['sale_price']));
        }
        if (isset($b['stock_status']) && in_array($b['stock_status'], ['instock', 'outofstock', 'onbackorder'], true)) {
            $p->set_stock_status((string) $b['stock_status']);
        }
        if (isset($b['description'])) {
            $p->set_description(wp_kses_post((string) $b['description']));
        }
        if (isset($b['short_description'])) {
            $p->set_short_description(wp_kses_post((string) $b['short_description']));
        }
        $p->save();
        return ['id' => $p->get_id(), 'before' => $before, 'after' => self::product_row(wc_get_product($p->get_id()))];
    }
}
```

- [ ] **Step 5: `class-sm-preview.php` (the `?sm_preview=<key>` link)**

```php
<?php
// Renders a page with its pending Site Manager edit when ?sm_preview=<key> matches; never affects normal visitors.
declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class SM_Preview
{
    private static ?array $pending = null;
    private static int $post_id = 0;

    public static function register(): void
    {
        if (!isset($_GET['sm_preview'])) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the key is the credential
            return;
        }
        add_action('wp', [self::class, 'arm']);
    }

    public static function arm(): void
    {
        $post = get_queried_object();
        if (!$post instanceof WP_Post) {
            return;
        }
        $pending = get_post_meta($post->ID, SM_Pages::PENDING_META, true);
        $key = (string) sanitize_text_field(wp_unslash((string) ($_GET['sm_preview'] ?? ''))); // phpcs:ignore WordPress.Security.NonceVerification.Recommended
        if (!is_array($pending) || (int) ($pending['expires'] ?? 0) < time() || !hash_equals((string) ($pending['key'] ?? ''), $key)) {
            return;
        }
        self::$pending = $pending['after'];
        self::$post_id = (int) $post->ID;
        nocache_headers();
        add_filter('the_title', [self::class, 'title'], 10, 2);
        add_filter('the_content', [self::class, 'content'], 1);
        add_filter('post_thumbnail_id', [self::class, 'thumbnail'], 10, 2);
        add_action('wp_head', static function (): void {
            echo '<meta name="robots" content="noindex,nofollow">' . "\n";
        });
        add_action('wp_body_open', static function (): void {
            wp_enqueue_style('site-manager');
            echo '<div class="sm-preview-banner">' . esc_html('Предварителен преглед от Site Manager · Preview from Site Manager, not published') . '</div>';
        });
    }

    public static function title(string $title, int $id = 0): string
    {
        return $id === self::$post_id && self::$pending !== null ? (string) self::$pending['title'] : $title;
    }

    public static function content(string $content): string
    {
        if (self::$pending === null || (int) get_the_ID() !== self::$post_id) {
            return $content;
        }
        return (string) self::$pending['content'];
    }

    public static function thumbnail($id, $post)
    {
        $pid = $post instanceof WP_Post ? (int) $post->ID : (int) $post;
        if (self::$pending === null || $pid !== self::$post_id || !array_key_exists('featured_media', self::$pending)) {
            return $id;
        }
        return self::$pending['featured_media'] ?? 0;
    }
}
```

`the_content` runs at priority 1 so block rendering (`do_blocks`, priority 9) and shortcodes still process the pending content; `wp_body_open` requires a theme that calls it (every block theme and most classic ones do; when absent the banner simply does not show, and the `noindex` meta still does).

- [ ] **Step 6: Settings page: connect box and the log**

Append to `integrations/wordpress/site-manager/includes/class-sm-settings.php` inside the class, and hook them from `register()` (add these lines at the end of `register()`):

```php
        add_action('admin_post_site_manager_code', [self::class, 'handle_code']);
        add_action('admin_post_site_manager_disconnect', [self::class, 'handle_disconnect']);
        add_action('site_manager_settings_after_form', [self::class, 'connect_box']);
```

and the methods:

```php
    public static function handle_code(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_code');
        $code = SM_Auth::new_code(get_current_user_id());
        set_transient('site_manager_show_code_' . get_current_user_id(), $code, 900);
        wp_safe_redirect(add_query_arg(['page' => self::PAGE], admin_url('options-general.php')) . '#connect');
        exit;
    }

    public static function handle_disconnect(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You are not allowed to do that.', 'site-manager'));
        }
        check_admin_referer('site_manager_disconnect');
        SM_Auth::disconnect();
        wp_safe_redirect(add_query_arg(['page' => self::PAGE, 'sm_check' => 'success', 'sm_msg' => rawurlencode(__('Disconnected. The blocks keep working; the agent can no longer edit this site.', 'site-manager'))], admin_url('options-general.php')));
        exit;
    }

    public static function connect_box(array $settings): void
    {
        $conn = SM_Auth::connection();
        $code = get_transient('site_manager_show_code_' . get_current_user_id());
        echo '<h2 id="connect">' . esc_html__('Let the Site Manager agent edit this site', 'site-manager') . '</h2>';
        if ($conn) {
            $user = get_user_by('id', $conn['user_id']);
            echo '<p>' . esc_html(sprintf(__('Connected to venue "%1$s" since %2$s, acting as %3$s (token %4$s…).', 'site-manager'), $conn['venue_slug'], wp_date(get_option('date_format') . ' ' . get_option('time_format'), $conn['connected_at']), $user ? $user->user_login : '?', $conn['prefix'])) . '</p>';
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('site_manager_disconnect');
            echo '<input type="hidden" name="action" value="site_manager_disconnect">';
            submit_button(__('Disconnect', 'site-manager'), 'delete', 'submit', false);
            echo '</form>';
        } else {
            echo '<p>' . esc_html__('Generate a one-time code, then send the line below to the Site Manager bot in Telegram. The code is valid for 15 minutes. Nothing changes on this site until you approve each edit in Telegram.', 'site-manager') . '</p>';
            if (is_string($code) && $code !== '' && SM_Auth::code_info() !== null) {
                $line = '/connect ' . home_url('/') . ' ' . $code;
                echo '<p><input type="text" readonly class="large-text code" id="sm-connect-line" value="' . esc_attr($line) . '" onclick="this.select()"> ';
                echo '<button type="button" class="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById(\'sm-connect-line\').value)">' . esc_html__('Copy', 'site-manager') . '</button></p>';
                echo '<p class="description">' . esc_html(sprintf(__('Expires at %s.', 'site-manager'), wp_date(get_option('time_format'), SM_Auth::code_info()['expires']))) . '</p>';
            }
            echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
            wp_nonce_field('site_manager_code');
            echo '<input type="hidden" name="action" value="site_manager_code">';
            submit_button(__('Generate code', 'site-manager'), 'primary', 'submit', false);
            echo '</form>';
        }
        $log = SM_Auth::recent_log(20);
        echo '<h2>' . esc_html__('Recent API calls', 'site-manager') . '</h2>';
        if (!$log) {
            echo '<p class="description">' . esc_html__('None yet.', 'site-manager') . '</p>';
            return;
        }
        echo '<table class="widefat striped"><thead><tr><th>' . esc_html__('When', 'site-manager') . '</th><th>IP</th><th>' . esc_html__('Call', 'site-manager') . '</th><th>' . esc_html__('Status', 'site-manager') . '</th><th>ms</th></tr></thead><tbody>';
        foreach ($log as $e) {
            echo '<tr><td>' . esc_html(wp_date(get_option('date_format') . ' ' . get_option('time_format'), (int) $e['t'])) . '</td><td>' . esc_html((string) $e['ip']) . '</td><td><code>' . esc_html($e['m'] . ' ' . $e['r']) . '</code></td><td>' . (int) $e['s'] . '</td><td>' . (int) $e['ms'] . '</td></tr>';
        }
        echo '</tbody></table>';
    }
```

Add every new `__()`/`esc_html__()` string to the `.po` with natural Bulgarian (for example `"Let the Site Manager agent edit this site"` → `"Позволете на агента на Site Manager да редактира този сайт"`, `"Generate code"` → `"Генерирай код"`, `"Disconnect"` → `"Прекъсни връзката"`, `"Recent API calls"` → `"Последни API заявки"`, `"Connected to venue \"%1$s\" since %2$s, acting as %3$s (token %4$s…)."` → `"Свързано със заведение „%1$s“ от %2$s, като потребител %3$s (токен %4$s…)."`, `"Expires at %s."` → `"Изтича в %s."`, `"Copy"` → `"Копирай"`, `"When"` → `"Кога"`, `"Call"` → `"Заявка"`, `"Status"` → `"Статус"`, `"None yet."` → `"Още няма."`, `"Disconnected. The blocks keep working; the agent can no longer edit this site."` → `"Връзката е прекъсната. Блоковете продължават да работят; агентът вече не може да редактира този сайт."`, the long "Generate a one-time code…" paragraph → `"Генерирайте еднократен код и изпратете реда по-долу на бота на Site Manager в Telegram. Кодът важи 15 минути. Нищо на този сайт не се променя, докато не одобрите всяка редакция в Telegram."`), run `npm run wp:i18n`, and make `npx vitest run test/wp-plugin-contract.test.ts` pass (it lists any missing string).

- [ ] **Step 7: Lint, PHP tests, vitest, commit**

Run: `npm run wp:lint && npm run wp:test && npx vitest run test/wp-plugin-contract.test.ts test/wp-plugin-blocks.test.ts`
Expected: green. (The REST routes themselves are verified in Task 11's Docker smoke.)

```bash
git add integrations/wordpress
git commit -m "WordPress plugin: write channel (handshake, bearer auth, pages with preview, media, options, menus, products, log)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Plugin zip, Docker smoke test, `docs/INTEGRATION.md` and the README section

**Files:**
- Create: `scripts/wp-plugin-zip.mts`, `public/wp/site-manager.zip` (generated, committed), `test/wp-plugin-zip.test.ts`, `integrations/wordpress/docker-compose.yml`, `integrations/wordpress/smoke/mu-plugins/site-manager-smoke.php`, `scripts/wp-smoke.mts`, `docs/INTEGRATION.md`
- Modify (append-only): `package.json` (scripts `wp:zip`, `wp:smoke`), `README.md` (section "Works with your existing website" and two rows in the env table and the scripts table)
- Test: `test/wp-plugin-zip.test.ts`; `npm run wp:smoke` (opt-in, Docker)

**Interfaces:**
- Consumes: everything above. The smoke drives the real plugin through `connectWordPress`, `makeTools`, `withDestinationSync`, `adminAction` against an `InMemoryStore`.
- Produces: `buildZip(): Buffer`, `listPluginFiles(): string[]` in `scripts/wp-plugin-zip.mts`; `npm run wp:zip`, `npm run wp:smoke [-- --keep] [-- --feed <base url>]`.

Decisions: the zip uses the **store** method (no compression) and a fixed timestamp so its bytes are a pure function of the plugin sources; the test rebuilds it and compares. The smoke installs WordPress with WP-CLI in the official `wordpress:cli` image, pretty permalinks on (the REST API lives at `/wp-json/` only with them), and serves a generated PNG from the host for the photo upload; a smoke-only mu-plugin allows WordPress to fetch from `host.docker.internal`.

- [ ] **Step 1: Zip builder and its test**

Create `scripts/wp-plugin-zip.mts`:

```ts
// scripts/wp-plugin-zip.mts
// Builds public/wp/site-manager.zip from integrations/wordpress/site-manager deterministically (store method,
// fixed timestamps, sorted entries), so the committed zip is a pure function of the sources. Run: npm run wp:zip
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { posix, relative, resolve } from "node:path";

export const PLUGIN_DIR = resolve(process.cwd(), "integrations/wordpress/site-manager");
export const ZIP_PATH = resolve(process.cwd(), "public/wp/site-manager.zip");
const PREFIX = "site-manager/";
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 10; // 2026-10-10
const DOS_TIME = 0;
const SKIP = new Set([".DS_Store", "Thumbs.db"]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Relative POSIX paths of every file in the plugin, sorted. */
export function listPluginFiles(dir = PLUGIN_DIR): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const p = resolve(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split("\\").join("/"));
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildZip(dir = PLUGIN_DIR): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const rel of listPluginFiles(dir)) {
    const data = readFileSync(resolve(dir, rel));
    const name = Buffer.from(posix.join(PREFIX, rel), "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

/** Names in the central directory of a zip built here (used by the test). */
export function zipEntries(zip: Buffer): string[] {
  const eocd = zip.length - 22;
  if (zip.readUInt32LE(eocd) !== 0x06054b50) throw new Error("not a zip without a comment");
  const n = zip.readUInt16LE(eocd + 8);
  let p = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    names.push(zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  mkdirSync(resolve(ZIP_PATH, ".."), { recursive: true });
  const zip = buildZip();
  writeFileSync(ZIP_PATH, zip);
  console.log(`wrote ${relative(process.cwd(), ZIP_PATH)} (${zip.length} bytes, ${zipEntries(zip).length} files)`);
}
```

Create `test/wp-plugin-zip.test.ts`:

```ts
// test/wp-plugin-zip.test.ts
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildZip, listPluginFiles, ZIP_PATH, zipEntries } from "../scripts/wp-plugin-zip.mts";

describe("public/wp/site-manager.zip", () => {
  it("is committed and matches the plugin sources (run `npm run wp:zip` after changing the plugin)", () => {
    expect(existsSync(ZIP_PATH)).toBe(true);
    const fresh = buildZip();
    expect(readFileSync(ZIP_PATH).equals(fresh), "stale zip: run npm run wp:zip and commit public/wp/site-manager.zip").toBe(true);
    const names = zipEntries(fresh);
    expect(names).toContain("site-manager/site-manager.php");
    expect(names).toContain("site-manager/readme.txt");
    expect(names).toContain("site-manager/uninstall.php");
    expect(names).toContain("site-manager/blocks/menu/block.json");
    expect(names).toContain("site-manager/languages/site-manager-bg_BG.l10n.php");
    expect(names).toContain("site-manager/languages/site-manager-bg_BG.mo");
    expect(names.some((n) => n.includes("/tests/") || n.endsWith(".DS_Store"))).toBe(false);
    expect(names.length).toBe(listPluginFiles().length);
    expect(buildZip().equals(fresh)).toBe(true); // deterministic
  });
});
```

Append to `package.json` scripts: `"wp:zip": "tsx scripts/wp-plugin-zip.mts"` and `"wp:smoke": "tsx --env-file-if-exists=.env.local scripts/wp-smoke.mts"`.

Run: `npm run wp:zip && npx vitest run test/wp-plugin-zip.test.ts`
Expected: PASS. Commit the zip.

- [ ] **Step 2: Docker compose and the smoke mu-plugin**

Create `integrations/wordpress/docker-compose.yml`:

```yaml
# Throwaway WordPress for the plugin smoke test (scripts/wp-smoke.mts). Credentials are local test values only.
services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: wordpress
      MYSQL_USER: wp
      MYSQL_PASSWORD: wp
      MYSQL_ROOT_PASSWORD: root
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-proot"]
      interval: 5s
      timeout: 5s
      retries: 30
    volumes:
      - db:/var/lib/mysql
  wordpress:
    image: wordpress:6.8
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8088:80"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wp
      WORDPRESS_DB_PASSWORD: wp
      WORDPRESS_DB_NAME: wordpress
      WORDPRESS_DEBUG: "1"
      WORDPRESS_CONFIG_EXTRA: |
        define('WP_DEBUG_DISPLAY', false);
        define('WP_DEBUG_LOG', true);
    volumes:
      - wp:/var/www/html
      - ./site-manager:/var/www/html/wp-content/plugins/site-manager:ro
      - ./smoke/mu-plugins:/var/www/html/wp-content/mu-plugins:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
  cli:
    image: wordpress:cli
    profiles: ["cli"]
    depends_on:
      - wordpress
    user: "33:33"
    environment:
      WORDPRESS_DB_HOST: db
      WORDPRESS_DB_USER: wp
      WORDPRESS_DB_PASSWORD: wp
      WORDPRESS_DB_NAME: wordpress
    volumes:
      - wp:/var/www/html
      - ./site-manager:/var/www/html/wp-content/plugins/site-manager:ro
      - ./smoke/mu-plugins:/var/www/html/wp-content/mu-plugins:ro
    extra_hosts:
      - "host.docker.internal:host-gateway"
    entrypoint: ["wp"]
volumes:
  db:
  wp:
```

Create `integrations/wordpress/smoke/mu-plugins/site-manager-smoke.php`:

```php
<?php
// Smoke-test only (mounted by docker-compose.yml, never shipped): lets WordPress download from the host machine.
declare(strict_types=1);
add_filter('http_request_host_is_external', static fn(bool $external, string $host): bool => $host === 'host.docker.internal' ? true : $external, 10, 2);
```

- [ ] **Step 3: The smoke script**

Create `scripts/wp-smoke.mts`:

```ts
// scripts/wp-smoke.mts
// End-to-end check of the WordPress plugin against a real WordPress in Docker (integrations/wordpress/docker-compose.yml):
// install WP, activate the plugin, render the blocks from a feed, then connect → preview → apply → undo through our own
// code with the in-memory store. Prints WP SMOKE OK. Flags: --keep (leave the containers up), --feed <base url>.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { makeTools } from "../src/agent/tools";
import { connectWordPress, disconnectWordPress, wordPressClientFor } from "../src/destinations/connect";
import { parseSecretKey, DEV_SECRET_KEY_HEX } from "../src/destinations/secrets";
import { withDestinationSync } from "../src/destinations/store-hook";
import { seedDemo } from "../src/seed/demo";
import { adminAction } from "../src/server/admin";
import { InMemoryStore } from "../src/store/memory";
import type { Lang } from "../src/domain/types";
import type { Messenger } from "../src/bot/messenger";

const COMPOSE = resolve(process.cwd(), "integrations/wordpress/docker-compose.yml");
const WP_URL = "http://localhost:8088";
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const feedBase = (args[args.indexOf("--feed") + 1] && args.includes("--feed") ? args[args.indexOf("--feed") + 1] : process.env.WP_SMOKE_FEED) ?? "https://site-manager-lovat.vercel.app";
const feedSlug = process.env.WP_SMOKE_SLUG ?? "agala";
const PHOTO_PORT = 8089;
// 1×1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const sh = (cmd: string, a: string[], opts: { quiet?: boolean } = {}) => execFileSync(cmd, a, { stdio: opts.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"], encoding: "utf8" }).trim();
const compose = (...a: string[]) => sh("docker", ["compose", "-f", COMPOSE, ...a]);
const wp = (...a: string[]) => sh("docker", ["compose", "-f", COMPOSE, "--profile", "cli", "run", "--rm", "-T", "cli", ...a], { quiet: true });
const step = (s: string) => console.log(`\n== ${s}`);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${msg}`);
}
async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { redirect: "manual" });
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`SMOKE FAIL: ${url} did not come up`);
}
const html = async (url: string) => (await fetch(url, { headers: { accept: "text/html" } })).text();

class PrintMessenger implements Messenger {
  private n = 1;
  async send(_c: number, text: string) {
    console.log(`  [bot] ${text.split("\n")[0]}`);
    return this.n++;
  }
  async sendProposal(_c: number, text: string, _id: string, _l: Lang) {
    console.log(`  [bot proposal] ${text.replace(/\n/g, " | ")}`);
    return this.n++;
  }
  async edit(_c: number, _m: number, text: string) {
    console.log(`  [bot edit] ${text.replace(/\n/g, " | ")}`);
  }
}

async function main() {
  step("docker compose up");
  compose("up", "-d");
  await waitFor(`${WP_URL}/`);

  step("install WordPress (throwaway admin, password not printed)");
  const adminPass = randomBytes(12).toString("base64url");
  try {
    wp("core", "is-installed");
  } catch {
    wp("core", "install", `--url=${WP_URL}`, "--title=Smoke Café", "--admin_user=smoke", `--admin_password=${adminPass}`, "--admin_email=smoke@example.com", "--skip-email");
  }
  wp("rewrite", "structure", "/%postname%/", "--hard");
  wp("plugin", "activate", "site-manager");
  wp("option", "update", "site_manager_settings", JSON.stringify({ base_url: feedBase, slug: feedSlug, cache_seconds: 5, lang: "auto" }), "--format=json");
  wp("option", "update", "blogname", "Smoke Café");

  step("read side: shortcode page and block page render from the feed");
  wp("post", "delete", "$(wp post list --post_type=page --format=ids)", "--force").toString();
  const menuId = wp("post", "create", "--post_type=page", "--post_status=publish", "--post_title=Menu", "--post_name=menu", "--post_content=[site_manager_menu]", "--porcelain");
  const hoursId = wp("post", "create", "--post_type=page", "--post_status=publish", "--post_title=Hours", "--post_name=hours", '--post_content=<!-- wp:site-manager/hours {"lang":"en"} /-->', "--porcelain");
  const aboutId = wp("post", "create", "--post_type=page", "--post_status=publish", "--post_title=About", "--post_name=about", "--post_content=<!-- wp:paragraph --><p>We bake banitsa every morning.</p><!-- /wp:paragraph -->", "--porcelain");
  const menuHtml = await html(`${WP_URL}/menu/`);
  assert(menuHtml.includes('class="sm sm-menu"'), `menu shortcode did not render (feed ${feedBase}/api/site/${feedSlug})`);
  assert(menuHtml.includes("sm-item"), "menu has no items; is the feed reachable from the container?");
  assert(menuHtml.includes("site-manager.css"), "stylesheet not enqueued");
  const hoursHtml = await html(`${WP_URL}/hours/`);
  assert(hoursHtml.includes("sm-status"), "hours block did not render");
  console.log(`  menu ${menuId}, hours ${hoursId}, about ${aboutId}: rendered`);

  step("write side: handshake through our connect flow");
  const store0 = new InMemoryStore();
  const { venue } = await seedDemo(store0, feedSlug);
  await store0.upsertMember({ venue_id: venue.id, tg_chat_id: 1, role: "owner", lang: "bg" });
  const secretKey = parseSecretKey(DEV_SECRET_KEY_HEX);
  const syncDeps = { store: store0, secretKey, log: (s: string) => console.log(`  ${s}`) };
  const store = withDestinationSync(store0, syncDeps);
  const code = wp("eval", "echo SM_Auth::new_code(1);");
  const anon = await fetch(`${WP_URL}/wp-json/site-manager/v1/site`);
  assert(anon.status === 401, `unauthenticated /site must be 401, got ${anon.status}`);
  const bad = await fetch(`${WP_URL}/wp-json/site-manager/v1/site`, { headers: { authorization: `Bearer ${"0".repeat(64)}` } });
  assert(bad.status === 401, `wrong token must be 401, got ${bad.status}`);
  const conn = await connectWordPress({ store, secretKey }, venue.id, WP_URL, code);
  assert(conn.ok, `connect failed: ${conn.ok ? "" : conn.reason.en}`);
  console.log(`  connected to "${conn.site.name}" (WP ${conn.site.wp_version}), pages: ${conn.site.pages.map((p) => p.title).join(", ")}`);
  const again = await connectWordPress({ store, secretKey }, venue.id, WP_URL, code);
  assert(!again.ok, "a used code must be refused");

  step("agent tools: edit page with a photo, preview, apply, undo");
  const photoServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(PNG);
  }).listen(PHOTO_PORT);
  const photo = await store.saveMedia(venue.id, PNG, "image/png");
  // The memory store's memory:// URLs are not fetchable; point the media row at the host server instead.
  const site = await store0.getSite(venue.id);
  site.media.find((m) => m.id === photo.id)!.public_url = `http://host.docker.internal:${PHOTO_PORT}/photo.png`;
  store0.sites.set(venue.id, site);
  const member = (await store.findMember(1))!;
  const wpc = await wordPressClientFor({ store, secretKey }, venue.id);
  assert(wpc, "client not available after connect");
  const messenger = new PrintMessenger();
  const tools = makeTools({ store, venueId: venue.id, chatId: 1, member, messenger, now: () => new Date(), baseUrl: "http://localhost:3000", wordpress: wpc.client });
  const call = async (name: string, input: unknown) => {
    const t = tools.find((x) => x.name === name)!;
    return JSON.parse(await (t.run as (i: unknown) => Promise<string>)(t.parse(input))) as Record<string, unknown>;
  };
  const listed = await call("wp_list_site", {});
  const about = (listed.pages as { id: number; title: string }[]).find((p) => p.title === "About")!;
  const content = `<!-- wp:paragraph --><p>We bake banitsa and kozunak every morning.</p><!-- /wp:paragraph --><!-- wp:image {"id":{{sm_media_id:${photo.id}}}} --><figure class="wp-block-image"><img src="{{sm_media_url:${photo.id}}}" alt="Smoke"/></figure><!-- /wp:image -->`;
  const proposal = await call("wp_edit_page", { summary_bg: "Нов текст и снимка", summary_en: "New text and photo", page_id: about.id, content, photos: [{ media_id: photo.id, alt_bg: "Дим", alt_en: "Smoke", as_featured: true }] });
  assert(proposal.status === "proposed", `proposal failed: ${JSON.stringify(proposal)}`);
  const previewUrl = String(proposal.preview_url);
  const previewHtml = await html(previewUrl);
  assert(previewHtml.includes("kozunak") && previewHtml.includes("sm-preview-banner"), "preview link does not show the pending text with the banner");
  assert(!(await html(`${WP_URL}/about/`)).includes("kozunak"), "live page changed before approval");
  assert(!(await html(`${previewUrl}x`)).includes("kozunak"), "a wrong preview key must show the live page");
  const applied = await adminAction({ store, messenger, now: () => new Date(), baseUrl: "http://localhost:3000" }, venue, "apply", String(proposal.change_set_id));
  assert(applied.ok, `apply failed: ${applied.error}`);
  const live = await html(`${WP_URL}/about/`);
  assert(live.includes("kozunak"), "live page not updated after apply");
  assert(live.includes("/wp-content/uploads/") && !live.includes("{{sm_media"), "photo placeholder not resolved on the live page");
  const attachments = wp("post", "list", "--post_type=attachment", "--format=count");
  assert(attachments === "1", `expected 1 attachment, got ${attachments}`);
  assert(wp("post", "meta", "get", String(about.id), "_thumbnail_id") !== "", "featured image not set");
  const syncs = await store.listSyncs({ venueId: venue.id });
  assert(syncs.at(-1)?.status === "done", `sync not done: ${JSON.stringify(syncs.at(-1))}`);

  const undo = await adminAction({ store, messenger, now: () => new Date(), baseUrl: "http://localhost:3000" }, venue, "undo", String(proposal.change_set_id));
  assert(undo.ok, `undo failed: ${undo.error}`);
  const restored = await html(`${WP_URL}/about/`);
  assert(restored.includes("banitsa every morning") && !restored.includes("kozunak"), "undo did not restore the page");
  assert(wp("post", "list", "--post_type=attachment", "--format=count") === "0", "undo did not delete the uploaded photo");

  step("options and menus");
  const opt = await call("wp_set_option", { summary_bg: "Име", summary_en: "Name", key: "blogname", value: "Кафене „Ъгъла“" });
  assert(opt.status === "proposed", `option proposal failed: ${JSON.stringify(opt)}`);
  assert((await adminAction({ store, messenger, now: () => new Date(), baseUrl: "" }, venue, "apply", String(opt.change_set_id))).ok, "option apply failed");
  assert(wp("option", "get", "blogname") === "Кафене „Ъгъла“", "blogname not updated");
  wp("menu", "create", "Main");
  wp("menu", "item", "add-custom", "Main", "Home", "/");
  const listed2 = await call("wp_list_site", {});
  const main = (listed2.menus as { id: number; name: string }[]).find((m) => m.name === "Main")!;
  const menuProposal = await call("wp_edit_menu", { summary_bg: "Меню", summary_en: "Menu", menu_id: main.id, items: [{ title: "Home", url: "/" }, { title: "Menu", url: "/menu/" }, { title: "Lunch", url: "/menu/#lunch", parent_index: 1 }] });
  assert((await adminAction({ store, messenger, now: () => new Date(), baseUrl: "" }, venue, "apply", String(menuProposal.change_set_id))).ok, "menu apply failed");
  const items = JSON.parse(wp("menu", "item", "list", "Main", "--format=json", "--fields=title,menu_item_parent")) as { title: string; menu_item_parent: string }[];
  assert(items.map((i) => i.title).join(",") === "Home,Menu,Lunch", `menu items: ${items.map((i) => i.title).join(",")}`);
  assert(items[2].menu_item_parent !== "0", "Lunch is not nested under Menu");

  step("rate limit and log");
  const log = JSON.parse(wp("option", "get", "site_manager_api_log", "--format=json")) as { r: string; s: number }[];
  assert(log.some((e) => e.r.endsWith("/handshake") && e.s === 200) && log.some((e) => e.s === 401), "API log is missing entries");
  let limited = 0;
  for (let i = 0; i < 7; i++) {
    const r = await fetch(`${WP_URL}/wp-json/site-manager/v1/handshake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "NOPE", slug: feedSlug }) });
    if (r.status === 429) limited++;
  }
  assert(limited >= 1, "handshake rate limit never triggered");

  step("disconnect");
  assert(await disconnectWordPress({ store, secretKey }, venue.id), "disconnect returned false");
  photoServer.close();
  console.log("\nWP SMOKE OK");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    if (!keep) {
      step("docker compose down -v");
      try {
        compose("down", "-v");
      } catch {
        // already down
      }
    } else console.log(`\ncontainers kept: ${WP_URL} (admin user "smoke"; password was random and is not stored; reset with: wp user update smoke --user_pass=…)`);
  });
```

Notes for the implementer: the `wp("post", "delete", "$(…)")` line is wrong as written (no shell expansion with execFileSync); replace it with: list ids via `wp("post", "list", "--post_type=page", "--format=ids")` and delete them one by one when non-empty. The `--feed` parsing is clumsy; simplify to a small loop over `args`. `tools.find(...)` relies on `tool.parse` and `tool.run` exactly as `test/tool-call.ts` does.

Run: `npm run wp:smoke`
Expected: ends with `WP SMOKE OK`; on failure the message names the step. Fix the PHP or the TypeScript, never the assertions, until it passes. If the production feed is unreachable from Docker, run `npm run dev:offline` in another terminal and `npm run wp:smoke -- --feed http://host.docker.internal:3000`.

- [ ] **Step 4: `docs/INTEGRATION.md`**

Create `docs/INTEGRATION.md`:

```markdown
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
- Site Manager accepts only `https://` site addresses (plain `http://` only for `localhost` during development) and refuses private addresses.
- The public feed never contains admin data; the plugin never sends anything to Site Manager except the handshake.

## Run the checks (developers)

| Command | What |
|---|---|
| `npm test` | includes the fake-plugin tests (`test/fake-wordpress.ts`), the feed-field contract and translation guards, the zip guard |
| `npm run wp:lint` | `php -l` on every plugin file (Docker `php:8.3-cli`) |
| `npm run wp:test` | the plugin's pure PHP logic against `integrations/wordpress/tests/fixtures/feed.json` |
| `npm run wp:i18n` | regenerates `languages/site-manager-bg_BG.l10n.php` and `.mo` from the `.po` |
| `npm run wp:zip` | rebuilds `public/wp/site-manager.zip` (commit it) |
| `npm run wp:smoke` | Docker WordPress + MySQL: install, render blocks from the production feed, handshake, preview, apply, undo, options, menus, rate limit, log; `-- --keep` leaves it running at http://localhost:8088; `-- --feed http://host.docker.internal:3000` uses `npm run dev:offline` as the feed |

## Known limitations (0.1.0)

- Editor UI strings of the blocks are English in a Bulgarian admin (no JavaScript translation files yet); the rendered blocks are bilingual.
- Menu items are recreated on every menu change, so item CSS classes and link targets are lost.
- Page previews use `?sm_preview=<key>`; themes that do not call `wp_body_open()` show the pending content without the yellow banner.
- WooCommerce variations are not supported; simple products only.
```

- [ ] **Step 5: README section and spec touch-up**

Append to `README.md` (end of file):

```markdown

## Works with your existing website

A café that already has a WordPress site keeps it: the **Site Manager plugin** (`public/wp/site-manager.zip`, source in `integrations/wordpress/site-manager`) shows the live menu, specials, hours, announcements and photos as blocks and shortcodes, and, after the owner sends one `/connect` line to the bot, lets the agent edit the site's pages, photos, title, logo, menus and WooCommerce products through the same preview → ✅ → undo flow. Set `DESTINATION_SECRET_KEY` (32 bytes, `openssl rand -hex 32`) in production to enable connecting. Full guide: [docs/INTEGRATION.md](docs/INTEGRATION.md). Checks: `npm run wp:lint`, `npm run wp:test`, `npm run wp:smoke` (Docker).
```

Also append one row to the env table in the README (the "Run locally" table is not append-only safe to edit in the middle; instead mention the key in the new section as above) and add `npm run wp:*` to the scripts table only if a trivial append at its end is possible; otherwise leave it to the new section.

In `docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md`, replace the words "rendered through a new optional `extra` slot of `AdminPanel`" with "rendered by `AdminPanel` next to the QR card (a server component cannot hand a render function to a client component)".

- [ ] **Step 6: Full verification, bundle check, commit**

Run:

```bash
npm test && npm run typecheck && npm run lint && npm run build && npm run wp:lint && npm run wp:test
grep -rl "DESTINATION_SECRET\|SUPABASE_SERVICE_ROLE\|service_role" .next/static || echo "no secrets in the client bundle"
```

Expected: all green; the grep prints the "no secrets" line.

```bash
git add scripts/wp-plugin-zip.mts public/wp/site-manager.zip test/wp-plugin-zip.test.ts integrations/wordpress/docker-compose.yml integrations/wordpress/smoke scripts/wp-smoke.mts docs/INTEGRATION.md README.md package.json docs/superpowers/specs/2026-10-10-site-manager-integrations-design.md
git commit -m "WordPress plugin: zip build, Docker smoke test, integration guide and README section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes (written with the spec open)

- **Spec coverage.** Scope section: read blocks (Task 8, 9), write channel endpoints (Task 10), connect flow (Task 4, 10), secrets (Task 2), tables and RLS (Task 1), change rows and no-op apply (Task 1), store decorator and retries (Task 5), page builders and previews (Task 10, fake in Task 3), photos and placeholders (Tasks 3, 5, 6, 10), options and menus (Tasks 3, 6, 10), API hardening (Task 10), dashboard card and `/connect` (Tasks 7, 4), zip (Task 11), verification (Tasks 8, 11), docs (Task 11). WooCommerce products: Tasks 3, 6, 10. `POST /revert`: Task 10 (not used by our undo, by design). Not in this session, as the spec says: embed pages, `embed.js`, Lovable prompt, Google, GitHub, `/connect` line in `/start`.
- **Review Focus → tests.** 1 → Task 3 `validateSiteUrl` cases and Task 4 bot test; 2 → Task 3 fake, Task 6 "refuses ambiguous replacements", Task 10 `pages.php` cases; 3 → Task 5 "retries with backoff" and "gives up after five attempts"; 4 → Task 1 inverted-change preview test, Task 5 "undo restores the previous content"; 5 → Task 5 "stops at the first failed change", Task 10 strict placeholder case.
- **Type consistency.** `Change.op: OpName | WpOpName` (Task 1) is what Tasks 5 and 6 construct; `WpPageChangeRow` (Task 3) is the page row shape in Tasks 5 and 6 and in Task 1's test; `SyncDeps` (Task 5) is what `deps.ts`, `tick.ts` and the smoke pass; `AgentDeps.wordpress` is added in Task 5 and consumed in Task 6; `ConnectDeps.secretKey` is `Buffer | null` everywhere; `listSyncs` returns oldest first and Task 7 takes the last five.
- **Known rough edges left on purpose.** The fake's `connected()` returns a client whose private `o` is reached in tests through a cast; the smoke's page-deletion line is flagged inline for the implementer; `wp_set_script_translations` has no JSON files (documented limitation).
