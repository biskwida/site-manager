// scripts/venue-set.mts
// npm run venue:set -- --slug coffique --change-limit 60      (sets the monthly change limit)
// npm run venue:set -- --slug coffique --change-limit none    (clears it: unlimited; with billing on, a trial or subscribed venue then follows its trial or plan limit)
// npm run venue:set -- --slug coffique --plan both --billing-status active --trial-ends 2026-11-02   (billing, 2026-10-19)
// Patches one venue's settings and prints the result. Never prints secrets: no admin token, no env values, no Stripe ids.
import { parseBillingStatusArg, parsePlanArg, parseTrialEndsArg } from "../src/billing/plans";
import { parseChangeLimit } from "../src/domain/limits";
import type { VenuePatch } from "../src/store/types";
import { makeServerDeps } from "../src/server/deps";
import { changeUsage } from "../src/store/usage";
import { parseArgs } from "./invite-lines.mts";

const USAGE = `Usage: npm run venue:set -- --slug my-cafe [--change-limit 60|none] [--plan admin|social|both|none] [--billing-status trialing|active|past_due|paused|canceled|none] [--trial-ends 2026-11-02|none]
  --change-limit    applied change sets per calendar month in the venue's time zone (undo and automatic sets do not count); none = no override (unlimited; with billing on, a free trial or a Stripe subscription follows the trial's or plan's limit)
  --plan            the venue's billing plan; none = no plan chosen
  --billing-status  the venue's billing status; none = billing does not touch the venue
  --trial-ends      when the free trial ends: an ISO date (00:00 UTC) or date and time; none = no trial end
  At least one of the four is needed.`;

const args = parseArgs(process.argv);
const slug = args.get("slug")?.trim();
const FLAGS = ["change-limit", "plan", "billing-status", "trial-ends"] as const;
if (!slug || !FLAGS.some((f) => args.has(f))) {
  console.error(USAGE);
  process.exit(1);
}
const bad = (e: Error) => {
  console.error(`${e.message}\n${USAGE}`);
  process.exit(1);
};
let limit: number | null | undefined;
if (args.has("change-limit")) {
  const v = parseChangeLimit(args.get("change-limit") ?? "");
  if (v instanceof Error) bad(v);
  else limit = v;
}
const patch: VenuePatch = {};
if (args.has("plan")) {
  const v = parsePlanArg(args.get("plan") ?? "");
  if (v instanceof Error) bad(v);
  else patch.plan = v;
}
if (args.has("billing-status")) {
  const v = parseBillingStatusArg(args.get("billing-status") ?? "");
  if (v instanceof Error) bad(v);
  else patch.billing_status = v;
}
if (args.has("trial-ends")) {
  const v = parseTrialEndsArg(args.get("trial-ends") ?? "");
  if (v instanceof Error) bad(v);
  else patch.trial_ends_at = v;
}

// The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}"; nothing changed.`);
  process.exit(1);
}
const before = venue;
let updated = venue;
if (limit !== undefined) updated = await deps.store.setChangeLimit(venue.id, limit);
if (Object.keys(patch).length) updated = await deps.store.updateVenue(venue.id, patch);
const show = (l: number | null) => (l === null ? "unlimited" : `${l} per month`);
console.log(`venue ${updated.slug} (${updated.id})${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}`);
if (limit !== undefined) {
  const usage = await changeUsage(deps.store, updated, new Date());
  console.log(`change limit: ${show(before.change_limit)} -> ${show(updated.change_limit)} (months in ${updated.tz})`);
  console.log(`this month:   ${usage.used} applied${usage.limit === null ? "" : ` of ${usage.limit}${usage.reached ? " (limit reached)" : ""}`}; the count restarts on ${usage.resets_on}`);
}
const dash = (v: string | null) => v ?? "-";
if ("plan" in patch) console.log(`plan:           ${dash(before.plan)} -> ${dash(updated.plan)}`);
if ("billing_status" in patch) console.log(`billing status: ${dash(before.billing_status)} -> ${dash(updated.billing_status)}`);
if ("trial_ends_at" in patch) console.log(`trial ends:     ${dash(before.trial_ends_at)} -> ${dash(updated.trial_ends_at)}`);
