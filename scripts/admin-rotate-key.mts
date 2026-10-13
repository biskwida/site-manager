// scripts/admin-rotate-key.mts
// npm run admin:rotate-key -- --slug coffique
// Replaces the dashboard key: the old /admin link stops working at once. Prints the new admin link ONCE. Keep it.
// The owner can also get the new link from the bot (/menu).
import { adminUrl } from "../src/bot/links";
import { parseFlags } from "../src/server/access";
import { makeServerDeps } from "../src/server/deps";

const slug = parseFlags(process.argv).get("slug");
if (!slug) {
  console.error("Usage: npm run admin:rotate-key -- --slug my-cafe");
  process.exit(1);
}
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}"; no key changed.`);
  process.exit(1);
}
const token = await deps.store.rotateAdminToken(venue.id);
console.log(`dashboard key for ${venue.slug} replaced${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}; the old link no longer opens the dashboard.`);
console.log(`admin link:  ${adminUrl(deps.config.publicBaseUrl, venue.slug, token)}`);
console.log("This admin link is shown once. Keep it out of git and chat logs.");
