// scripts/slugs-check.mts
// npm run slugs:check — read-only. Lists live venues whose slug is in the reserved list, so a newly reserved word
// (start, login, dashboard, ...) can be dealt with before it shadows a venue page. Changes nothing.
import { RESERVED_SLUGS } from "../src/wizard/schema";
import { makeServerDeps } from "../src/server/deps";

// The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
if (deps.isMemory) console.log("[MEMORY store: only the seeded demo venue exists here; set the Supabase keys to check real venues]");
const clashes = (await deps.store.listVenues({ status: "live" })).filter((v) => RESERVED_SLUGS.includes(v.slug));
if (!clashes.length) {
  console.log(`No live venue uses a reserved slug (${RESERVED_SLUGS.length} reserved).`);
} else {
  console.log(`${clashes.length} live venue(s) use a reserved slug:`);
  for (const v of clashes) console.log(`  ${v.slug}  (${v.name})`);
  process.exitCode = 1;
}
// The Supabase client can keep the process open.
process.exit(process.exitCode ?? 0);
