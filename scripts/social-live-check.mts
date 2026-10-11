// scripts/social-live-check.mts
// Publishes one photo to a REAL Instagram professional account through our own code (social_post tool → proposal →
// dashboard approval → Instagram adapter), with the in-memory store. The photo is uploaded to the Supabase "media" bucket
// first so Instagram can fetch it. Needs in the env file: IG_TEST_TOKEN (Instagram Login user token with
// instagram_business_content_publish), NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Prints the published links.
// Run: npx tsx --env-file=<.env.local> scripts/social-live-check.mts --photo <jpg> --target instagram_post|instagram_story [--caption "…"]
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { makeTools } from "../src/agent/tools";
import type { Messenger } from "../src/bot/messenger";
import { DEV_SECRET_KEY_HEX, encryptSecrets, parseSecretKey } from "../src/destinations/secrets";
import { withDestinationSync } from "../src/destinations/store-hook";
import { syncLines } from "../src/destinations/sync";
import { seedDemo } from "../src/seed/demo";
import { adminAction } from "../src/server/admin";
import { InMemoryStore } from "../src/store/memory";

const args = process.argv.slice(2);
let photo = "";
let target = "";
let caption = "";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--photo" && args[i + 1]) photo = args[++i];
  else if (args[i] === "--target" && args[i + 1]) target = args[++i];
  else if (args[i] === "--caption" && args[i + 1]) caption = args[++i];
}
if (!photo || !["instagram_post", "instagram_story"].includes(target)) {
  console.error('Usage: … --photo <jpg> --target instagram_post|instagram_story [--caption "…"]');
  process.exit(2);
}
const token = process.env.IG_TEST_TOKEN ?? "";
if (!token) throw new Error("IG_TEST_TOKEN is missing");

class PrintMessenger implements Messenger {
  private n = 1;
  async send(_r: string, text: string) {
    console.log(`  [bot] ${text.replace(/\n/g, " | ")}`);
    return String(this.n++);
  }
  async sendProposal(_r: string, text: string) {
    console.log(`  [bot proposal] ${text.replace(/\n/g, " | ")}`);
    return String(this.n++);
  }
  async conclude(_r: string, _m: string | null, full: string) {
    console.log(`  [bot] ${full.replace(/\n/g, " | ")}`);
  }
  async typing() {}
}

async function main() {
  const me = (await (await fetch(`https://graph.instagram.com/v25.0/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(token)}`)).json()) as { user_id?: string; username?: string; account_type?: string; error?: { message?: string } };
  if (!me.user_id) throw new Error(`token check failed: ${me.error?.message ?? "no user_id"}`);
  console.log(`== Instagram account @${me.username} (${me.account_type})`);

  console.log("== upload the photo to public storage");
  const bytes = await readFile(photo);
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const path = `social-test/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("media").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  const publicUrl = db.storage.from("media").getPublicUrl(path).data.publicUrl;
  console.log(`  ${publicUrl}`);

  const store0 = new InMemoryStore();
  const { venue } = await seedDemo(store0, "agala");
  await store0.upsertMember({ venue_id: venue.id, chat_ref: "tg:1", role: "owner", lang: "bg" } as never);
  const secretKey = parseSecretKey(DEV_SECRET_KEY_HEX);
  const nowIso = new Date().toISOString();
  await store0.upsertDestination({ venue_id: venue.id, kind: "instagram", config: { ig_user_id: String(me.user_id), username: me.username, connected_at: nowIso, token_refreshed_at: nowIso }, secrets: encryptSecrets({ token }, secretKey) });
  const media = await store0.saveMedia(venue.id, new Uint8Array(bytes), "image/jpeg");
  const site = await store0.getSite(venue.id);
  const row = site.media.find((m) => m.id === media.id)!;
  row.public_url = publicUrl;
  row.storage_path = path;
  store0.sites.set(venue.id, site);

  const store = withDestinationSync(store0, { store: store0, secretKey, log: (s: string) => console.log(`  ${s}`) });
  const messenger = new PrintMessenger();
  const member = (await store.findMember("tg:1" as never))!;
  const tools = makeTools({ store, venueId: venue.id, chatRef: "tg:1", member, messenger, now: () => new Date(), baseUrl: "http://localhost:3000", social: { facebook: false, instagram: true } } as never);
  const tool = tools.find((t) => t.name === "social_post");
  if (!tool) throw new Error("social_post tool not registered");

  console.log(`== propose: ${target}`);
  const r = JSON.parse(await (tool.run as (i: unknown) => Promise<string>)(tool.parse({ summary_bg: "Тест: публикация в Instagram", summary_en: "Test: Instagram post", media_id: media.id, caption, targets: [target] }))) as Record<string, unknown>;
  if (r.status !== "proposed") throw new Error(`proposal failed: ${JSON.stringify(r)}`);

  console.log("== approve (dashboard) and publish");
  const applied = await adminAction({ store, messenger, now: () => new Date(), baseUrl: "" }, venue, "apply", String(r.change_set_id));
  if (!applied.ok) throw new Error(`apply failed: ${applied.error}`);
  console.log(`  ${(await syncLines(store, String(r.change_set_id), "bg")).join(" | ")}`);
  const rows = await store.listSyncs({ changeSetId: String(r.change_set_id) });
  for (const s of rows) console.log(`  sync ${s.status}: ${JSON.stringify(s.result)}${s.last_error ? ` error=${s.last_error}` : ""}`);
  if (rows.some((s) => s.status !== "done")) process.exitCode = 1;
  else console.log("\nSOCIAL LIVE CHECK OK");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
