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
import type { Messenger } from "../src/bot/messenger";

const COMPOSE = resolve(process.cwd(), "integrations/wordpress/docker-compose.yml");
const WP_URL = "http://localhost:8088";
const args = process.argv.slice(2);
let keep = false;
let feedBase = process.env.WP_SMOKE_FEED ?? "https://site-manager-lovat.vercel.app";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--keep") keep = true;
  else if (args[i] === "--feed" && args[i + 1]) feedBase = args[++i];
}
feedBase = feedBase.replace(/\/+$/, "");
const feedSlug = process.env.WP_SMOKE_SLUG ?? "agala";
// WordPress's wp_http_validate_url() accepts an external host only on ports 80, 443 and 8080.
const PHOTO_PORT = 8080;
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

let photoServer: ReturnType<typeof createServer> | null = null;

class PrintMessenger implements Messenger {
  private n = 1;
  async send(_c: number, text: string) {
    console.log(`  [bot] ${text.split("\n")[0]}`);
    return this.n++;
  }
  async sendProposal(_c: number, text: string) {
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
  // Idempotent against containers kept by --keep: drop earlier pages, attachments and the smoke menu.
  for (const type of ["page", "attachment"]) {
    const old = wp("post", "list", `--post_type=${type}`, "--post_status=any", "--format=ids");
    for (const id of old.split(/\s+/).filter(Boolean)) wp("post", "delete", id, "--force");
  }
  try {
    wp("menu", "delete", "Main");
  } catch {
    // no menu from an earlier run
  }
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
  photoServer = createServer((_req, res) => {
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
  const pushed = ((syncs.at(-1)?.result?.pushed ?? []) as { entity: string; revision_id?: unknown }[]).find((p) => p.entity === "wp_page");
  const revisionId = pushed?.revision_id;
  console.log(`  apply returned revision_id ${JSON.stringify(revisionId ?? null)} for the About page`);

  const undo = await adminAction({ store, messenger, now: () => new Date(), baseUrl: "http://localhost:3000" }, venue, "undo", String(proposal.change_set_id));
  assert(undo.ok, `undo failed: ${undo.error}`);
  const restored = await html(`${WP_URL}/about/`);
  assert(restored.includes("banitsa every morning") && !restored.includes("kozunak"), "undo did not restore the page");
  assert(wp("post", "list", "--post_type=attachment", "--format=count") === "0", "undo did not delete the uploaded photo");

  if (typeof revisionId === "number" && Number.isInteger(revisionId) && revisionId > 0) {
    step("revert route: restores the pre-edit revision returned by apply");
    // client.revert throws WordPressApiError on anything but 200 and returns the route's JSON.
    const rev = await wpc.client.revert(about.id, revisionId);
    assert(rev.restored_revision === revisionId, `revert answered without restored_revision: ${JSON.stringify(rev)}`);
    const afterRevert = await html(`${WP_URL}/about/`);
    assert(afterRevert.includes("banitsa every morning") && !afterRevert.includes("kozunak"), "revert did not leave the original text in place");
  } else {
    console.log("  (revert route not exercised: apply returned no positive revision_id)");
  }

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
  console.log("\nWP SMOKE OK");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => {
    photoServer?.close(); // also on failure, or the process never exits
    if (!keep) {
      step("docker compose down -v");
      try {
        compose("down", "-v");
      } catch {
        // already down
      }
    } else console.log(`\ncontainers kept: ${WP_URL} (admin user "smoke"; password was random and is not stored; reset with: wp user update smoke --user_pass=…)`);
  });
