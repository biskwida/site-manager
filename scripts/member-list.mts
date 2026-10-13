// scripts/member-list.mts
// npm run member:list -- --slug coffique
// Prints who can manage the venue from a chat (role, channel, masked id, language, last seen, joined) and its open invite codes
// (role, expiry, last 4 characters). Never prints a whole code, a WhatsApp number or the admin key.
import { memberListLines, parseFlags } from "../src/server/access";
import { makeServerDeps } from "../src/server/deps";

const slug = parseFlags(process.argv).get("slug");
if (!slug) {
  console.error("Usage: npm run member:list -- --slug my-cafe");
  process.exit(1);
}
// The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}".`);
  process.exit(1);
}
if (deps.isMemory) console.log("[MEMORY store: only the seeded demo venue exists here; set the Supabase keys to see real venues]");
for (const line of await memberListLines(deps.store, venue, new Date())) console.log(line);
