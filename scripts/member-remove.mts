// scripts/member-remove.mts
// npm run member:remove -- --slug coffique --ref tg:123456      (WhatsApp: the full wa:<digits>, or wa:…3456 as member:list shows it)
// Unlinks one chat from the venue. The bot then treats that chat as a stranger. To let them back in, they need a new invite code.
import { parseFlags, removeMemberByRef } from "../src/server/access";
import { makeServerDeps } from "../src/server/deps";

const args = parseFlags(process.argv);
const slug = args.get("slug");
const ref = args.get("ref");
if (!slug || !ref) {
  console.error("Usage: npm run member:remove -- --slug my-cafe --ref tg:123456   (see the refs with: npm run member:list -- --slug my-cafe)");
  process.exit(1);
}
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}"; nothing removed.`);
  process.exit(1);
}
const r = await removeMemberByRef(deps.store, venue, ref);
if (!r.ok) {
  console.error(r.message);
  process.exit(1);
}
console.log(r.message + (deps.isMemory ? "\n[MEMORY store: this change is lost on exit]" : ""));
