// src/server/onboarding.ts
// Server-only. Onboarding after sign-up (/start): the two paths that never use the wizard (B: "I already have a website", C: "only
// social media") create a LIVE venue directly, the way scripts/venue-create.mts does, with one owner invite and the signed-in account as
// the owner; the checklist (/onboarding/[slug]) reads its status from onboardingStatus. Path A is the wizard (src/server/wizard.ts).
// Billing (Task 6) hooks in at afterVenueCreated (./after-venue-created.ts) and fills `plan` in onboardingStatus.
import { INVITE_TTL_MS } from "../bot/bot";
import type { Config } from "../config";
import { parseTypedSiteUrl } from "../domain/site-url";
import { SITE_PLATFORMS, type Lang, type Plan, type SitePlatform, type Venue } from "../domain/types";
import { trialDaysLeft, websiteAllowed } from "../billing/plans";
import { connectWordPress, type ConnectDeps } from "../destinations/connect";
import { isLocalHost, isPrivateAddress } from "../destinations/wordpress-client";
import { SlugTakenError, type Store } from "../store/types";
import type { PublishError } from "../wizard/schema";
import { slugError } from "../wizard/schema";
import { afterVenueCreated } from "./after-venue-created";
import { sameOrigin } from "./admin-auth";
import { serializeDraftCookie } from "./draft-cookie";
import { sha256Hex } from "./hash";
import { getSessionUser, type SessionUser } from "./session";
import { clientIp, handleInvite, NEW_PER_IP_PER_HOUR, rateLimitKeys, startDraftForVenue, WizardError, wizardErrorResponse, type WizardDeps } from "./wizard";
import type { AppsConfig } from "./connect-apps";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NO_STORE = { "cache-control": "no-store" };

// ---------------------------------------------------------------------------------------------------------------------
// Slugs

/** Bulgarian to Latin, the "streamlined system" (Закон за транслитерацията, 2009): ж zh, ц ts, ч ch, ш sh, щ sht, ъ a, ю yu, я ya; ь is dropped. */
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "", ю: "yu", я: "ya",
};
const MAX_SLUG_BASE = 30;

/** "Кафене „Ъгъла“" → "kafene-agala": transliterated, lowercase letters and digits, single dashes, at most 30 characters; "" when nothing is left. */
export function slugBase(name: string): string {
  const latin = [...name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")].map((ch) => CYRILLIC[ch] ?? ch).join("");
  return latin.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG_BASE).replace(/-+$/, "");
}

/** The first free address for this name: the base, then base-2, base-3 … Reserved words (RESERVED_SLUGS) and draft placeholders are skipped like taken addresses. */
export async function pickSlug(store: Store, name: string, skip: ReadonlySet<string> = new Set()): Promise<string> {
  const raw = slugBase(name).replace(/^draft-/, ""); // "draft-…" is the wizard's placeholder, never a final address
  const base = raw.length >= 2 ? raw : "biz";
  for (let n = 1; n <= 40; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (slugError(candidate) || skip.has(candidate)) continue;
    if (!(await store.getVenueBySlug(candidate))) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Input

/** localhost, private/loopback/link-local addresses (URL has already turned 2130706433 and 0x7f.1 into 127.0.0.1) and internal-only name endings. */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return isLocalHost(h) || isPrivateAddress(h) || /\.(local|internal|lan|home\.arpa|intranet|corp)$/.test(h);
}

export interface OwnVenueInput {
  path: "own" | "none";
  name: string;
  /** Path B only: https, validated by parseTypedSiteUrl. */
  site_url?: string;
  platform?: SitePlatform;
  address: string;
  city: string;
  /** Without @. */
  instagram?: string;
  lang: Lang;
}

const err = (path: string, bg: string, en: string): PublishError => ({ path, bg, en });
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim().length <= max ? v.trim() : null);

/** A handle, "@handle" or an instagram.com link → the handle; null when it is none of these. */
export function parseInstagramHandle(raw: string): string | null {
  const t = raw.trim().replace(/^@/, "").replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(t) ? t : null;
}

/** The POST /api/start/venue body → a clean input, or every field that is wrong (BG and EN) so the form can show them. */
export function parseOwnVenueInput(body: unknown): { ok: true; input: OwnVenueInput } | { ok: false; errors: PublishError[] } {
  const b = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const errors: PublishError[] = [];
  const path = b.path === "own" || b.path === "none" ? b.path : null;
  if (!path) errors.push(err("path", "Изберете как да продължим.", "Choose how to continue."));
  const name = text(b.name, 80);
  if (!name) errors.push(err("name", "Въведете името на бизнеса (до 80 знака).", "Enter the business name (up to 80 characters)."));
  const address = text(b.address, 160);
  if (!address) errors.push(err("address", "Въведете адреса.", "Enter the address."));
  const city = text(b.city, 60);
  if (!city) errors.push(err("city", "Въведете града.", "Enter the city."));
  let siteUrl: string | undefined;
  let platform: SitePlatform | undefined;
  if (path === "own") {
    const u = typeof b.site_url === "string" ? parseTypedSiteUrl(b.site_url) : null;
    if (!u) errors.push(err("site_url", "Въведете адрес на сайт, който започва с https, например coffique.bg.", "Enter a website address that uses https, for example coffique.bg."));
    else if (isPrivateHost(new URL(u).hostname)) errors.push(err("site_url", "Това е адрес във вътрешна мрежа. Въведете публичния адрес на сайта.", "That is an address on a private network. Enter your site's public address."));
    else siteUrl = u;
    if (b.platform === undefined || b.platform === "") platform = "unknown";
    else if (typeof b.platform === "string" && (SITE_PLATFORMS as readonly string[]).includes(b.platform)) platform = b.platform as SitePlatform;
    else errors.push(err("platform", "Изберете платформа от списъка.", "Choose a platform from the list."));
  }
  let instagram: string | undefined;
  if (typeof b.instagram === "string" && b.instagram.trim()) {
    const h = parseInstagramHandle(b.instagram);
    if (!h) errors.push(err("instagram", "Инстаграм профилът трябва да е като @coffique.", "The Instagram handle should look like @coffique."));
    else instagram = h;
  }
  const lang: Lang = b.lang === "en" ? "en" : "bg";
  if (errors.length || !path || !name || !address || !city) return { ok: false, errors };
  return { ok: true, input: { path, name, ...(siteUrl ? { site_url: siteUrl } : {}), ...(platform ? { platform } : {}), address, city, ...(instagram ? { instagram } : {}), lang } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Create

/** "ул. Раковски 5" + "София" → "ул. Раковски 5, София" (the city is not repeated when the address already names it). */
function addressLine(address: string, city: string): string {
  return address.toLowerCase().includes(city.toLowerCase()) ? address : `${address}, ${city}`;
}

/**
 * Path B (own) or C (none): a LIVE venue with that site mode (own needs its https address; no deploy is ever started for either), one
 * owner invite (INVITE_TTL_MS) and the signed-in account as the venue_users owner. The slug comes from the name. If linking the
 * account fails the venue is removed again, so a half-made venue never stays. Then afterVenueCreated (billing, Task 6).
 */
export async function createOwnVenue(d: { store: Store }, user: Pick<SessionUser, "id">, input: OwnVenueInput): Promise<{ slug: string; invite_code: string }> {
  const { store } = d;
  let venue: Venue | null = null;
  const lost = new Set<string>();
  for (let attempt = 0; !venue; attempt++) {
    const slug = await pickSlug(store, input.name, lost);
    try {
      venue = await store.createVenue({
        slug,
        name: input.name,
        address: addressLine(input.address, input.city),
        instagram: input.instagram ?? "",
        default_lang: input.lang,
        tz: "Europe/Sofia",
        status: "live",
        created_via: "start",
        site_mode: input.path,
        ...(input.path === "own" ? { site_url: input.site_url ?? null, site_platform: input.platform ?? "unknown" } : {}),
      });
    } catch (e) {
      // Another request took this address between the check and the insert: the next free one. Anything else (store down, bad row) fails at once.
      if (!(e instanceof SlugTakenError) || attempt >= 3) throw e;
      lost.add(slug);
    }
  }
  let code: string;
  try {
    await store.linkVenueUser(venue.id, user.id, "owner");
    code = await store.createInvite(venue.id, "owner", new Date(Date.now() + INVITE_TTL_MS).toISOString());
  } catch (e) {
    await store.deleteVenue(venue.id).catch(() => {});
    throw e;
  }
  try {
    await afterVenueCreated(venue);
  } catch (e) {
    console.error(`[onboarding] afterVenueCreated failed: ${e instanceof Error ? e.message : "error"}`);
  }
  return { slug: venue.slug, invite_code: code };
}

const UNAUTHORIZED = () => new WizardError("unauthorized", 401, "Влезте в профила си, за да продължите.", "Sign in to continue.");
const FORBIDDEN = () => new WizardError("unauthorized", 403, "Заявката не е от този сайт.", "The request did not come from this site.");

export interface StartVenueDeps {
  store: Store;
  config: Pick<Config, "rateSalt" | "maxSitesPerDay"> & Partial<Pick<Config, "billingEnabled" | "trialRequiresCard">>;
  now: () => Date;
  /** The signed-in account of this request; defaults to the Supabase session cookies. Tests inject one. */
  sessionUser?: () => Promise<SessionUser | null>;
}

/**
 * Where a new owner goes after creating a business: the checklist, or, with billing on and TRIAL_REQUIRES_CARD, the plan page first
 * (`?required=1`: Checkout collects a card before the checklist).
 */
export function afterSignupPath(slug: string, config: Partial<Pick<Config, "billingEnabled" | "trialRequiresCard">>): string {
  const s = encodeURIComponent(slug);
  return config.billingEnabled && config.trialRequiresCard ? `/billing/${s}?required=1` : `/onboarding/${s}`;
}

/**
 * POST /api/start/venue (session required): validates, rate-limits like POST /api/new (the same 5 per IP per hour and the global daily
 * cap, so a new address costs the same whichever way it is made), then createOwnVenue. 401 signed out, 403 without a same-host
 * Origin (a cookie-authenticated write), 400 with the wrong fields, 429 over a limit, 201 `{ slug, invite_code, onboarding_url }`.
 */
export async function handleStartVenue(req: Request, d: StartVenueDeps): Promise<Response> {
  try {
    const user = await (d.sessionUser ?? getSessionUser)();
    if (!user) throw UNAUTHORIZED();
    if (!sameOrigin(req)) throw FORBIDDEN();
    const parsed = parseOwnVenueInput(await req.json().catch(() => null));
    if (!parsed.ok) throw new WizardError("invalid", 400, "Някои полета не са попълнени правилно.", "Some fields are not filled in correctly.", parsed.errors);
    const nowIso = d.now().toISOString();
    const keys = rateLimitKeys(sha256Hex(clientIp(req) + d.config.rateSalt));
    if (!(await d.store.bumpRateLimit(keys.ip, HOUR_MS, NEW_PER_IP_PER_HOUR, nowIso)))
      throw new WizardError("rate_limited", 429, "Твърде много опити от този адрес. Опитайте след час.", "Too many attempts from this address. Try again in an hour.");
    if (!(await d.store.bumpRateLimit(keys.global, DAY_MS, d.config.maxSitesPerDay, nowIso)))
      throw new WizardError("rate_limited", 429, "Днес достигнахме лимита за нови бизнеси. Опитайте утре.", "We reached today's limit for new businesses. Try again tomorrow.");
    const r = await createOwnVenue(d, user, parsed.input);
    return Response.json({ ...r, onboarding_url: afterSignupPath(r.slug, d.config) }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Status

export interface PlanSummary {
  /** "none" while billing is off (or has not touched the venue). trial = in the free trial with no subscription; active = a subscription is running (past due included). */
  status: "none" | "trial" | "active" | "paused" | "canceled";
  /** Whole days of free trial left; null unless status is "trial". The changes used (of TRIAL_CHANGE_LIMIT) are Task 7's. */
  trial_days_left: number | null;
  /** The chosen plan; null until one is. */
  plan: Plan | null;
}
export interface OnboardingStatus {
  /** An owner has joined the chat (an owner venue_member exists). */
  chat: boolean;
  instagram: boolean;
  facebook: boolean;
  /** n/a: not an own-site venue; connected: the WordPress plugin is connected; todo: an own site that is not connected yet. */
  website: "n/a" | "connected" | "todo";
  plan: PlanSummary;
}

/** The checklist's facts for one venue. Reads nothing secret and returns no codes or tokens. */
export async function onboardingStatus(store: Store, venue: Venue, opts: { billing?: boolean; now?: Date } = {}): Promise<OnboardingStatus> {
  const [members, destinations] = await Promise.all([store.listMembers(venue.id), store.listDestinations(venue.id)]);
  const connected = (kind: "wordpress" | "instagram" | "facebook") => destinations.some((x) => x.kind === kind && x.status === "connected");
  return {
    chat: members.some((m) => m.role === "owner"),
    instagram: connected("instagram"),
    facebook: connected("facebook"),
    website: venue.site_mode !== "own" ? "n/a" : connected("wordpress") ? "connected" : "todo",
    plan: opts.billing ? planSummary(venue, opts.now ?? new Date()) : { status: "none", trial_days_left: null, plan: null },
  };
}

function planSummary(venue: Venue, now: Date): PlanSummary {
  const subscribed = venue.stripe_subscription_id !== null;
  switch (venue.billing_status) {
    case "trialing":
      return subscribed ? { status: "active", trial_days_left: null, plan: venue.plan } : { status: "trial", trial_days_left: trialDaysLeft(venue, now), plan: venue.plan };
    case "active":
    case "past_due":
      return { status: "active", trial_days_left: null, plan: venue.plan };
    case "paused":
    case "canceled":
      return { status: venue.billing_status, trial_days_left: null, plan: venue.plan };
    default:
      return { status: "none", trial_days_left: null, plan: null };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner-only routes under /api/onboarding/[slug]

export interface OwnerGateDeps {
  store: Store;
  sessionUser?: () => Promise<SessionUser | null>;
  /** BILLING_ENABLED: the checklist's plan card reads the venue's trial and plan only when true. */
  billing?: boolean;
}

/**
 * The signed-in owner of this slug, by account only (never a legacy `?key=`): 401 signed out, 404 for a slug that does not exist or is
 * not theirs (the same answer for both), 403 for a write without a same-host Origin/Referer.
 */
export async function ownerGate(req: Request, slug: string, d: OwnerGateDeps): Promise<{ user: SessionUser; venue: Venue } | { response: Response }> {
  const user = await (d.sessionUser ?? getSessionUser)();
  if (!user) return { response: wizardErrorResponse(UNAUTHORIZED()) };
  const venue = await d.store.getVenueBySlug(slug);
  if (!venue || !(await d.store.isVenueOwner(venue.id, user.id))) return { response: wizardErrorResponse(new WizardError("not_found", 404, "Не намерихме този бизнес.", "We could not find that business.")) };
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase()) && !sameOrigin(req)) return { response: wizardErrorResponse(FORBIDDEN()) };
  return { user, venue };
}

/** GET /api/onboarding/[slug]: the checklist status. */
export async function handleOnboardingStatus(req: Request, slug: string, d: OwnerGateDeps): Promise<Response> {
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    return Response.json(await onboardingStatus(d.store, gate.venue, { billing: d.billing }), { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/** POST /api/onboarding/[slug]/invite: "connect another app": a fresh owner code and one link per app (the wizard's handleInvite, owner-authorised by the account). */
export async function handleOnboardingInvite(req: Request, slug: string, d: OwnerGateDeps & { config: AppsConfig; now: () => Date }): Promise<Response> {
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    return handleInvite(d, gate.venue);
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/** WordPress codes the plugin shows are short; anything longer or with odd characters is not one. */
const WP_CODE_RE = /^[A-Za-z0-9-]{4,40}$/;
const WP_ATTEMPTS_PER_HOUR = 10;

/**
 * POST /api/onboarding/[slug]/wordpress `{ code }`: the web version of the bot's /connect handshake. The site is the venue's own
 * site_url (path B); connectWordPress does the URL and DNS checks, the handshake and the encrypted storage. The code is never logged.
 */
export async function handleOnboardingWordPress(req: Request, slug: string, d: OwnerGateDeps & { connect: Omit<ConnectDeps, "store">; now: () => Date }): Promise<Response> {
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    const { venue } = gate;
    if (venue.site_mode !== "own" || !venue.site_url) throw new WizardError("invalid", 409, "Този бизнес няма собствен сайт за свързване.", "This business has no own website to connect.");
    const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
    // The plugin shows "/connect https://site/ CODE" next to the code; pasting that whole line works too.
    const code = typeof body?.code === "string" ? (body.code.trim().split(/\s+/).pop() ?? "") : "";
    if (!WP_CODE_RE.test(code)) throw new WizardError("invalid", 400, "Въведете кода от плъгина.", "Enter the code the plugin shows.", [err("code", "Кодът е като WP-4K7Q.", "The code looks like WP-4K7Q.")]);
    if (!(await d.store.bumpRateLimit(`onboarding-wp:${venue.id}`, HOUR_MS, WP_ATTEMPTS_PER_HOUR, d.now().toISOString())))
      throw new WizardError("rate_limited", 429, "Твърде много опити. Опитайте след час.", "Too many attempts. Try again in an hour.");
    const r = await connectWordPress({ ...d.connect, store: d.store }, venue.id, venue.site_url, code);
    if (!r.ok) return Response.json({ error: { code: "connect_failed", bg: r.reason.bg, en: r.reason.en } }, { status: 422, headers: NO_STORE });
    return Response.json({ connected: true, site_name: r.site.name }, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/**
 * POST /api/onboarding/[slug]/website: the owner has bought the website add-on (gated by billing when it is on: 402 otherwise); startDraftForVenue puts the wizard draft on this venue and the
 * wizard cookie is set. Returns the wizard's URL. Account owners only.
 */
export async function handleWebsiteDraft(req: Request, slug: string, d: OwnerGateDeps & { config: Pick<WizardDeps["config"], "publicBaseUrl"> & Partial<Pick<Config, "billingEnabled">> }): Promise<Response> {
  try {
    const gate = await ownerGate(req, slug, d);
    if ("response" in gate) return gate.response;
    // With billing on, the website is the paid add-on: Admin or Both with the 199 € setup paid in Checkout (website_fee_paid).
    if (d.config.billingEnabled && !websiteAllowed(gate.venue))
      throw new WizardError("payment_required", 402, "Сайтът е платена добавка към Admin или Both. Изберете план, за да го добавите.", "The website is a paid add-on to Admin or Both. Choose a plan to add it.");
    const { venue, token } = await startDraftForVenue(d.store, gate.venue.id, gate.user);
    const secure = d.config.publicBaseUrl.startsWith("https://");
    return Response.json({ url: `/new/${venue.id}` }, { headers: { ...NO_STORE, "set-cookie": serializeDraftCookie(venue.id, token, { secure }) } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
