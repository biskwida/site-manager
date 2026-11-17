// scripts/google-live-check.mts
// Against a REAL connected venue: reads the Google listing through the connection stored for the venue, shows Google's hours
// next to the website's week, and sends the PATCH the adapter would send with validateOnly=true (a dry run: Google changes
// nothing). Lists the 5 newest reviews as "<stars> <date> replied|unanswered": never review text or reviewer names.
// The refresh token comes only from the venue's encrypted destination row; no token, secret or blob is ever printed.
// Run: npm run google:live -- --slug <slug>
//  Only with Tanya's explicit go (spec section 7), each prints a warning first:
//   --push                              after a good dry run, the real hours PATCH and the read-back
//   --reply <review name> --text "..."  one reply (PUT) to one review of this venue's listing
import { pathToFileURL } from "node:url";
import { getLocation, GoogleApiError, googleAccessToken, GoogleClient, listReviews, patchLocation, putReviewReply, type GoogleConfig, type GoogleCreds, type GoogleLocation, type GooglePeriod } from "../src/destinations/google-api";
import { planHoursPush } from "../src/destinations/google";
import { formatGooglePeriods, formatWeek, fromRegularHours, hasNoHours, sameWeek } from "../src/destinations/google-hours";
import { decryptSecrets } from "../src/destinations/secrets";
import type { Store } from "../src/store/types";
import { localDate } from "../src/time";

const READ_MASK = "title,storefrontAddress,regularHours,specialHours,metadata";
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export interface GoogleLiveDeps {
  store: Store;
  secretKey: Buffer;
  google: GoogleCreds;
  fetch: typeof fetch;
  now: Date;
  out: (line: string) => void;
}
export interface GoogleLiveOptions {
  slug: string;
  push?: boolean;
  reply?: { review: string; text: string };
}

const addressOf = (l: GoogleLocation) => [...(l.storefrontAddress?.addressLines ?? []), l.storefrontAddress?.locality, l.storefrontAddress?.postalCode].filter(Boolean).join(", ");
const dateOf = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** Returns the exit code. Prints only codes, Google's error message, hours, stars, dates and review resource names. */
export async function runGoogleLiveCheck(d: GoogleLiveDeps, o: GoogleLiveOptions): Promise<number> {
  const { out } = d;
  const venue = await d.store.getVenueBySlug(o.slug);
  const dest = venue ? await d.store.getDestination(venue.id, "google") : null;
  if (!venue || !dest) {
    out(`Google is not connected for ${o.slug}`);
    return 1;
  }
  const config = dest.config as unknown as GoogleConfig;
  const locationName = config.location_name;
  const locationV4 = config.location_v4;
  // Checked before anything is read or written: a bad --reply never lets a --push go out first.
  if (o.reply && (!o.reply.review.startsWith(`${locationV4}/reviews/`) || !o.reply.text.trim())) {
    out("error: --reply needs a review name of this venue's listing and a non-empty --text");
    return 1;
  }
  if (o.push || o.reply) out("WARNING: --push / --reply write to the live Google listing. Run them only with Tanya's explicit go (spec section 7).");
  try {
    let refresh: string;
    try {
      refresh = decryptSecrets(dest.secrets, d.secretKey).refresh_token ?? "";
    } catch {
      out("error sm_social_not_connected: the stored Google connection cannot be read");
      return 1;
    }
    if (!refresh) {
      out("error sm_social_not_connected: the stored Google connection has no refresh token");
      return 1;
    }
    const client = new GoogleClient(await googleAccessToken(d.fetch, d.google, refresh), d.fetch);
    const loc = await getLocation(client, locationName, READ_MASK);
    out(`Location: ${loc.title ?? config.title} | ${addressOf(loc) || config.address || "(no address)"}`);

    const site = await d.store.getSite(venue.id);
    const today = localDate(d.now, venue.tz);
    const googlePeriods: GooglePeriod[] = loc.regularHours?.periods ?? [];
    out(`Google regular hours: ${googlePeriods.length ? formatGooglePeriods(googlePeriods, "en") : "(none set)"}`);
    const special = (loc.specialHours?.specialHourPeriods ?? []).filter((p) => dateOf(p.startDate) >= today);
    out(`Google special hours from ${today}: ${special.length ? special.map((p) => `${dateOf(p.startDate)} ${p.closed ? "closed" : "special"}`).join(", ") : "(none)"}`);
    out(`Website week: ${formatWeek(site.venue.hours, "en")}`);
    const asWeek = fromRegularHours(googlePeriods);
    out(`Differ: ${asWeek && sameWeek(asWeek, site.venue.hours) ? "no" : "yes"}`);

    if (hasNoHours(site.venue.hours)) {
      out("error sm_google_no_hours: the venue has no opening hours");
      return 1;
    }
    // The body the adapter would send for a holiday change (planHoursPush, src/destinations/google.ts), with its rules: the week
    // goes out on the first push only, and never while Google's week differs from the website's and the owner has not chosen.
    const plan = planHoursPush(dest.config, site, loc, false, d.now);
    const { mask, body } = plan;
    if (plan.conflict) out("Note: Google's week differs from the website's and the owner has not chosen, so only specialHours are sent.");
    else if (!plan.regular) out("Note: the week was pushed before, so only specialHours are sent.");
    try {
      await patchLocation(client, locationName, mask, body, { validateOnly: true });
      out("validateOnly: OK");
    } catch (e) {
      if (!(e instanceof GoogleApiError)) throw e;
      out(`validateOnly: refused (${e.code}: ${e.message})`);
      return 1;
    }

    const reviews = await listReviews(client, locationV4);
    out(`Newest reviews (${Math.min(reviews.length, 5)} of ${reviews.length}):`);
    for (const r of reviews.slice(0, 5)) out(`  ${STARS[r.starRating ?? ""] ?? "?"} ${r.createTime.slice(0, 10)} ${r.reviewReply?.comment ? "replied" : "unanswered"} ${r.name}`);

    if (o.push) {
      await patchLocation(client, locationName, mask, body);
      // Saved the way the adapter saves it (only its own keys, onto the row as it is now), so the dates written here are
      // tracked as Claudia's (special_dates_pushed) and the next push knows the week went out (hours_pushed).
      const fresh = await d.store.getDestination(venue.id, "google");
      if (fresh && fresh.id === dest.id && fresh.status !== "disconnected") {
        const next: Record<string, unknown> = { ...fresh.config, ...plan.set };
        for (const k of plan.remove) delete next[k];
        await d.store.updateDestination(fresh.id, { config: next });
      }
      out("push: done");
      let reviewing = false;
      try {
        const after = await getLocation(client, locationName, READ_MASK);
        reviewing = after.metadata?.hasGoogleUpdated === true || after.metadata?.hasPendingEdits === true;
      } catch (e) {
        if (!(e instanceof GoogleApiError)) throw e;
        out(`read-back: failed (${e.code})`);
      }
      out(`reviewing: ${reviewing ? "yes" : "no"}`);
    }
    if (o.reply) {
      await putReviewReply(client, o.reply.review, o.reply.text);
      out("reply: posted");
    }
    return 0;
  } catch (e) {
    if (e instanceof GoogleApiError) {
      out(`error ${e.code}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let slug = "";
  let push = false;
  let review = "";
  let text = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--slug" && args[i + 1]) slug = args[++i];
    else if (args[i] === "--push") push = true;
    else if (args[i] === "--reply" && args[i + 1]) review = args[++i];
    else if (args[i] === "--text" && args[i + 1]) text = args[++i];
  }
  if (!slug || (review && !text) || (text && !review)) {
    console.error('Usage: npm run google:live -- --slug <slug> [--push] [--reply "<review name>" --text "<reply>"]');
    process.exit(2);
  }
  // The memory store logs the demo venue's admin link (with its key) on start: drop any log line that carries a key.
  const { makeServerDeps } = await import("../src/server/deps");
  const deps = await makeServerDeps({ defer: (fn) => void fn(), log: (line) => void (line.includes("key=") || console.log(line)) });
  const { googleClientId, googleClientSecret } = deps.config;
  if (!googleClientId || !googleClientSecret || !deps.destinationSecretKey) {
    console.error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and DESTINATION_SECRET_KEY must be set (.env.local)");
    process.exit(2);
  }
  const code = await runGoogleLiveCheck(
    { store: deps.store, secretKey: deps.destinationSecretKey, google: { clientId: googleClientId, clientSecret: googleClientSecret }, fetch, now: new Date(), out: (l) => console.log(l) },
    { slug, push, reply: review ? { review, text } : undefined },
  );
  process.exit(code);
}
