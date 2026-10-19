// scripts/venue-create.mts
// npm run venue:create -- --name "Кафене „Ъгъла“" --slug agala --lang bg [--seed demo|coffique] [--tz Europe/Sofia] [--site-url https://…] [--site-mode claudia|own|none] [--change-limit 60]
// Prints the owner invite code, a staff invite code and the admin link ONCE. Keep them.
import { INVITE_TTL_MS } from "../src/bot/links";
import { parseChangeLimit } from "../src/domain/limits";
import { seedCoffique } from "../src/seed/coffique";
import { seedDemo } from "../src/seed/demo";
import { makeServerDeps } from "../src/server/deps";
import { inviteLines, parseArgs, parseSiteUrl, resolveSiteMode, siteLines } from "./invite-lines.mts";

const USAGE = `Usage: npm run venue:create -- --name "Name" --slug my-cafe [--lang bg|en] [--tz Europe/Sofia] [--seed demo|coffique] [--site-url https://…] [--site-mode claudia|own|none] [--change-limit 60|none]
  --change-limit   applied changes per calendar month (Menu plan 40, Everywhere plan 150); default none = unlimited
  --seed demo      creates the demo café (menu, texts, hours); the demo's own name and language are used, --name/--lang are ignored (and optional)
  --seed coffique  creates Coffique (real menu, texts, hours); its own name and language are used, --name/--lang are ignored (and optional)
  --site-url       the venue's own site, built and hosted elsewhere, that reads /api/site/<slug> (https only): no Vercel project is ever created for it
  --site-mode      claudia (default: Claudia builds the site) | own (needs --site-url; implied when only --site-url is given) | none (social media only, no website)`;

const SEEDS = { demo: seedDemo, coffique: seedCoffique } as const;
type SeedName = keyof typeof SEEDS;

const args = parseArgs(process.argv);
const slug = args.get("slug")?.trim();
const name = args.get("name")?.trim();
const seedArg = args.get("seed");
const seed: SeedName | null = seedArg !== undefined && Object.hasOwn(SEEDS, seedArg) ? (seedArg as SeedName) : null;
if (!slug || (!name && !seed)) {
  console.error(USAGE);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) {
  console.error(`slug "${slug}" must be lowercase letters, digits and dashes (2-41 chars)\n${USAGE}`);
  process.exit(1);
}
if (args.has("seed") && !seed) {
  console.error(`unknown --seed "${seedArg}" (only "demo" or "coffique")\n${USAGE}`);
  process.exit(1);
}
const siteUrl = args.has("site-url") ? parseSiteUrl(args.get("site-url") ?? "") : null;
if (args.has("site-url") && !siteUrl) {
  console.error(`--site-url "${args.get("site-url")}" must be an https URL like https://my-cafe.example.com\n${USAGE}`);
  process.exit(1);
}
const siteModeResult = resolveSiteMode(args.has("site-mode") ? (args.get("site-mode") ?? "") : undefined, siteUrl);
if (!siteModeResult.ok) {
  console.error(`${siteModeResult.error}\n${USAGE}`);
  process.exit(1);
}
const siteMode = siteModeResult.mode;
const lang = args.get("lang") === "en" ? "en" : "bg";
const changeLimit = args.has("change-limit") ? parseChangeLimit(args.get("change-limit") ?? "") : null;
if (changeLimit instanceof Error) {
  console.error(`${changeLimit.message}\n${USAGE}`);
  process.exit(1);
}

const deps = await makeServerDeps({ defer: (fn) => void fn() });
if (await deps.store.getVenueBySlug(slug)) {
  console.error(`slug "${slug}" already exists. To wipe the demo venue's content and re-seed it, run: npm run demo:reset`);
  process.exit(1);
}
if (seed) console.log(`--seed ${seed}: using the seed venue's name and language (--name/--lang ignored)`);
const created = seed
  ? (await SEEDS[seed](deps.store, slug)).venue
  : await deps.store.createVenue({ slug, name: name as string, default_lang: lang, tz: args.get("tz") || "Europe/Sofia", site_mode: siteMode, ...(siteUrl ? { site_url: siteUrl } : {}) });
// Set before any invite exists, so the first owner join already skips the deploy.
const venue = seed && siteMode !== "claudia" ? await deps.store.updateVenue(created.id, { site_mode: siteMode, ...(siteUrl ? { site_url: siteUrl } : {}) }) : created;
if (changeLimit !== null) await deps.store.setChangeLimit(venue.id, changeLimit);

const expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
const owner = await deps.store.createInvite(venue.id, "owner", expires);
const staff = await deps.store.createInvite(venue.id, "staff", expires);
const token = await deps.store.getAdminToken(venue.id);
console.log(`venue ${venue.slug} created (${venue.id})${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}`);
for (const line of siteLines(venue, deps.config.publicBaseUrl)) console.log(line);
console.log(`change limit: ${changeLimit === null ? "unlimited" : `${changeLimit} per month`} (change it with npm run venue:set)`);
console.log(`admin link:  ${deps.config.publicBaseUrl}/admin/${venue.slug}?key=${token}`);
const note = "valid 7 days, one use";
for (const line of inviteLines(deps.config, [{ role: "owner", code: owner, note }, { role: "staff", code: staff, note }])) console.log(line);
console.log("These codes and the admin link are shown once. Keep them out of git and chat logs.");
