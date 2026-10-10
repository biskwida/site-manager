// scripts/site-delete.mts
// npm run site:delete [-- --slug my-cafe]
// Deletes a venue (typically one created by the wizard) and its provider project. Asks for the slug, prints what will go,
// asks for the slug again. Storage objects under media/<venue id>/ are not removed (see cleanup-test-venues.mts for the pattern).
// Never prints secrets: no admin token, no invite codes, no env values.
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { makeServerDeps } from "../src/server/deps";

const i = process.argv.indexOf("--slug");
const slugArg = i > 0 ? (process.argv[i + 1] ?? "") : "";
const rl = createInterface({ input: stdin, output: stdout });
// Read answers through the line iterator, not rl.question: it buffers lines, so piped input (and EOF) behave like typing.
const lines = rl[Symbol.asyncIterator]();
async function ask(q: string): Promise<string> {
  stdout.write(q);
  const r = await lines.next();
  return r.done ? "" : String(r.value);
}

const slug = (slugArg || (await ask("Slug of the site to delete: "))).trim();
if (!slug) {
  rl.close();
  console.error("No slug given; nothing deleted.");
  process.exit(1);
}
// The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  rl.close();
  console.error(`No venue "${slug}"; nothing deleted.`);
  process.exit(1);
}
const deploy = venue.deploy;
console.log(`venue:          ${venue.name || "(unnamed draft)"} (${venue.id}), status ${venue.status}, template ${venue.template}${deps.isMemory ? " [MEMORY store]" : ""}`);
console.log(`vercel project: ${deploy ? `${deploy.project_id} (${deploy.provider}, ${deploy.status}${deploy.url ? `, ${deploy.url}` : ""})` : "none"}`);
console.log(`site:           ${deps.config.publicBaseUrl}/${venue.slug}`);
console.log(
  "This deletes the venue, its menu, texts, members, invites, admin token, change log and media rows" +
    (deploy ? ", and the provider project above" : "") +
    ". It cannot be undone.",
);
const again = (await ask("Type the slug again to confirm: ")).trim();
rl.close();
if (again !== slug) {
  console.error("Slug did not match; nothing deleted.");
  process.exit(1);
}
if (deploy) {
  if (deploy.provider === deps.deployer.provider) {
    try {
      await deps.deployer.deleteSite(deploy.project_id);
      console.log(`provider project ${deploy.project_id} deleted (${deploy.provider})`);
    } catch (e) {
      if ((e as { status?: unknown }).status === 404) console.log(`provider project ${deploy.project_id} was already gone (404)`);
      else {
        // VercelError messages are short and secret-free (src/deploy/vercel.ts). Keep the venue so the delete can be retried.
        console.error(`deleting provider project ${deploy.project_id} failed: ${e instanceof Error ? e.message : String(e)}. The venue was NOT deleted; fix the cause and run again.`);
        process.exit(1);
      }
    }
  } else {
    console.log(
      `provider project ${deploy.project_id} NOT deleted: it was created with "${deploy.provider}" but this environment's deployer is "${deps.deployer.provider}". Delete it in the Vercel dashboard if it exists.`,
    );
  }
}
await deps.store.deleteVenue(venue.id);
console.log(`venue "${slug}" deleted. Storage objects under media/${venue.id}/ remain; remove them in the Supabase dashboard or with the pattern in scripts/cleanup-test-venues.mts.`);
