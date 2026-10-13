// scripts/venue-set.mts
// npm run venue:set -- --slug coffique --change-limit 60      (sets the monthly change limit)
// npm run venue:set -- --slug coffique --change-limit none    (clears it: unlimited)
// Patches one venue setting and prints the result. Never prints secrets: no admin token, no env values.
import { parseChangeLimit } from "../src/domain/limits";
import { makeServerDeps } from "../src/server/deps";
import { changeUsage } from "../src/store/usage";
import { parseArgs } from "./invite-lines.mts";

const USAGE = `Usage: npm run venue:set -- --slug my-cafe --change-limit 60|none
  --change-limit  applied change sets per calendar month in the venue's time zone (undo and automatic sets do not count); none = unlimited`;

const args = parseArgs(process.argv);
const slug = args.get("slug")?.trim();
if (!slug || !args.has("change-limit")) {
  console.error(USAGE);
  process.exit(1);
}
const limit = parseChangeLimit(args.get("change-limit") ?? "");
if (limit instanceof Error) {
  console.error(`${limit.message}\n${USAGE}`);
  process.exit(1);
}

// The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}"; nothing changed.`);
  process.exit(1);
}
const before = venue.change_limit;
const updated = await deps.store.setChangeLimit(venue.id, limit);
const usage = await changeUsage(deps.store, updated, new Date());
const show = (l: number | null) => (l === null ? "unlimited" : `${l} per month`);
console.log(`venue ${updated.slug} (${updated.id})${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}`);
console.log(`change limit: ${show(before)} -> ${show(updated.change_limit)} (months in ${updated.tz})`);
console.log(`this month:   ${usage.used} applied${usage.limit === null ? "" : ` of ${usage.limit}${usage.reached ? " (limit reached)" : ""}`}; the count restarts on ${usage.resets_on}`);
