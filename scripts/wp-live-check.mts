// scripts/wp-live-check.mts
// Checks the WordPress plugin on a REAL, public WordPress site (real HTTPS, DNS, hosting and caches) through our own
// code with an in-memory store: connect → read side → preview link → apply → undo → tagline change and undo → disconnect.
// It changes only the test page and the tagline, and undoes both. Prints WP LIVE CHECK OK.
//
// Prepare the site (a throwaway one, e.g. a free TasteWP or InstaWP site):
//   1. Upload public/wp/site-manager.zip under Plugins → Add New → Upload Plugin and activate it.
//   2. Settings → Site Manager: address https://site-manager-lovat.vercel.app, venue code agala, Save.
//   3. Create a published page titled "Site Manager test" with exactly this paragraph and shortcode:
//        Site Manager test: we bake banitsa every morning.
//        [site_manager_menu]
//   4. Settings → Site Manager → Generate code (valid 15 minutes).
// Run:  npm run wp:live -- --site https://your-site.example --code ABCDEFGHJK [--page "Site Manager test"]
import { makeTools } from "../src/agent/tools";
import type { Messenger } from "../src/bot/messenger";
import { connectWordPress, disconnectWordPress, wordPressClientFor } from "../src/destinations/connect";
import { DEV_SECRET_KEY_HEX, parseSecretKey } from "../src/destinations/secrets";
import { withDestinationSync } from "../src/destinations/store-hook";
import { syncLines } from "../src/destinations/sync";
import { seedDemo } from "../src/seed/demo";
import { adminAction } from "../src/server/admin";
import { InMemoryStore } from "../src/store/memory";

const args = process.argv.slice(2);
let site = "";
let code = "";
let pageTitle = "Site Manager test";
let allowLocal = false; // only for checking this script against the Docker WordPress (http://localhost:8088)
const slug = process.env.WP_LIVE_SLUG ?? "agala";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--site" && args[i + 1]) site = args[++i];
  else if (args[i] === "--code" && args[i + 1]) code = args[++i];
  else if (args[i] === "--page" && args[i + 1]) pageTitle = args[++i];
  else if (args[i] === "--allow-local") allowLocal = true;
}
if (!site || !code) {
  console.error('Usage: npm run wp:live -- --site https://your-site.example --code ABCDEFGHJK [--page "Site Manager test"]');
  process.exit(2);
}

const ANCHOR = "banitsa every morning";
const CHANGED = "banitsa and kozunak every morning";
const step = (s: string) => console.log(`\n== ${s}`);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`LIVE CHECK FAIL: ${msg}`);
}
/** Fetches a page past page caches (unique query string, no-cache headers). */
async function html(url: string): Promise<string> {
  const u = new URL(url);
  u.searchParams.set("sm_nocache", String(Date.now()));
  const res = await fetch(u, { headers: { accept: "text/html", "cache-control": "no-cache", pragma: "no-cache" } });
  return res.text();
}
/** Some hosts cache pages for a few seconds even past a query string: retry a check for up to ~30 s. */
async function eventually(url: string, ok: (body: string) => boolean): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    if (ok(await html(url))) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

class PrintMessenger implements Messenger {
  private n = 1;
  async send(_c: string, text: string) {
    console.log(`  [bot] ${text.split("\n")[0]}`);
    return String(this.n++);
  }
  async sendProposal(_c: string, text: string) {
    console.log(`  [bot proposal] ${text.replace(/\n/g, " | ")}`);
    return String(this.n++);
  }
  async conclude(_c: string, _m: string | null, full: string) {
    console.log(`  [bot edit] ${full.replace(/\n/g, " | ")}`);
  }
  async typing() {}
}

async function main() {
  const store0 = new InMemoryStore();
  const { venue } = await seedDemo(store0, slug);
  await store0.upsertMember({ venue_id: venue.id, chat_ref: "tg:1", role: "owner", lang: "bg" });
  const secretKey = parseSecretKey(DEV_SECRET_KEY_HEX);
  const store = withDestinationSync(store0, { store: store0, secretKey, log: (s: string) => console.log(`  ${s}`) });
  const messenger = new PrintMessenger();
  const admin = { store, messenger, now: () => new Date(), baseUrl: "http://localhost:3000" };

  step(`connect to ${site}${allowLocal ? " (local host allowed)" : " (real DNS check, no local hosts)"}`);
  const conn = await connectWordPress({ store, secretKey, allowLocal }, venue.id, site, code);
  assert(conn.ok, `connect refused: ${conn.ok ? "" : conn.reason.en}`);
  console.log(`  connected to "${conn.site.name}" (WordPress ${conn.site.wp_version}, plugin ${conn.site.plugin_version}, theme ${conn.site.theme.name})`);
  const wpc = await wordPressClientFor({ store, secretKey }, venue.id);
  assert(wpc, "no client after connect");

  try {
    const member = (await store.findMember("tg:1"))!;
    const tools = makeTools({ store, venueId: venue.id, chatRef: "tg:1", member, messenger, now: () => new Date(), baseUrl: "http://localhost:3000", wordpress: wpc.client });
    const call = async (name: string, input: unknown) => {
      const t = tools.find((x) => x.name === name)!;
      return JSON.parse(await (t.run as (i: unknown) => Promise<string>)(t.parse(input))) as Record<string, unknown>;
    };

    step(`find the page "${pageTitle}"`);
    const listed = await call("wp_list_site", {});
    assert(!listed.error, `wp_list_site: ${String(listed.error)}`);
    const pages = listed.pages as { id: number; title: string; url: string; builder: string; status: string }[];
    const page = pages.find((p) => p.title.trim().toLowerCase() === pageTitle.toLowerCase());
    assert(page, `no page titled "${pageTitle}"; pages: ${pages.map((p) => p.title).join(", ")}`);
    assert(page.status === "publish", `the test page must be published (it is "${page.status}")`);
    console.log(`  page ${page.id} at ${page.url} (${page.builder})`);

    step("read side: the menu shortcode renders from the Site Manager feed");
    const live0 = await html(page.url);
    if (live0.includes('class="sm sm-menu"')) console.log("  menu block rendered");
    else console.log("  WARNING: no menu block on the page (is [site_manager_menu] on it and are the plugin settings saved?)");
    assert(live0.includes(ANCHOR), `the page does not contain "${ANCHOR}"; put the test paragraph on it`);

    step("propose a text change and open the preview link");
    const proposal = await call("wp_edit_page", { summary_bg: "Тест: козунак", summary_en: "Test: kozunak", page_id: page.id, replacements: [{ find: ANCHOR, replace: CHANGED }] });
    assert(proposal.status === "proposed", `proposal failed: ${JSON.stringify(proposal)}`);
    const previewUrl = proposal.preview_url ? String(proposal.preview_url) : null;
    if (previewUrl) {
      const preview = await html(previewUrl);
      assert(preview.includes(CHANGED), "the preview link does not show the pending text");
      console.log(`  preview shows the change${preview.includes("sm-preview-banner") ? " with the banner" : " (no banner: the theme does not call wp_body_open)"}`);
    } else console.log("  no preview link (Elementor page): the Telegram preview shows the change instead");
    assert(!(await html(page.url)).includes(CHANGED), "the live page changed before approval");

    step("approve: push to WordPress");
    const applied = await adminAction(admin, venue, "apply", String(proposal.change_set_id));
    assert(applied.ok, `apply failed: ${applied.error}`);
    console.log(`  ${(await syncLines(store, String(proposal.change_set_id), "bg")).join(" | ")}`);
    assert(await eventually(page.url, (b) => b.includes(CHANGED)), "the live page does not show the change after approval (a page cache may hold it longer)");
    console.log("  live page updated");

    step("undo");
    const undo = await adminAction(admin, venue, "undo", String(proposal.change_set_id));
    assert(undo.ok, `undo failed: ${undo.error}`);
    assert(await eventually(page.url, (b) => b.includes(ANCHOR) && !b.includes(CHANGED)), "undo did not restore the page");
    console.log("  page restored");

    step("tagline change and undo");
    const before = await wpc.client.options();
    const opt = await call("wp_set_option", { summary_bg: "Тест: слоган", summary_en: "Test: tagline", key: "blogdescription", value: `${before.blogdescription} · Site Manager test` });
    assert(opt.status === "proposed", `tagline proposal failed: ${JSON.stringify(opt)}`);
    assert((await adminAction(admin, venue, "apply", String(opt.change_set_id))).ok, "tagline apply failed");
    assert((await wpc.client.options()).blogdescription.endsWith("· Site Manager test"), "tagline not changed");
    assert((await adminAction(admin, venue, "undo", String(opt.change_set_id))).ok, "tagline undo failed");
    assert((await wpc.client.options()).blogdescription === before.blogdescription, "tagline not restored");
    console.log("  tagline changed and restored");

    const failedSyncs = (await store.listSyncs({ venueId: venue.id })).filter((s) => s.status !== "done");
    assert(failedSyncs.length === 0, `some pushes did not finish: ${failedSyncs.map((s) => s.last_error).join("; ")}`);
  } finally {
    step("disconnect (our side; press Disconnect on the plugin's settings page too)");
    await disconnectWordPress({ store, secretKey }, venue.id);
  }
  console.log("\nWP LIVE CHECK OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
