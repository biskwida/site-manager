// src/social/insights-graph.ts
// Server-only. What Instagram says about the café's audience and its recent posts, through GraphClient on graph.instagram.com
// (Instagram Login token, scope instagram_business_manage_insights, which the Instagram connect already asks for), v25.0.
// Everything here is best effort: any error, a missing permission or empty data gives null / [] / undefined, never a throw, so a
// boost proposal can mark that input "missing" and go on. Only error codes are logged (never data, never the URL).
// Metric names as the brief and Meta's reference give them (checked 2026-10-18): follower_demographics (period=lifetime,
// metric_type=total_value, breakdown age|gender|city|country, only returned from 100 followers, top 45 results); per media
// reach, saved, shares, views (`views` replaced `impressions`). One metric Meta refuses for a media type fails the whole
// request with code 100, so the metrics are then asked one by one and the refused one stays undefined.
import { GraphClient, MetaApiError, metaTime } from "../destinations/meta-graph";

/** Followers under this number get no demographics from Meta. */
export const MIN_FOLLOWERS = 100;
export const POST_WINDOW_DAYS = 30;
export const MAX_POSTS = 25;
export const POST_TIMEOUT_MS = 4_000;
export const TOTAL_TIMEOUT_MS = 12_000;
/** The whole follower profile (four requests) gets this long. */
export const PROFILE_TIMEOUT_MS = 8_000;
/** Posts whose insights are read at the same time. */
const CONCURRENCY = 5;
/** `timeframe` is documented for follower_demographics (one of last_14_days … this_week); last_90_days is the widest. */
const TIMEFRAME = "last_90_days";
const MEDIA_FIELDS = "id,caption,media_type,media_product_type,timestamp,permalink,media_url,thumbnail_url";
const METRICS = ["reach", "saved", "shares", "views"] as const;
type Metric = (typeof METRICS)[number];
const DAY_MS = 86_400_000;

export interface FollowerProfile {
  followers: number;
  /** Share (0..1) of the followers Meta could break down, by age band as Meta names it ("25-34"). */
  age: Record<string, number>;
  /** Share (0..1) by Meta's gender keys: "F", "M", "U" (unknown). */
  gender: Record<string, number>;
  /** The top 3 cities as Meta names them ("Sofia, Sofia-Capital"), share 0..1 of the broken-down followers. */
  cities: { name: string; share: number }[];
}

export interface PostStat {
  id: string;
  caption: string;
  type: "image" | "video" | "carousel";
  /** ISO. */
  at: string;
  permalink: string;
  /** The post's picture (https): media_url, or a video's thumbnail_url. Absent when Meta gives none. */
  image_url?: string;
  reach?: number;
  saved?: number;
  shares?: number;
  views?: number;
}

export interface PostStatsOptions {
  perPostMs?: number;
  totalMs?: number;
}

type Raw = Record<string, unknown>;
const rows = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter((x): x is Raw => !!x && typeof x === "object") : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined);
const enc = encodeURIComponent;

/** Logs the error code only: Meta's own code, or the fixed name of what went wrong. Never the message, URL or data. */
function logCode(what: string, e: unknown, log: (s: string) => void, code = e instanceof MetaApiError ? e.code : "unexpected"): void {
  try {
    log(`insights ${what}: ${code}`);
  } catch {
    /* logging must never break the caller */
  }
}

/** A cap that has fired: work checks it before every request and starts nothing more. */
interface Stop {
  on: boolean;
}

/** Resolves to `fallback` when `p` has not settled within `ms` (the late result is dropped); `onTimeout` runs first, to stop the work. */
function within<T>(p: Promise<T>, ms: number, fallback: T, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve) => {
    const t = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** The [dimension value, count] pairs of the first breakdown in a total_value insights reply; null when the shape is not that. */
function breakdownRows(reply: unknown): [string, number][] | null {
  const data = rows((reply as Raw | null)?.data)[0];
  const total = data?.total_value as Raw | undefined;
  const results = rows(rows(total?.breakdowns)[0]?.results);
  const out: [string, number][] = [];
  for (const r of results) {
    const key = Array.isArray(r.dimension_values) ? str(r.dimension_values[0]) : "";
    const n = num(r.value);
    if (key && n !== undefined) out.push([key, n]);
  }
  return out.length > 0 ? out : null;
}

const sum = (pairs: [string, number][]) => pairs.reduce((s, [, n]) => s + n, 0);
const shares = (pairs: [string, number][]): Record<string, number> => {
  const total = sum(pairs);
  const out: Record<string, number> = {};
  if (total <= 0) return out;
  for (const [k, n] of pairs) out[k] = (out[k] ?? 0) + n / total;
  return out;
};

/**
 * The café's followers by age, gender and top 3 cities, from Meta's follower_demographics. Null on any error (under 100 followers,
 * a missing permission, an expired token, no network) or when Meta returns nothing to break down. Never throws.
 */
export async function followerProfile(client: GraphClient, igUserId: string, log: (s: string) => void = () => undefined, opts: { totalMs?: number } = {}): Promise<FollowerProfile | null> {
  const stop: Stop = { on: false };
  return within(readFollowerProfile(client, igUserId, log, stop), opts.totalMs ?? PROFILE_TIMEOUT_MS, null, () => {
    stop.on = true;
    logCode("follower_demographics", new Error("timeout"), log, "timeout");
  });
}

async function readFollowerProfile(client: GraphClient, igUserId: string, log: (s: string) => void, stop: Stop): Promise<FollowerProfile | null> {
  try {
    const id = enc(igUserId);
    const ask = (b: "age" | "gender" | "city") =>
      client.get<unknown>(`/${id}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${b}&timeframe=${TIMEFRAME}`);
    const [ageReply, genderReply, cityReply] = await Promise.all([ask("age"), ask("gender"), ask("city")]);
    const age = breakdownRows(ageReply);
    const gender = breakdownRows(genderReply);
    const city = breakdownRows(cityReply);
    if (!age && !gender && !city) return null;
    if (stop.on) return null;
    // The follower count is the account's own number; it is never inferred from the breakdowns (they cover fewer people).
    let followers = 0;
    try {
      const u = await client.get<{ followers_count?: unknown }>(`/${id}?fields=followers_count`);
      followers = num(u.followers_count) ?? 0;
    } catch (e) {
      logCode("followers_count", e, log);
      return null;
    }
    if (stop.on || followers < MIN_FOLLOWERS) return null;
    const cityShares = city ? shares(city) : {};
    const cities = Object.entries(cityShares)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, share]) => ({ name, share }));
    return { followers, age: age ? shares(age) : {}, gender: gender ? shares(gender) : {}, cities };
  } catch (e) {
    logCode("follower_demographics", e, log);
    return null;
  }
}

function typeOf(raw: Raw): PostStat["type"] {
  const t = str(raw.media_type);
  if (t === "CAROUSEL_ALBUM") return "carousel";
  if (t === "VIDEO" || str(raw.media_product_type) === "REELS") return "video";
  return "image";
}

/** The metric values in an insights reply: `values[0].value` (media insights) or `total_value.value`. */
function metricValues(reply: unknown): Partial<Record<Metric, number>> {
  const out: Partial<Record<Metric, number>> = {};
  for (const d of rows((reply as Raw | null)?.data)) {
    const name = str(d.name) as Metric;
    if (!METRICS.includes(name)) continue;
    const v = num(rows(d.values)[0]?.value) ?? num((d.total_value as Raw | undefined)?.value);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** True when the error says the account may not (or cannot) be read at all, so asking again per metric is pointless. */
const hopeless = (e: unknown) => !(e instanceof MetaApiError) || e.code !== "meta_100";

/** `stops` are the caps that can fire (this post's, the whole call's): once one has, no further request is started. */
async function mediaMetrics(client: GraphClient, mediaId: string, log: (s: string) => void, stops: Stop[]): Promise<Partial<Record<Metric, number>>> {
  const path = `/${enc(mediaId)}/insights?metric=`;
  const stopped = () => stops.some((s) => s.on);
  if (stopped()) return {};
  try {
    return metricValues(await client.get<unknown>(path + METRICS.join(",")));
  } catch (e) {
    logCode("media", e, log);
    if (hopeless(e)) return {};
  }
  // One metric is refused for this media type (code 100 fails the whole request): ask one by one, keep what is given.
  const out: Partial<Record<Metric, number>> = {};
  for (const m of METRICS) {
    if (stopped()) break;
    try {
      Object.assign(out, metricValues(await client.get<unknown>(path + m)));
    } catch (e) {
      logCode(`media ${m}`, e, log);
      if (hopeless(e)) break;
    }
  }
  return out;
}

/**
 * The account's posts of the last 30 days (since `sinceIso`, newest first, at most 25, no stories) with reach, saved, shares and
 * views. A metric the API refuses stays undefined; a post gets 4 s and the whole call 12 s (then the posts so far, without the
 * numbers still missing). Once a cap fires its work stops too: the lane loop takes no more posts and no further request starts.
 * Empty on any listing error. Never throws.
 */
export async function recentPostStats(client: GraphClient, igUserId: string, sinceIso: string, opts: PostStatsOptions = {}, log: (s: string) => void = () => undefined): Promise<PostStat[]> {
  const perPostMs = opts.perPostMs ?? POST_TIMEOUT_MS;
  const totalMs = opts.totalMs ?? TOTAL_TIMEOUT_MS;
  const stats: PostStat[] = [];
  const total: Stop = { on: false };
  const work = (async () => {
    const parsed = Date.parse(sinceIso);
    const since = Number.isFinite(parsed) ? parsed : Date.now() - POST_WINDOW_DAYS * DAY_MS;
    const list = await client.get<{ data?: unknown }>(`/${enc(igUserId)}/media?fields=${MEDIA_FIELDS}&limit=${MAX_POSTS}`);
    for (const raw of rows(list.data)) {
      if (raw.media_product_type === "STORY") continue;
      const ms = metaTime(raw.timestamp);
      const id = str(raw.id);
      if (!id || !Number.isFinite(ms) || ms < since) continue;
      if (stats.length >= MAX_POSTS) break;
      const type = typeOf(raw);
      const picture = str(type === "video" ? raw.thumbnail_url : raw.media_url);
      stats.push({ id, caption: str(raw.caption), type, at: new Date(ms).toISOString(), permalink: str(raw.permalink), ...(/^https:\/\//.test(picture) ? { image_url: picture } : {}) });
    }
    const queue = [...stats];
    const lane = async () => {
      for (let post = queue.shift(); post && !total.on; post = queue.shift()) {
        const mine: Stop = { on: false };
        const m = await within(mediaMetrics(client, post.id, log, [mine, total]), perPostMs, {} as Partial<Record<Metric, number>>, () => {
          mine.on = true;
        });
        if (!total.on) Object.assign(post, m);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, lane));
  })().catch((e) => {
    logCode("media list", e, log);
  });
  await within(work, totalMs, undefined, () => {
    total.on = true;
  });
  // Copies, so a lane still running after the cap cannot change what the caller holds.
  return stats.map((s) => ({ ...s }));
}

/**
 * The post worth boosting: among posts 1 to 14 days old with a reach of at least 50, the highest (saved + shares) / reach.
 * A post needs reach, saved and shares all known from Meta and a score above 0; an unknown metric is never read as 0, so
 * such a post is not scored. Ties go to the newer post. Null when no post qualifies.
 */
export function bestPost(stats: PostStat[], now: Date): PostStat | null {
  let best: { post: PostStat; score: number; at: number } | null = null;
  for (const p of stats) {
    const at = Date.parse(p.at);
    if (!Number.isFinite(at)) continue;
    const age = now.getTime() - at;
    if (age < DAY_MS || age > 14 * DAY_MS) continue;
    if (p.reach === undefined || p.reach < 50) continue;
    if (p.saved === undefined || p.shares === undefined) continue;
    const score = (p.saved + p.shares) / p.reach;
    if (score <= 0) continue;
    if (!best || score > best.score || (score === best.score && at > best.at)) best = { post: p, score, at };
  }
  return best ? best.post : null;
}
