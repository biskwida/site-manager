// scripts/invite-create.mts
// npm run invite:create -- --slug coffique [--role owner|staff] [--site-url https://…]
// A one-use invite for an existing venue: reuses the open invite for that role, or creates one valid 7 days. With --site-url the
// venue's own site is set first, so the owner's join creates no Vercel project. Prints the code ONCE. Keep it.
import { makeServerDeps } from "../src/server/deps";
import { inviteLines, parseArgs, parseSiteUrl, prepareInvite } from "./invite-lines.mts";

const USAGE = `Usage: npm run invite:create -- --slug my-cafe [--role owner|staff] [--site-url https://…]
  --role      owner (default) or staff
  --site-url  sets the venue's own site, built and hosted elsewhere, that reads /api/site/<slug> (https only): no Vercel project is ever created for it`;

const args = parseArgs(process.argv);
const slug = args.get("slug")?.trim();
const roleArg = args.get("role") ?? "owner";
if (!slug) {
  console.error(USAGE);
  process.exit(1);
}
if (roleArg !== "owner" && roleArg !== "staff") {
  console.error(`unknown --role "${roleArg}" (only "owner" or "staff")\n${USAGE}`);
  process.exit(1);
}
const siteUrl = args.has("site-url") ? parseSiteUrl(args.get("site-url") ?? "") : null;
if (args.has("site-url") && !siteUrl) {
  console.error(`--site-url "${args.get("site-url")}" must be an https URL like https://my-cafe.example.com\n${USAGE}`);
  process.exit(1);
}

const deps = await makeServerDeps({ defer: (fn) => void fn() });
const r = await prepareInvite(deps.store, { slug, role: roleArg, siteUrl: siteUrl ?? undefined, now: new Date() });
if (!r.ok) {
  console.error(`${r.error}. Create it first with: npm run venue:create`);
  process.exit(1);
}
const { venue } = r;
console.log(`venue ${venue.slug} (${venue.id})${deps.isMemory ? " in the MEMORY store (lost on exit)" : ""}`);
if (venue.site_mode === "own" && venue.site_url) {
  console.log(`own site:    ${venue.site_url}   (reads ${deps.config.publicBaseUrl}/api/site/${venue.slug}; no Vercel project is created)`);
  if (venue.deploy) console.log(`note: an earlier template deploy (${venue.deploy.provider} ${venue.deploy.project_id || "no project"}) stays where it is; the dashboard no longer shows it.`);
} else if (venue.site_mode === "none") console.log("site:        none (social media only; no Vercel project is created)");
else console.log(`site:        ${deps.config.publicBaseUrl}/${venue.slug}`);
const note = r.reused ? "the open invite, reused; one use" : "valid 7 days, one use";
for (const line of inviteLines(deps.config, [{ role: roleArg, code: r.code, note }])) console.log(line);
console.log("This code links a chat to the venue and is shown once. Keep it out of git and chat logs.");
