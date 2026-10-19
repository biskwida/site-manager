// src/server/wizard.ts
// Pure functions over Store (tested on the memory store) plus the HTTP handlers the thin app/api/new routes call.
// Never log the draft token or the cookie.
import { adminUrl, INVITE_TTL_MS, publicUrl } from "../bot/bot";
import { imageMediaType } from "../bot/media";
import type { Messenger } from "../bot/messenger";
import type { Config } from "../config";
import { pollDeployments } from "../deploy/run";
import type { Deployer } from "../deploy/types";
import { planChanges } from "../domain/changes";
import { renderPreview } from "../domain/preview";
import { TEMPLATE_IDS, type ChangeOp, type SiteState, type TemplateId, type Venue } from "../domain/types";
import { seedMenuFrom, type SeedCategory, type SeedItem, type SeedTexts } from "../seed/demo";
import type { Store, VenuePatch } from "../store/types";
import { bothLangs, DRAFT_SLUG_PREFIX, emptyDraft, slugError, WIZARD_MAX_IMAGE_BYTES, validateForPublish, WizardPatchSchema, type PublishError, type WizardDraft } from "../wizard/schema";
import { connectedApps, newOwnerCode, type AppsConfig, type ConnectedApp, type OwnerCode } from "./connect-apps";
import { readDraftFromRequest, serializeDraftCookie } from "./draft-cookie";
import { newDraftToken, sha256Hex } from "./hash";
import { afterVenueCreated } from "./after-venue-created";

/** Error codes the wizard client can branch on. `ai_*` and `refused` come from the Claude-backed routes (src/server/wizard-ai.ts). */
export type WizardErrorCode =
  | "bad_request"
  | "invalid"
  | "unauthorized"
  | "not_found"
  | "slug_taken"
  | "already_published"
  | "publish_in_progress"
  | "rate_limited"
  | "too_large"
  | "too_many"
  | "unsupported_type"
  /** 503: no ANTHROPIC_API_KEY on this server (offline mode); the UI hides the AI buttons. */
  | "ai_unavailable"
  /** 422: the model refused the files or facts. */
  | "refused"
  /** 502: the model call failed or returned nothing usable; try again. */
  | "ai_error"
  /** 429: this draft's hourly or the server's daily number of AI requests is used up. */
  | "ai_rate_limited"
  /** 503: no INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET on this server; the UI hides the Instagram button (src/server/instagram.ts). */
  | "instagram_unavailable"
  /** 410: the stored Instagram list is missing or over an hour old; sign in to Instagram again. */
  | "instagram_expired"
  /** 502: none of the picked images could be downloaded from Instagram's CDN. */
  | "instagram_error"
  /** 409: the action needs a published (live) venue. */
  | "not_live";

/** Every wizard failure the client can show: a code, both languages, an HTTP status and optional field errors. */
export class WizardError extends Error {
  /** The venue's live slug, on `already_published`. */
  public readonly slug?: string;
  constructor(
    public readonly code: WizardErrorCode,
    public readonly status: number,
    public readonly bg: string,
    public readonly en: string,
    public readonly errors: PublishError[] = [],
    extra: { slug?: string } = {},
  ) {
    super(en);
    this.name = "WizardError";
    if (extra.slug !== undefined) this.slug = extra.slug;
  }
}

const NO_STORE = { "cache-control": "no-store" };

/** `{ error: { code, bg, en, details?, slug? } }` with the error's status; anything unexpected is a 500 without internals. */
export function wizardErrorResponse(e: unknown): Response {
  if (e instanceof WizardError) {
    return Response.json(
      { error: { code: e.code, bg: e.bg, en: e.en, ...(e.errors.length ? { details: e.errors } : {}), ...(e.slug !== undefined ? { slug: e.slug } : {}) } },
      { status: e.status, headers: NO_STORE },
    );
  }
  console.error("[wizard] unexpected:", e instanceof Error ? e.message : e);
  return Response.json({ error: { code: "error", bg: "Възникна грешка. Опитайте отново.", en: "Something went wrong. Please try again." } }, { status: 500, headers: NO_STORE });
}

const INVALID = (errors: PublishError[] = []) => new WizardError("invalid", 400, "Някои полета не са попълнени правилно.", "Some fields are not filled in correctly.", errors);
const SLUG_TAKEN = () => new WizardError("slug_taken", 409, "Този адрес вече е зает. Изберете друг.", "This address is already taken. Choose another.");
export const PUBLISH_IN_PROGRESS = () => new WizardError("publish_in_progress", 409, "Сайтът се публикува в момента. Изчакайте малко.", "This site is being published right now. Please wait a moment.");
export const ALREADY_PUBLISHED = (slug: string) => new WizardError("already_published", 409, "Сайтът вече е създаден.", "This site has already been created.", [], { slug });

export function rateLimitKeys(ipHash: string): { ip: string; global: string } {
  return { ip: `new:ip:${ipHash}`, global: "new:global" };
}

/**
 * The wizard can edit and publish this venue: a draft, or a LIVE own-site/no-website venue whose owner started the website add-on
 * (startDraftForVenue puts a wizard_draft on the live row; it stays live and public until the draft is published). Every other live
 * venue has no wizard_draft, so it is never editable here.
 */
export function isOpenDraft(venue: Pick<Venue, "status" | "wizard_draft">): boolean {
  return venue.status === "draft" || venue.wizard_draft !== null;
}

function placeholderSlug(): string {
  return `${DRAFT_SLUG_PREFIX}${newDraftToken().slice(0, 8)}`;
}

/** A draft venue (status draft, placeholder slug `draft-<8hex>`, empty wizard draft) and its token; only the token's hash is stored. */
export async function createDraft(store: Store, template: TemplateId, now: Date): Promise<{ venue: Venue; token: string }> {
  void now; // created_at comes from the store's clock; `now` stays in the signature for the contract
  let venue: Venue | null = null;
  for (let attempt = 0; !venue; attempt++) {
    try {
      venue = await store.createVenue({ slug: placeholderSlug(), name: "", template, business_type: "cafe", status: "draft", wizard_draft: emptyDraft(template) });
    } catch (e) {
      // Only a placeholder collision is worth another random slug; anything else (store down, bad row) fails at once.
      if (!(e instanceof Error && /slug/i.test(e.message)) || attempt >= 2) throw e;
    }
  }
  const token = newDraftToken();
  await store.setDraftToken(venue.id, sha256Hex(token));
  return { venue, token };
}

/** The wizard's draft for a venue that already exists: its details, menu, texts and pictures, so setting up the website loses nothing. Hidden (inactive) dishes and categories are not carried over. */
export function draftFromSite(site: SiteState): WizardDraft {
  const v = site.venue;
  const base = emptyDraft(v.template);
  const text = (key: "welcome" | "footer_note") => {
    const t = site.texts.find((x) => x.key === key);
    return { bg: t?.text_bg ?? "", en: t?.text_en ?? "" };
  };
  const byPosition = <T extends { position: number }>(a: T[]) => [...a].sort((x, y) => x.position - y.position);
  const categories = byPosition(site.categories.filter((c) => c.active)).map((c) => ({
    key: c.id,
    name_bg: c.name_bg,
    name_en: c.name_en,
    items: byPosition(site.items.filter((i) => i.active && i.category_id === c.id)).map((i) => ({
      key: i.id,
      name_bg: i.name_bg,
      name_en: i.name_en,
      desc_bg: i.desc_bg,
      desc_en: i.desc_en,
      price_eur: i.price_eur,
      allergens: [...i.allergens],
      image_media_id: i.image_media_id,
    })),
  }));
  return {
    ...base,
    business_type: v.business_type,
    name: v.name,
    slug: v.slug,
    default_lang: v.default_lang,
    address: v.address,
    phone: v.phone,
    instagram: v.instagram,
    maps_url: v.maps_url,
    hours: structuredClone(v.hours),
    theme: { accent: v.theme.accent },
    tagline_bg: v.tagline_bg,
    tagline_en: v.tagline_en,
    about_bg: v.about_bg,
    about_en: v.about_en,
    texts: { welcome: text("welcome"), footer_note: text("footer_note") },
    logo_media_id: v.logo_media_id,
    cover_media_id: v.cover_media_id,
    gallery_media_ids: byPosition(site.media.filter((m) => m.is_gallery)).map((m) => m.id),
    categories,
    step: "template",
  };
}

/**
 * The website add-on: puts a wizard draft on an EXISTING own-site or no-website venue (it stays live and public), prefilled from the
 * venue, and issues a draft token for the wizard cookie (only its hash is stored). Only an owner of the venue through their account
 * (venue_users) may call it. A draft already in progress is kept as it is. Publishing it (publishDraft) keeps the slug and sets
 * site_mode "claudia". Nothing else about the venue changes until then.
 */
export async function startDraftForVenue(store: Store, venueId: string, user: { id: string }): Promise<{ venue: Venue; token: string }> {
  if (!(await store.isVenueOwner(venueId, user.id))) throw new WizardError("unauthorized", 403, "Само собственикът може да започне сайта.", "Only the owner can start the website.");
  const venue = await store.getVenue(venueId);
  if (venue.status !== "live") throw new WizardError("not_live", 409, "Първо публикувайте бизнеса.", "Publish the business first.");
  if (venue.site_mode === "claudia") throw ALREADY_PUBLISHED(venue.slug);
  const withDraft = venue.wizard_draft ? venue : await store.updateVenue(venue.id, { wizard_draft: draftFromSite(await store.getSite(venue.id)) });
  const token = newDraftToken();
  await store.setDraftToken(venue.id, sha256Hex(token));
  return { venue: withDraft, token };
}

/** The slug is free when no OTHER live venue has it. Drafts keep their placeholder row slug until publish, so only live rows count. */
async function assertSlugFree(store: Store, slug: string, selfId: string): Promise<void> {
  const other = await store.getVenueBySlug(slug);
  if (other && other.id !== selfId && other.status === "live") throw SLUG_TAKEN();
}

/** Validates the patch (unknown keys dropped), refuses reserved/placeholder/taken slugs, merges into the stored draft. */
export async function updateDraft(store: Store, venue: Venue, patch: Partial<WizardDraft>): Promise<WizardDraft> {
  if (!isOpenDraft(venue)) throw ALREADY_PUBLISHED(venue.slug);
  // A website add-on keeps the venue's address: the slug in the draft is always the live one.
  const addon = venue.status !== "draft";
  const parsed = WizardPatchSchema.safeParse(patch);
  if (!parsed.success) {
    throw INVALID(
      parsed.error.issues.map((i) => {
        const path = i.path.map(String).join(".");
        // The slug is the one field the owner types freely: say what is wrong with it.
        const why = path === "slug" && typeof patch.slug === "string" ? slugError(patch.slug) : null;
        return { path, ...(why ?? { bg: "Невалидна стойност.", en: "Invalid value." }) };
      }),
    );
  }
  const clean = parsed.data;
  if (clean.slug && !addon) {
    const why = slugError(clean.slug);
    if (why) throw INVALID([{ path: "slug", ...why }]);
    await assertSlugFree(store, clean.slug, venue.id);
  }
  const merged: WizardDraft = { ...(venue.wizard_draft ?? emptyDraft(venue.template)), ...clean, ...(addon ? { slug: venue.slug } : {}) };
  await store.updateVenue(venue.id, { wizard_draft: merged, ...(clean.template ? { template: clean.template } : {}), ...(clean.business_type ? { business_type: clean.business_type } : {}) });
  return merged;
}

/**
 * Turns the draft into a live venue. Order matters: going live is the LAST write, so a failure at any earlier step leaves a
 * draft (status draft, wizard_draft intact, no invite) that the owner can simply publish again.
 *   1. venue fields and the final slug (the unique index claims the slug, so `slug_taken` surfaces before anything else is written);
 *   2. menu and texts (cleared first, so a retry never duplicates rows), then logo/cover/gallery via one auto-applied change set
 *      holding only what is not already in place;
 *   3. status live, wizard_draft null;
 *   4. owner invite (INVITE_TTL_MS) and the admin token.
 * The draft token hash is kept (R10: the done page and /status authenticate with the cookie). Does not start a deploy.
 */
export async function publishDraft(store: Store, venue: Venue, now: Date, opts: { userId?: string | null } = {}): Promise<{ venue: Venue; inviteCode: string; adminToken: string }> {
  if (!isOpenDraft(venue)) throw ALREADY_PUBLISHED(venue.slug);
  // A website add-on (live own-site/no-website venue) keeps its address; the draft's slug is whatever the venue has.
  const addon = venue.status !== "draft";
  const d = { ...(venue.wizard_draft ?? emptyDraft(venue.template)), ...(addon ? { slug: venue.slug } : {}) };
  const v = validateForPublish(d);
  if (!v.ok) throw INVALID(v.errors);
  await assertSlugFree(store, d.slug, venue.id);
  const nowIso = now.toISOString();
  // R24: one publisher at a time; a crashed publish releases itself after PUBLISH_CLAIM_TTL_MS, a failed one right away (below).
  if (!(await store.claimPublish(venue.id, nowIso))) throw PUBLISH_IN_PROGRESS();
  try {
    return await publishClaimed(store, venue, d, now, opts.userId ?? null);
  } catch (e) {
    await store.releasePublish(venue.id).catch(() => {});
    throw e;
  }
}

async function publishClaimed(store: Store, venue: Venue, d: WizardDraft, now: Date, userId: string | null): Promise<{ venue: Venue; inviteCode: string; adminToken: string }> {
  const nowIso = now.toISOString();
  const addon = venue.status !== "draft";

  // Only media uploaded to this draft may be referenced (media rows key on the venue id, so uploads made before the slug was chosen count).
  const own = new Set((await store.getSite(venue.id)).media.map((m) => m.id));
  const mediaOrNull = (id: string | null) => (id && own.has(id) ? id : null);

  // 1. Venue fields and slug, still a draft (anon RLS hides it). Between this step and step 3 the draft row holds its final slug
  //    instead of `draft-<8hex>` (R20): another draft choosing the same slug gets `slug_taken` from the unique index at its own
  //    publish until this one goes live or is cleaned up.
  const tagline = bothLangs(d.tagline_bg, d.tagline_en);
  const about = bothLangs(d.about_bg, d.about_en);
  const fields: VenuePatch = {
    slug: d.slug,
    name: d.name.trim(),
    tagline_bg: tagline.bg,
    tagline_en: tagline.en,
    about_bg: about.bg,
    about_en: about.en,
    address: d.address.trim(),
    phone: d.phone.trim(),
    maps_url: d.maps_url.trim(),
    instagram: d.instagram.trim().replace(/^@/, ""),
    hours: d.hours,
    tz: "Europe/Sofia",
    default_lang: d.default_lang,
    theme: { accent: d.theme.accent.toLowerCase() },
    template: d.template,
    business_type: d.business_type,
    // The website add-on turns an own-site/no-website venue into a Claudia site: the old address and platform no longer apply.
    ...(addon ? { site_mode: "claudia" as const, site_url: null, site_platform: null } : {}),
  };
  let updated: Venue;
  try {
    updated = await store.updateVenue(venue.id, fields);
  } catch (e) {
    // A row with this slug exists that assertSlugFree let through (another draft mid-publish, or a race): the unique index decides.
    if (e instanceof Error && /slug/i.test(e.message)) throw SLUG_TAKEN();
    throw e;
  }

  // 2a. Menu and texts through the shared seeder, so positions and ids come from the store exactly as for seeded venues.
  //     A draft has no menu rows of its own; any found here are left over from a failed publish and are replaced.
  const before = await store.getSite(venue.id);
  if (before.categories.length || before.items.length || before.texts.length) await store.clearMenu(venue.id);
  const cats: SeedCategory[] = d.categories.map((c) => {
    const n = bothLangs(c.name_bg, c.name_en);
    return { name_bg: n.bg, name_en: n.en };
  });
  const items: (SeedItem & { image_media_id: string | null })[] = d.categories.flatMap((c, ci) =>
    c.items.map((it) => {
      const n = bothLangs(it.name_bg, it.name_en);
      return { cat: ci, name_bg: n.bg, name_en: n.en, desc_bg: it.desc_bg.trim(), desc_en: it.desc_en.trim(), price_eur: it.price_eur, allergens: [...it.allergens].sort((a, b) => a - b), image_media_id: mediaOrNull(it.image_media_id) };
    }),
  );
  const texts: SeedTexts = { welcome: bothLangs(d.texts.welcome.bg, d.texts.welcome.en), footer_note: bothLangs(d.texts.footer_note.bg, d.texts.footer_note.en) };
  const filled = Object.fromEntries(Object.entries(texts).filter(([, t]) => t.bg || t.en)) as SeedTexts;
  await seedMenuFrom(store, venue.id, cats, items, filled);

  // 2b. Logo, cover and gallery go through one auto-applied change set, so the log explains where the images came from.
  //     A set left proposed by a failed attempt is expired; ops already in place (an earlier attempt applied them) are skipped.
  //     Source "auto": the owner chose these in the wizard, so like the tick's auto sets the set only records that decision;
  //     it never counts toward the monthly change limit and is never refused by it (src/domain/limits.ts).
  for (const stale of await store.listChangeSets(venue.id, { status: ["proposed"] })) await store.expireChangeSet(stale.id, nowIso);
  const site = await store.getSite(venue.id);
  const inGallery = new Set(site.media.filter((m) => m.is_gallery).map((m) => m.id));
  const ops: ChangeOp[] = [];
  const logo = mediaOrNull(d.logo_media_id);
  const cover = mediaOrNull(d.cover_media_id);
  if (logo && site.venue.logo_media_id !== logo) ops.push({ op: "set_logo_image", media_id: logo });
  if (cover && site.venue.cover_media_id !== cover) ops.push({ op: "set_cover_image", media_id: cover });
  for (const id of d.gallery_media_ids) if (own.has(id) && !inGallery.has(id) && !ops.some((o) => o.op === "add_gallery_image" && o.media_id === id)) ops.push({ op: "add_gallery_image", media_id: id });
  if (ops.length) {
    const changes = planChanges(site, ops, { newId: () => crypto.randomUUID(), now: nowIso });
    const cs = await store.createChangeSet({
      venue_id: venue.id,
      chat_ref: null,
      summary_bg: "Първоначални снимки",
      summary_en: "Initial photos",
      preview_bg: renderPreview(site, changes, "bg", updated.tz),
      preview_en: renderPreview(site, changes, "en", updated.tz),
      source: "auto",
      status: "proposed",
      changes,
    });
    const applied = await store.applyChangeSet(cs.id, nowIso);
    // "auto" is exempt from the limit, so a refusal here means the exemption broke: fail loudly instead of publishing without photos.
    if (applied === "limited") {
      console.error(`[wizard] initial photos ${cs.id} for venue ${venue.id} were refused by the monthly change limit`);
      throw new Error("Initial photos were refused by the monthly change limit.");
    }
  }

  // 3. Live: the last write. From here on the venue is public and the wizard draft is gone, with any Instagram import list
  //    (written only when there is one, so a database without the instagram_import column still publishes).
  //    The list is checked on a fresh read: the Instagram callback may have stored one after this request read the venue.
  //    The signed-in account (when there is one) becomes the owner just before that last write, so a failure still leaves a plain draft to publish again.
  if (userId) await store.linkVenueUser(venue.id, userId, "owner");
  const latest = await store.getVenue(venue.id);
  await store.updateVenue(venue.id, { status: "live", wizard_draft: null, ...(latest.instagram_import ? { instagram_import: null } : {}) });

  // 4. Owner invite and admin token. A failure here leaves a live venue without a code; the done page issues a fresh invite.
  //    A website add-on whose owner is already in the chat needs no new code.
  const ownerJoined = addon && (await store.listMembers(venue.id)).some((m) => m.role === "owner");
  const inviteCode = ownerJoined ? "" : await store.createInvite(venue.id, "owner", new Date(now.getTime() + INVITE_TTL_MS).toISOString());
  const adminToken = await store.getAdminToken(venue.id);
  const live = await store.getVenue(venue.id);
  if (userId && !addon) await afterVenueCreated(live);
  return { venue: live, inviteCode, adminToken };
}

/** Invite codes are 8 chars from the bot's alphabet. */
const INVITE_CODE_RE = /^[A-Z2-9]{8}$/;

/**
 * The owner code the done page shows: null once an owner has joined; else the publish redirect's ?code= when it looks like
 * a code; else the newest open owner invite; only when none is open, a fresh one (INVITE_TTL_MS). Reloads never pile up invites.
 */
export async function doneInviteCode(store: Store, venueId: string, codeParam: string | null, now: Date): Promise<string | null> {
  if ((await store.listMembers(venueId)).some((m) => m.role === "owner")) return null;
  const fromUrl = codeParam?.toUpperCase() ?? null;
  if (fromUrl && INVITE_CODE_RE.test(fromUrl)) return fromUrl;
  return (await store.findOpenInvite(venueId, "owner", now.toISOString())) ?? (await store.createInvite(venueId, "owner", new Date(now.getTime() + INVITE_TTL_MS).toISOString()));
}

// ---------------------------------------------------------------------------------------------------------------------
// HTTP layer (the app/api/new routes only parse params and call these).

export interface WizardDeps {
  store: Store;
  config: Pick<Config, "publicBaseUrl" | "rateSalt" | "maxSitesPerDay" | "telegramBotUsername">;
  now: () => Date;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const NEW_PER_IP_PER_HOUR = 5;
/** Uploads per draft (logo, cover, gallery, dish photos): bounds the shared storage one anonymous draft can use (30 × 4 MB). */
export const MAX_DRAFT_MEDIA = 30;

/** First x-forwarded-for value (the client on Vercel), else "unknown". Only its salted hash is ever stored. */
export function clientIp(req: Request): string {
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

/** Cookie id must equal the path id and its token hash must resolve to that venue. Draft or live (the done page polls after publish). */
export async function requireDraft(req: Request, d: Pick<WizardDeps, "store">, id: string): Promise<{ venue: Venue } | Response> {
  const c = readDraftFromRequest(req);
  if (!c || c.id !== id) return wizardErrorResponse(new WizardError("unauthorized", 401, "Тази чернова не е ваша или сесията е изтекла.", "This draft is not yours or the session has expired."));
  const venue = await d.store.findVenueByDraftToken(sha256Hex(c.token));
  if (!venue || venue.id !== id) return wizardErrorResponse(new WizardError("not_found", 404, "Черновата не беше намерена.", "The draft was not found."));
  return { venue };
}

export async function handleNewDraft(req: Request, d: WizardDeps): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as { template?: unknown } | null;
    const t = body?.template;
    const template = typeof t === "string" && (TEMPLATE_IDS as readonly string[]).includes(t) ? (t as TemplateId) : null;
    if (!template) throw new WizardError("bad_request", 400, "Изберете шаблон.", "Choose a template.");
    const now = d.now();
    const nowIso = now.toISOString();
    const keys = rateLimitKeys(sha256Hex(clientIp(req) + d.config.rateSalt));
    if (!(await d.store.bumpRateLimit(keys.ip, HOUR_MS, NEW_PER_IP_PER_HOUR, nowIso)))
      throw new WizardError("rate_limited", 429, "Твърде много опити от този адрес. Опитайте след час.", "Too many attempts from this address. Try again in an hour.");
    if (!(await d.store.bumpRateLimit(keys.global, DAY_MS, d.config.maxSitesPerDay, nowIso)))
      throw new WizardError("rate_limited", 429, "Днес достигнахме лимита за нови сайтове. Опитайте утре.", "We reached today's limit for new sites. Try again tomorrow.");
    const { venue, token } = await createDraft(d.store, template, now);
    const secure = d.config.publicBaseUrl.startsWith("https://");
    return Response.json({ id: venue.id }, { status: 201, headers: { ...NO_STORE, "set-cookie": serializeDraftCookie(venue.id, token, { secure }) } });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handleGetDraft(d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    const site = await d.store.getSite(venue.id);
    return Response.json({ draft: venue.wizard_draft ?? emptyDraft(venue.template), media: site.media, status: venue.status }, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export async function handlePutDraft(req: Request, d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WizardError("bad_request", 400, "Невалидна заявка.", "Invalid request.");
    const draft = await updateDraft(d.store, venue, body as Partial<WizardDraft>);
    return Response.json({ draft }, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export const TOO_LARGE = () => new WizardError("too_large", 400, "Снимката е над 4 MB.", "The image is over 4 MB.");
export const TOO_MANY_MEDIA = () => new WizardError("too_many", 400, `Една чернова може да има до ${MAX_DRAFT_MEDIA} снимки.`, `A draft can have up to ${MAX_DRAFT_MEDIA} images.`);
export const UNSUPPORTED = () => new WizardError("unsupported_type", 400, "Само снимки: JPEG, PNG, WebP или GIF.", "Images only: JPEG, PNG, WebP or GIF.");
/** Multipart overhead allowed on top of the image when checking content-length before reading the body. */
const FORM_OVERHEAD = 64 * 1024;

/** The image type from the file's first bytes; null when they are not JPEG, PNG, GIF or WebP. */
export function sniffImageType(b: Uint8Array): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function handleMedia(req: Request, d: WizardDeps, venue: Venue): Promise<Response> {
  try {
    if (!isOpenDraft(venue)) throw ALREADY_PUBLISHED(venue.slug);
    // Cheap refusals first, before the body is read.
    if ((await d.store.getSite(venue.id)).media.length >= MAX_DRAFT_MEDIA) throw TOO_MANY_MEDIA();
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > WIZARD_MAX_IMAGE_BYTES + FORM_OVERHEAD) throw TOO_LARGE();
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new WizardError("bad_request", 400, "Липсва файл.", "No file was sent.");
    if (file.size > WIZARD_MAX_IMAGE_BYTES) throw TOO_LARGE();
    if (!imageMediaType(file.type, file.name)) throw UNSUPPORTED();
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength === 0) throw new WizardError("bad_request", 400, "Файлът е празен.", "The file is empty.");
    // The stored content type comes from the bytes, never from the client's label.
    const type = sniffImageType(bytes);
    if (!type) throw UNSUPPORTED();
    const media = await d.store.saveMedia(venue.id, bytes, type);
    return Response.json({ media }, { status: 201, headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/** `opts.userId`: the signed-in account, linked as the owner. `opts.startDeploy`: called for a website add-on (its owner is already in the chat, so the first-owner-join deploy will not run). */
export async function handlePublish(d: WizardDeps, venue: Venue, opts: { userId?: string | null; startDeploy?: (venueId: string) => void } = {}): Promise<Response> {
  try {
    const addon = venue.status !== "draft";
    const r = await publishDraft(d.store, venue, d.now(), { userId: opts.userId ?? null });
    if (addon) opts.startDeploy?.(venue.id);
    const bot = d.config.telegramBotUsername;
    return Response.json(
      {
        slug: r.venue.slug,
        invite_code: r.inviteCode,
        start_url: bot && r.inviteCode ? `https://t.me/${bot}?start=${r.inviteCode}` : null,
        admin_url: adminUrl(d.config.publicBaseUrl, r.venue.slug, r.adminToken),
        site_url: publicUrl(d.config.publicBaseUrl, r.venue.slug),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

export interface WizardStatusResponse {
  status: Venue["status"];
  /** Always null without a deployer (hosted mode). */
  deploy: Venue["deploy"];
  site_url: string | null;
  /** An owner has pressed Start in Telegram. */
  owner_joined: boolean;
  /** No deployer on this server: the hosted /<slug> is the site, live as soon as the owner joined. */
  hosted: boolean;
  /** Linked chats per app (empty until the first app connects). */
  connected_apps: ConnectedApp[];
}

/** Polls the deployer for this venue when its deploy is pending/building, then reports status, deploy and the best site URL. */
export async function handleStatus(d: WizardDeps & { deployer: Deployer | null; messenger: Messenger | null }, venue: Venue): Promise<Response> {
  try {
    let v = venue;
    if (d.deployer && v.deploy && (v.deploy.status === "pending" || v.deploy.status === "building")) {
      try {
        await pollDeployments({ store: d.store, deployer: d.deployer, messenger: d.messenger, now: d.now, venueId: v.id });
      } catch (e) {
        console.error("[wizard] status poll failed:", e instanceof Error ? e.message : e);
      }
      v = await d.store.getVenue(v.id);
    }
    const deploy = d.deployer ? v.deploy : null;
    const hostedUrl = v.status === "live" ? publicUrl(d.config.publicBaseUrl, v.slug) : null;
    const site_url = deploy?.status === "ready" && deploy.url ? deploy.url : hostedUrl;
    const members = v.status === "live" ? await d.store.listMembers(v.id) : [];
    const owner_joined = members.some((m) => m.role === "owner");
    const body: WizardStatusResponse = { status: v.status, deploy, site_url, owner_joined, hosted: !d.deployer, connected_apps: connectedApps(members) };
    return Response.json(body, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/** POST /api/new/[id]/invite: a fresh owner code and one link per enabled app ("connect another app" on the done page). */
export async function handleInvite(d: { store: Store; config: AppsConfig; now: () => Date }, venue: Venue): Promise<Response> {
  try {
    const r = await newOwnerCode(d.store, d.config, venue, d.now());
    if (!r.ok) throw new WizardError(r.error, r.error === "rate_limited" ? 429 : 409, r.bg, r.en);
    const body: OwnerCode = { code: r.code, links: r.links, expires_at: r.expires_at };
    return Response.json(body, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
