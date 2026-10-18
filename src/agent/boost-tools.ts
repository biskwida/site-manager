// src/agent/boost-tools.ts
// The propose_boost tool: Claudia proposes an ad for one of the café's posts (who, where, when and how much, and why), from the
// café's surroundings (OpenStreetMap, src/geo/surroundings.ts), its Instagram followers and post numbers when Instagram is connected
// (src/social/insights-graph.ts) and the recommendation in src/boost/plan.ts. The post's picture goes to the chat first, then one
// boost_plan proposal with ✅ / ✏️ / ❌. Phase 1: Meta ads are not approved yet, so ✅ only saves the plan (no external call, no change
// of the month used) and undo removes it. No reach or price is ever shown: those numbers exist only once ads are connected.
// Every input that cannot be read is "missing" in the plan; nothing here throws past the tool.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { planBoost, type BoostInput } from "../boost/plan";
import { GraphClient, IG_GRAPH } from "../destinations/meta-graph";
import { decryptSecrets } from "../destinations/secrets";
import { publishedTargets, type PublishedTarget } from "../destinations/social-common";
import type { SyncDeps } from "../destinations/sync";
import { formatPrice, keep, tr } from "../domain/format";
import { WEEKDAYS, type BoostOwnerChoices, type BoostPlanRow, type Change, type ChangeSet, type SocialPostRow, type Venue } from "../domain/types";
import { geocode } from "../geo/osm";
import { loadSurroundings, type Surroundings } from "../geo/surroundings";
import { bestPost, followerProfile, POST_WINDOW_DAYS, recentPostStats, type FollowerProfile, type PostStat } from "../social/insights-graph";
import { BoostSchema, type BOOST_RESETS } from "./tool-schemas";
import { proposalText, type ToolDeps, type ToolKit } from "./tools";

/** The venue's Instagram account for reading insights: a client on graph.instagram.com, the account id, and a log for error codes. */
export interface InstagramAccess {
  client: GraphClient;
  igUserId: string;
  log?: (s: string) => void;
}

/** The words that make a plan a morning or a weekend one: the same lists as src/boost/plan.ts reads in a caption. */
export const VARIANT_WORDS = 'variant "morning" when the owner says сутрин / закуска / до 11 / morning / breakfast; variant "weekend" when the owner says уикенд / събота / неделя / бранч / концерт / weekend / brunch / event / live music.';

export const NO_POST = "Which post should I boost? Send it or name it.";
/** A photo (or a post whose publishing never went through) has no post on Instagram or Facebook to put the ad on. */
export const UNPUBLISHED = "This photo is not published yet, so there is no post to boost: nothing was proposed. Propose it with social_post first (when the owner wants it posted), and offer the ad (propose_boost with that post) after it is published.";
const DAY_MS = 86_400_000;

/** The connected Instagram account of a venue, or null (not connected, an `error` connection, no key, unreadable secrets). Never throws. */
export async function instagramAccess(d: Pick<SyncDeps, "store" | "secretKey" | "fetch" | "log">, venueId: string): Promise<InstagramAccess | null> {
  try {
    if (!d.secretKey) return null;
    const dest = await d.store.getDestination(venueId, "instagram");
    if (!dest || dest.status !== "connected") return null;
    const token = decryptSecrets(dest.secrets, d.secretKey).token ?? "";
    const igUserId = String(dest.config.ig_user_id ?? "");
    if (!token || !igUserId) return null;
    const log = d.log ?? ((s: string) => console.log(s));
    return { client: new GraphClient(IG_GRAPH, token, d.fetch ?? fetch), igUserId, log: (s) => log(`[boost] venue ${venueId} ${s}`) };
  } catch {
    return null;
  }
}

/** The post the plan is for, as the proposal stores and shows it. */
interface Chosen {
  post_ref: string | null;
  permalink: string | null;
  media_id: string | null;
  caption: string;
  image_url: string | null;
  type: PostStat["type"];
  stat?: PostStat;
}

const socialRowOf = (cs: ChangeSet): SocialPostRow | null => {
  const c = cs.changes.find((x) => x.op === "social_post" && x.after !== null);
  return c ? (c.after as unknown as SocialPostRow) : null;
};

export function boostTools(d: ToolDeps, k: ToolKit) {
  const boost = betaZodTool({
    name: "propose_boost",
    description: `Propose an ad (boost) for one of the venue's posts: who sees it (within a radius of the business), when, the budget and the reasons, with the post's picture above the ✅ / ✏️ / ❌ buttons. For now ✅ only saves the plan: nothing is spent and nothing is published until Meta approves ads in Claudia. Never use social_post for an ad. Claudia's plan comes from her analysis of the area, followers and posts; pass a field only when the owner says it. On a change pass only the changed fields (earlier choices are kept); use reset for fields where the owner wants Claudia to decide again. ${VARIANT_WORDS}`,
    inputSchema: BoostSchema,
    run: (input) =>
      k.attempt(async () => {
        if (d.member.role !== "owner") throw new Error("Ads are only the owner's decision; tell the owner to send this.");
        const s = await k.site();
        const venue = s.venue;
        const now = d.now();
        // ✏️: the plan being corrected (this venue's boost_plan) carries its post and the owner's earlier choices over.
        let earlier: BoostPlanRow | null = null;
        if (d.correctionFor) {
          const corrected = await d.store.getChangeSet(d.correctionFor).catch(() => null);
          const old = corrected && corrected.venue_id === d.venueId ? corrected.changes.find((c) => c.op === "boost_plan" && c.after !== null) : undefined;
          earlier = old ? (old.after as unknown as BoostPlanRow) : null;
        }
        const owner = ownerChoices(input, earlier?.plan.owner ?? {});
        const base: Omit<BoostInput, "surroundings" | "followers" | "post"> = {
          venue, ownerWords: "", owner, hasFacebookPage: d.social?.facebook === true,
        };
        // The owner's numbers first: a value out of range is refused before anything is read.
        const unread: Surroundings = { status: "missing", places: [] };
        rangeCheck(planBoost({ ...base, surroundings: unread, followers: null, post: null }));
        if (owner.goal === "website_visits" && !hasWebsite(venue)) throw new Error("This business has no website yet; offer reach or profile visits.");
        if (owner.placements === "facebook" && d.social?.facebook !== true) throw new Error("No Facebook Page is connected; offer Instagram or automatic.");
        // Another place: its pin, found before the proposal that this one replaces is cancelled. A carried place keeps its pin.
        let placePin: { lat: number; lng: number } | null = null;
        if (owner.place !== undefined) {
          const carried = input.place === undefined && earlier?.plan.owner?.place === owner.place && earlier.lat !== null && earlier.lng !== null;
          placePin = carried ? { lat: earlier!.lat as number, lng: earlier!.lng as number } : await geocode(owner.place, d.fetch);
          if (!placePin) throw new Error(`I couldn't find "${owner.place}" on the map; ask the owner for a street address near it.`);
        }
        const photo = input.media_id !== undefined ? await d.store.getMedia(input.media_id) : null;
        if (input.media_id !== undefined && (!photo || photo.venue_id !== d.venueId)) throw new Error(`media_id "${input.media_id}" not found for this venue; use the id of a photo you received.`);

        const since = new Date(now.getTime() - POST_WINDOW_DAYS * DAY_MS).toISOString();
        let published: PublishedTarget[] | null = null;
        const publishedPosts = async () => (published ??= await publishedTargets(d.store, d.venueId, since).catch(() => []));
        /** Meta's id and link of a post Claudia published from this set (Instagram first); its numbers are attached after the reads. */
        const fromSocialSet = async (cs: ChangeSet, row: SocialPostRow): Promise<Chosen> => {
          const mine = (await publishedPosts()).filter((t) => t.change_set_id === cs.id).sort((a, b) => (a.network === b.network ? 0 : a.network === "instagram" ? -1 : 1))[0];
          return { post_ref: mine?.post_ref ?? null, permalink: mine?.permalink ?? null, media_id: row.media_id, caption: row.caption, image_url: row.ig_feed_image_url ?? row.image_url, type: "image" };
        };
        const fromStat = (p: PostStat): Chosen => ({ post_ref: p.id, permalink: p.permalink || null, media_id: null, caption: p.caption, image_url: p.image_url ?? null, type: p.type, stat: p });
        const appliedPosts = async () =>
          (await d.store.listChangeSets(d.venueId, { status: ["applied"], limit: 50 }))
            .map((cs) => ({ cs, row: socialRowOf(cs) }))
            .filter((x): x is { cs: ChangeSet; row: SocialPostRow } => x.row !== null)
            .sort((a, b) => (b.cs.applied_at ?? b.cs.created_at).localeCompare(a.cs.applied_at ?? a.cs.created_at));

        // Which post, from our own records first (no read of Meta or OpenStreetMap yet): the given photo, or on ✏️ without a named
        // post the post of the plan being corrected (the owner changes the numbers, not the post).
        let chosen: Chosen | null = null;
        if (photo) {
          const posted = (await appliedPosts()).find((x) => x.row.media_id === photo.id);
          chosen = posted ? await fromSocialSet(posted.cs, posted.row) : { post_ref: null, permalink: null, media_id: photo.id, caption: "", image_url: photo.public_url, type: "image" };
        } else if (input.post_ref === undefined && earlier) {
          const r = earlier;
          chosen = { post_ref: r.post_ref, permalink: r.permalink, media_id: r.media_id, caption: r.caption, image_url: r.image_url, type: "image" };
        }
        if (chosen && chosen.post_ref === null) throw new Error(UNPUBLISHED);

        // Proposals from earlier messages block this one before anything is read (the ✏️ one is replaced).
        await k.ensureNoPending();

        // The area, the followers and the recent posts are read at once; each is best effort (missing, never an error).
        const ig = d.instagramInsights ? await d.instagramInsights(d.venueId).catch(() => null) : null;
        const [surroundings, followers, stats] = await Promise.all([
          loadSurroundings({ store: d.store, fetch: d.fetch }, venue, now.toISOString()),
          ig ? followerProfile(ig.client, ig.igUserId, ig.log).catch((): FollowerProfile | null => null) : Promise.resolve(null),
          ig ? recentPostStats(ig.client, ig.igUserId, since, {}, ig.log).catch((): PostStat[] => []) : Promise.resolve([] as PostStat[]),
        ]);

        // Else: the named post; else the owner's last published post in this chat; else the best recent Instagram post.
        if (chosen) {
          const ref = chosen.post_ref;
          chosen.stat = stats.find((p) => p.id === ref);
          if (chosen.stat) chosen.type = chosen.stat.type;
        } else if (input.post_ref !== undefined) {
          const ref = input.post_ref.trim();
          const stat = stats.find((p) => p.id === ref || (p.permalink !== "" && p.permalink === ref));
          const target = stat ? undefined : (await publishedPosts()).find((t) => t.post_ref === ref || t.permalink === ref);
          const set = target ? (await appliedPosts()).find((x) => x.cs.id === target.change_set_id) : undefined;
          if (stat) chosen = fromStat(stat);
          else if (target) chosen = { post_ref: target.post_ref, permalink: target.permalink, media_id: set?.row.media_id ?? null, caption: target.caption, image_url: set ? set.row.ig_feed_image_url ?? set.row.image_url : null, type: "image" };
          else throw new Error(`post_ref "${ref}" not found among the venue's posts of the last ${POST_WINDOW_DAYS} days; ask the owner to send the photo instead.`);
        } else {
          const last = (await appliedPosts()).find((x) => x.cs.chat_ref === d.chatRef);
          const best = last ? null : bestPost(stats, now);
          chosen = last ? await fromSocialSet(last.cs, last.row) : best ? fromStat(best) : null;
        }
        if (!chosen) throw new Error(NO_POST);
        if (chosen.post_ref === null) throw new Error(UNPUBLISHED);

        const plan = rangeCheck(planBoost({ ...base, surroundings, followers, post: { id: chosen.post_ref ?? chosen.media_id ?? "", caption: chosen.caption, type: chosen.type, stat: chosen.stat } }));
        const pinned = surroundings.lat !== undefined && surroundings.lng !== undefined;
        if (placePin && owner.place !== undefined) {
          plan.reasons.push({
            kind: "hypothesis",
            bg: `районът е анализиран около ${keep(venue.name)}, рекламата е около ${keep(owner.place)}`,
            en: `the area was analysed around ${keep(venue.name)}, the ad is around ${keep(owner.place)}`,
          });
        }
        if (surroundings.reason === "no_address") {
          plan.reasons.push({ kind: "missing", bg: "липсва адрес на кафенето — добавете го, за да проверя района", en: "the café has no address — add it so I can check the area" });
        } else if (!pinned && surroundings.reason !== "osm_unavailable") {
          plan.reasons.push({ kind: "missing", bg: "местоположението на кафенето трябва да се провери: адресът не беше намерен на картата", en: "the café's location needs checking: its address wasn't found on the map" });
        }

        const row: BoostPlanRow = {
          plan, post_ref: chosen.post_ref, permalink: chosen.permalink, media_id: chosen.media_id, caption: chosen.caption, image_url: chosen.image_url,
          lat: placePin ? placePin.lat : pinned ? (surroundings.lat as number) : null, lng: placePin ? placePin.lng : pinned ? (surroundings.lng as number) : null,
          place_label: owner.place ?? venue.name,
        };
        // The post's picture first, so it sits just above the buttons (unless make_visual just put this very picture in the chat);
        // a picture that cannot be sent never holds back the proposal.
        if (row.image_url && !d.sentPhotos.has(row.image_url)) {
          try {
            await d.messenger.sendPhoto(d.chatRef, row.image_url, tr(k.lang, "Пост за реклама", "Post to boost"));
          } catch {
            /* the proposal still goes out */
          }
        }
        const change: Change = { position: 0, op: "boost_plan", entity: "boost_plan", entity_id: k.ctx().newId(), before: null, after: row as unknown as Change["after"] };
        const p = k.previews(s, [change]);
        const days = (n: number, l: "bg" | "en") => (n === 1 ? tr(l, "1 ден", "1 day") : `${n} ${tr(l, "дни", "days")}`);
        const money = (l: "bg" | "en") => formatPrice(plan.budgetEur, l);
        const cs = await d.store.createChangeSet({
          venue_id: d.venueId, chat_ref: d.chatRef, summary_bg: `План за реклама: ${money("bg")}, ${days(plan.days, "bg")}`, summary_en: `Ad plan: ${money("en")}, ${days(plan.days, "en")}`,
          ...p, source: d.source ?? "text", status: "proposed", changes: [change],
        });
        const messageRef = await d.messenger.sendProposal(d.chatRef, proposalText(k.mine(p), k.lang, null, venue.tz, { save: true }), cs.id, k.lang);
        if (messageRef !== null) await d.store.updateChangeSet(cs.id, { message_ref: messageRef });
        d.notes?.push(`ad plan ${cs.id} for ${chosen.post_ref ? `post ${chosen.post_ref}` : `photo ${chosen.media_id}`}`);
        return { change_set_id: cs.id, status: "proposed", preview: k.mine(p), next: "The owner decides with the buttons; for now ✅ only saves the plan (nothing is spent). Reply with at most one short sentence, or nothing. Never state reach, cost or results." };
      }),
  });
  return [boost];
}

/** planBoost's result, or the owner's allowed range as the tool error. */
function rangeCheck(r: ReturnType<typeof planBoost>) {
  if (!("error" in r)) return r;
  if (r.error === "budget_range") throw new Error("The ad budget must be 5–200 € in total; nothing was proposed. Tell the owner the allowed range in one short sentence.");
  if (r.error === "radius_range") throw new Error("The ad radius must be 1–50 km, in steps of half a kilometre; nothing was proposed. Tell the owner the allowed range in one short sentence.");
  if (r.error === "age_range") throw new Error("The minimum age must be 18–65 and the maximum from the minimum up to 65 (or none); nothing was proposed. Tell the owner the allowed range in one short sentence.");
  if (r.error === "schedule") throw new Error("An ad schedule needs at least one weekday and a start time before the end time (HH:MM); nothing was proposed. Tell the owner the allowed range in one short sentence.");
  throw new Error("An ad runs 1–14 days; nothing was proposed. Tell the owner the allowed range in one short sentence.");
}

/** Whether the business has a website the ad can lead to: its own site, a template deployment or the hosted site of a live venue. */
function hasWebsite(v: Pick<Venue, "site_url" | "deploy" | "status">): boolean {
  return Boolean(v.site_url) || Boolean(v.deploy?.url) || v.status === "live";
}

type BoostInputFields = {
  budget_eur?: number; days?: number; variant?: "default" | "morning" | "weekend"; radius_km?: number; place?: string; age_min?: number; age_max?: number | null;
  gender?: "all" | "women" | "men"; audience?: string; weekdays?: (typeof WEEKDAYS)[number][]; from?: string; to?: string;
  goal?: "reach" | "profile_visits" | "website_visits"; placements?: "automatic" | "instagram" | "facebook"; reset?: (typeof BOOST_RESETS)[number][];
};

/** The owner's choices after this call: the carried ones, minus the fields to decide again, plus what the owner said now. */
function ownerChoices(input: BoostInputFields, carried: BoostOwnerChoices): BoostOwnerChoices {
  const owner: BoostOwnerChoices = { ...carried };
  for (const field of input.reset ?? []) {
    if (field === "radius") delete owner.radiusKm;
    else if (field === "place") delete owner.place;
    else if (field === "age") { delete owner.ageMin; delete owner.ageMax; }
    else if (field === "gender") delete owner.gender;
    else if (field === "audience") delete owner.audience;
    else if (field === "schedule") delete owner.schedule;
    else if (field === "budget") delete owner.budgetEur;
    else if (field === "days") delete owner.days;
    else if (field === "goal") delete owner.goal;
    else if (field === "placements") delete owner.placements;
  }
  if (input.budget_eur !== undefined) owner.budgetEur = input.budget_eur;
  if (input.days !== undefined) owner.days = input.days;
  if (input.variant !== undefined) owner.variant = input.variant;
  if (input.radius_km !== undefined) owner.radiusKm = input.radius_km;
  if (input.place !== undefined) owner.place = input.place;
  if (input.age_min !== undefined) owner.ageMin = input.age_min;
  if (input.age_max !== undefined) owner.ageMax = input.age_max;
  if (input.gender !== undefined) owner.gender = input.gender;
  if (input.audience !== undefined) owner.audience = input.audience;
  if (input.goal !== undefined) owner.goal = input.goal;
  if (input.placements !== undefined) owner.placements = input.placements;
  if (input.weekdays !== undefined || input.from !== undefined || input.to !== undefined) {
    const base = owner.schedule ?? { days: [...WEEKDAYS], from: "00:00", to: "23:59" };
    owner.schedule = { days: input.weekdays ?? base.days, from: input.from ?? base.from, to: input.to ?? base.to };
  }
  return owner;
}
