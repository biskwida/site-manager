// scripts/venue-create.mts
// npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg [--seed demo] [--tz Europe/Sofia]
// Prints the owner invite code, a staff invite code and the admin link ONCE. Keep them.
import { INVITE_TTL_MS } from "../src/bot/bot";
import { seedDemo } from "../src/seed/demo";
import { makeServerDeps } from "../src/server/deps";

const USAGE = `Usage: npm run venue:create -- --name "Name" --slug my-cafe [--lang bg|en] [--tz Europe/Sofia] [--seed demo]
  --seed demo  creates the demo café (menu, texts, hours); the demo's own name and language are used, --name/--lang are ignored (and optional)`;

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");
const slug = args.get("slug")?.trim();
const name = args.get("name")?.trim();
const seedDemoMenu = args.get("seed") === "demo";
if (!slug || (!name && !seedDemoMenu)) {
  console.error(USAGE);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error(`slug "${slug}" must be lowercase letters, digits and dashes (2-41 chars)\n${USAGE}`);
  process.exit(1);
}
if (args.has("seed") && !seedDemoMenu) {
  console.error(`unknown --seed "${args.get("seed")}" (only "demo")\n${USAGE}`);
  process.exit(1);
}
const lang = args.get("lang") === "en" ? "en" : "bg";

const deps = await makeServerDeps({ defer: (fn) => void fn() });
if (await deps.store.getVenueBySlug(slug)) {
  console.error(`slug "${slug}" already exists. To wipe the demo venue's content and re-seed it, run: npm run demo:reset`);
  process.exit(1);
}
if (seedDemoMenu) console.log(`--seed demo: using the demo venue's name and language (--name/--lang ignored)`);
const venue = seedDemoMenu
  ? (await seedDemo(deps.store, slug)).venue
  : await deps.store.createVenue({ slug, name: name as string, default_lang: lang, tz: args.get("tz") || "Europe/Sofia" });

const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
const owner = await deps.store.createInvite(venue.id, "owner", expires);
const staff = await deps.store.createInvite(venue.id, "staff", expires);
const token = await deps.store.getAdminToken(venue.id);
console.log(`venue ${venue.slug} created (${venue.id})${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}`);
console.log(`site:        ${deps.config.publicBaseUrl}/${venue.slug}`);
console.log(`admin link:  ${deps.config.publicBaseUrl}/admin/${venue.slug}?key=${token}`);
console.log(`owner code:  /start ${owner}   (valid 7 days, one use)`);
console.log(`staff code:  /start ${staff}   (valid 7 days, one use)`);
console.log("These codes and the admin link are shown once. Keep them out of git and chat logs.");
