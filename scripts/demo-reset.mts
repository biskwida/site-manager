// scripts/demo-reset.mts
// npm run demo:reset [-- --slug agala] [-- --force]
// Refuses any venue but DEMO_VENUE_SLUG unless --force is passed (it deletes a real café's menu otherwise).
// Wipes the demo venue's content (menu, texts, holidays, announcements, media, change sets, conversations) and re-seeds
// the demo menu, texts, hours, tagline/about and theme. Members (linked phones), invites and the admin link stay.
import { createClient } from "@supabase/supabase-js";
import { DEMO_VENUE, seedMenu } from "../src/seed/demo";
import { makeServerDeps } from "../src/server/deps";

const i = process.argv.indexOf("--slug");
const deps = await makeServerDeps({ defer: (fn) => void fn() });
const slug = (i > 0 ? process.argv[i + 1] : "") || deps.config.demoVenueSlug;
if (deps.isMemory) {
  console.error("demo:reset works on the Supabase store; the memory store is re-seeded on every start.");
  process.exit(1);
}
const venue = await deps.store.getVenueBySlug(slug);
if (!venue) {
  console.error(`No venue "${slug}". Create it: npm run venue:create -- --name "Кафене „Ъгъла“" --slug ${slug} --lang bg --seed demo`);
  process.exit(1);
}

const force = process.argv.includes("--force");
if (slug !== deps.config.demoVenueSlug && !force) {
  console.error(`Refusing to reset "${slug}" (${venue.name}): it is not the demo venue ("${deps.config.demoVenueSlug}"). This deletes its whole menu and history; pass --force if you really mean it.`);
  process.exit(1);
}

const before = await deps.store.getSite(venue.id);
const sets = await deps.store.listChangeSets(venue.id, { limit: 1000 });
console.log(`resetting venue "${venue.slug}" — ${venue.name} (${venue.id})${force ? " [--force]" : ""}`);
console.log(`will delete: ${before.items.length} items, ${before.categories.length} categories, ${sets.length} change sets (plus texts, holidays, announcements, media rows, conversations)`);
await deps.store.clearVenueContent(venue.id);

// Venue-level fields the demo may have changed (set_text, set_hours, set_theme); the Store has no venue update, so write them here.
const db = createClient(deps.config.supabaseUrl, deps.config.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { slug: _slug, ...fields } = DEMO_VENUE;
void _slug;
const { error } = await db.from("venues").update(fields).eq("id", venue.id);
if (error) throw new Error(`reset venue fields: ${error.message}`);

const { categories, items } = await seedMenu(deps.store, venue.id);
const after = await deps.store.getSite(venue.id);
console.log(`demo venue "${slug}" reset (${venue.id})`);
console.log(`removed: ${before.items.length} items, ${before.categories.length} categories, ${before.holidays.length} holidays, ${before.announcements.length} announcements, ${before.media.length} media, ${sets.length} change sets`);
console.log(`seeded:  ${items.length} items, ${categories.length} categories, ${after.texts.length} texts; hours, tagline, about and theme restored`);
console.log("kept:    members, invites and the admin link");
