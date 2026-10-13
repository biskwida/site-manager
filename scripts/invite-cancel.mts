// scripts/invite-cancel.mts
// npm run invite:cancel -- --slug coffique [--role owner|staff]
// Deletes the venue's unused invite codes (all roles unless --role), so a code that leaked can no longer link a chat. Members stay linked.
import { cancelInviteCodes, parseFlags, parseRole } from "../src/server/access";
import { makeServerDeps } from "../src/server/deps";

const USAGE = "Usage: npm run invite:cancel -- --slug my-cafe [--role owner|staff]";
const args = parseFlags(process.argv);
const slug = args.get("slug");
const role = parseRole(args.get("role"));
if (!slug || role === null) {
  console.error(role === null ? `--role must be owner or staff\n${USAGE}` : USAGE);
  process.exit(1);
}
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}"; nothing cancelled.`);
  process.exit(1);
}
console.log(await cancelInviteCodes(deps.store, venue, role) + (deps.isMemory ? " [MEMORY store: lost on exit]" : ""));
