// src/store/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { COMMENT_LIMIT_DEFAULT, countsTowardLimit } from "../domain/limits";
import { isChatLang, isExternalEntity, isRecordOnlyEntity, SITE_PLATFORMS, type BoostEntity, type CommentMode, type SocialEntity, type WpEntity } from "../domain/types";
import type { Announcement, BusinessType, Category, Change, ChangeSet, ChatLang, Conversation, DeployInfo, DeployStatus, Holiday, InstagramImport, Item, Lang, Media, Member, Role, SitePlatform, SiteState, SiteText, SiteTextKey, TemplateId, Venue, VenueStatus } from "../domain/types";
import type { Place } from "../geo/osm";
import type { WizardDraft } from "../wizard/schema";
import { legacyTelegramId } from "../channels/ref";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, PUBLISH_CLAIM_TTL_MS, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store, type VenuePatch, type Destination, type DestinationKind, type DestinationPatch, type DestinationSync, type DestinationWithSecrets, type NewDestination, type NewSync, type SyncPatch, type SyncStatus, type ListSyncsOpts, type ApplyResult, checkLimitValue, checkMemberLang, CONFIG_KEY_RE, newConfirmationCode, type DataDeletionRequest, type DeletionProvider, type DeletionStatus, type CommentStatus, type ListCommentsOpts, type NewSocialComment, type SocialComment, type SocialCommentPatch, COMMENT_REDACTED, redactCommentRow, type VenueSurroundings } from "./types";
import { limitBlocks } from "./usage";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const iso = (v: unknown): string => new Date(String(v)).toISOString();
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

export function toVenue(r: Row): Venue {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    tagline_bg: str(r.tagline_bg),
    tagline_en: str(r.tagline_en),
    about_bg: str(r.about_bg),
    about_en: str(r.about_en),
    address: str(r.address),
    phone: str(r.phone),
    maps_url: str(r.maps_url),
    instagram: str(r.instagram),
    cover_media_id: strOrNull(r.cover_media_id),
    logo_media_id: strOrNull(r.logo_media_id),
    hours: (r.hours as Venue["hours"]) ?? DEFAULT_HOURS,
    // Missing before the column is added (schema.sql): unlimited.
    change_limit: r.change_limit === null || r.change_limit === undefined ? null : num(r.change_limit),
    // Comment replies (2026-10-15). Missing before schema.sql is applied: the defaults.
    comment_mode: (r.comment_mode as CommentMode) ?? "each",
    comment_digest_hour: r.comment_digest_hour === null || r.comment_digest_hour === undefined ? 9 : num(r.comment_digest_hour),
    comment_limit: r.comment_limit === undefined ? COMMENT_LIMIT_DEFAULT : r.comment_limit === null ? null : num(r.comment_limit),
    last_comment_digest_at: isoOrNull(r.last_comment_digest_at),
    tz: str(r.tz) || "Europe/Sofia",
    default_lang: (r.default_lang as Lang) ?? "bg",
    theme: (r.theme as Venue["theme"]) ?? { accent: "#2f6b4f" },
    template: (r.template as TemplateId) ?? "classic",
    business_type: (r.business_type as BusinessType) ?? "cafe",
    status: (r.status as VenueStatus) ?? "live",
    deploy: (r.deploy as DeployInfo | null) ?? null,
    wizard_draft: (r.wizard_draft as WizardDraft | null) ?? null,
    // Missing before the column is added (schema.sql): read as null, so nothing breaks until it is applied.
    instagram_import: (r.instagram_import as InstagramImport | null) ?? null,
    // Missing before the column is added: read as null (a hosted or template site).
    site_url: strOrNull(r.site_url),
    // Missing before the migration is applied (or any unknown value): a Claudia site, as before.
    site_mode: r.site_mode === "own" || r.site_mode === "none" ? r.site_mode : "claudia",
    // Missing before the migration is applied (or any unknown value): not asked.
    site_platform: SITE_PLATFORMS.includes(r.site_platform as SitePlatform) ? (r.site_platform as SitePlatform) : null,
    created_at: iso(r.created_at),
  };
}
export function toCategory(r: Row): Category {
  return { id: r.id as string, venue_id: r.venue_id as string, name_bg: str(r.name_bg), name_en: str(r.name_en), position: num(r.position), active: Boolean(r.active) };
}
export function toItem(r: Row): Item {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    category_id: r.category_id as string,
    name_bg: str(r.name_bg),
    name_en: str(r.name_en),
    desc_bg: str(r.desc_bg),
    desc_en: str(r.desc_en),
    price_eur: num(r.price_eur),
    allergens: ((r.allergens as number[]) ?? []).map(Number),
    image_media_id: strOrNull(r.image_media_id),
    sold_out_until: isoOrNull(r.sold_out_until),
    is_special: Boolean(r.is_special),
    special_expires_at: isoOrNull(r.special_expires_at),
    position: num(r.position),
    active: Boolean(r.active),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
export function toHoliday(r: Row): Holiday {
  return { id: r.id as string, venue_id: r.venue_id as string, date: String(r.date).slice(0, 10), note_bg: str(r.note_bg), note_en: str(r.note_en) };
}
export function toAnnouncement(r: Row): Announcement {
  return { id: r.id as string, venue_id: r.venue_id as string, text_bg: str(r.text_bg), text_en: str(r.text_en), expires_at: isoOrNull(r.expires_at), created_at: iso(r.created_at) };
}
export function toMedia(r: Row): Media {
  return { id: r.id as string, venue_id: r.venue_id as string, storage_path: str(r.storage_path), public_url: str(r.public_url), is_gallery: Boolean(r.is_gallery), position: num(r.position), created_at: iso(r.created_at) };
}
export function toSiteText(r: Row): SiteText {
  return { venue_id: r.venue_id as string, key: r.key as SiteTextKey, text_bg: str(r.text_bg), text_en: str(r.text_en) };
}
export function toMember(r: Row): Member {
  return { venue_id: r.venue_id as string, chat_ref: str(r.chat_ref), role: r.role as Role, lang: isChatLang(r.lang) ? r.lang : "bg", last_seen_at: isoOrNull(r.last_seen_at), created_at: iso(r.created_at) };
}
export function toChange(r: Row): Change {
  return { position: num(r.position), op: r.op as Change["op"], entity: r.entity as Change["entity"], entity_id: str(r.entity_id), before: (r.before as Row | null) ?? null, after: (r.after as Row | null) ?? null };
}
export function toChangeSet(r: Row): ChangeSet {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    chat_ref: strOrNull(r.chat_ref),
    summary_bg: str(r.summary_bg),
    summary_en: str(r.summary_en),
    preview_bg: str(r.preview_bg),
    preview_en: str(r.preview_en),
    source: r.source as ChangeSet["source"],
    status: r.status as ChangeSet["status"],
    apply_at: isoOrNull(r.apply_at),
    reminded_at: isoOrNull(r.reminded_at),
    decided_at: isoOrNull(r.decided_at),
    applied_at: isoOrNull(r.applied_at),
    reverted_by: strOrNull(r.reverted_by),
    undoes_id: strOrNull(r.undoes_id),
    message_ref: strOrNull(r.message_ref),
    proposal_refs: (r.proposal_refs as Record<string, string> | null) ?? null,
    created_at: iso(r.created_at),
    changes: ((r.changes as Row[]) ?? []).map(toChange).sort((a, b) => a.position - b.position),
  };
}
/** Legacy bigint columns, written only for Telegram refs so the production build (Telegram only) keeps working; removed in the phase-2 code cleanup, before the migration runs. */
export function legacyColumns(chatRef: string | null, messageRef?: string | null): { chat_id: number | null; tg_message_id: number | null } {
  const chat_id = legacyTelegramId(chatRef); // legacy
  const tg_message_id = chat_id !== null && messageRef && /^-?\d+$/.test(messageRef) ? Number(messageRef) : null; // legacy
  return { chat_id, tg_message_id }; // legacy
}

/** Unwraps a Supabase result; keeps the error code in the message so callers can tell not-found (PGRST116) apart. */
export async function must<T>(p: PromiseLike<{ data: T | null; error: DbError }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}${error.code ? ` [${error.code}]` : ""}`);
  if (data === null) throw new Error(`${what}: not found`);
  return data;
}
/** Like `must`, but also throws when no row was affected. */
export async function mustRows<T>(p: PromiseLike<{ data: T[] | null; error: DbError }>, what: string): Promise<T[]> {
  const rows = await must(p, what);
  if (rows.length === 0) throw new Error(`${what}: not found`);
  return rows;
}

const SET_SELECT = "*, changes(*)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A venue filter that is not a uuid can match nothing (and Postgres would reject it). */
const badVenue = (venueId?: string) => Boolean(venueId) && !UUID.test(venueId as string);
const TABLE: Record<Exclude<Change["entity"], WpEntity | SocialEntity | BoostEntity>, string> = { venue: "venues", category: "categories", item: "items", holiday: "holidays", announcement: "announcements", media: "media", site_text: "site_texts" };

export class SupabaseStore implements Store {
  private db: SupabaseClient;
  /** Tests prefix slugs so parallel runs never collide. */
  slugPrefix = "";

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** Maps a venue row and hides the test slug prefix, so callers see the slug they asked for. */
  private venue(r: Row): Venue {
    const v = toVenue(r);
    if (this.slugPrefix && v.slug.startsWith(this.slugPrefix)) v.slug = v.slug.slice(this.slugPrefix.length);
    return v;
  }

  async createVenue(v: NewVenue) {
    const row = {
      ...v,
      slug: `${this.slugPrefix}${v.slug}`,
      hours: v.hours ?? DEFAULT_HOURS,
      theme: v.theme ?? { accent: "#2f6b4f" },
      template: v.template ?? "classic",
      business_type: v.business_type ?? "cafe",
      status: v.status ?? "live",
      wizard_draft: v.wizard_draft ?? null,
    };
    return this.venue(await must(this.db.from("venues").insert(row).select("*").single(), "createVenue"));
  }
  async getVenue(id: string) {
    return this.venue(await must(this.db.from("venues").select("*").eq("id", id).single(), `getVenue ${id}`));
  }
  async getVenueBySlug(slug: string) {
    const { data, error } = await this.db.from("venues").select("*").eq("slug", `${this.slugPrefix}${slug}`).maybeSingle();
    if (error) throw new Error(`getVenueBySlug: ${error.message}`);
    return data ? this.venue(data) : null;
  }
  async listVenues(opts: { status?: VenueStatus; deploying?: boolean } = {}) {
    let q = this.db.from("venues").select("*").order("created_at");
    if (opts.status) q = q.eq("status", opts.status);
    if (opts.deploying) q = q.in("deploy->>status", ["pending", "building"]);
    return (await must(q, "listVenues")).map((r) => this.venue(r));
  }
  async updateVenue(id: string, patch: VenuePatch) {
    const clean: Row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (typeof clean.slug === "string") clean.slug = `${this.slugPrefix}${clean.slug}`;
    if (Object.keys(clean).length === 0) return this.getVenue(id);
    const { data, error } = await this.db.from("venues").update(clean).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.code === "23505" ? `slug ${patch.slug} already exists` : `updateVenue ${id}: ${error.message} [${error.code ?? ""}]`);
    if (!data) throw new Error(`updateVenue ${id}: not found`);
    return this.venue(data);
  }
  async setDeploy(id: string, deploy: DeployInfo | null) {
    await mustRows(this.db.from("venues").update({ deploy }).eq("id", id).select("id"), `setDeploy ${id}`);
  }
  async claimDeploy(id: string, next: DeployInfo, opts: { whenStatusIn: (DeployStatus | null)[]; whenDeploymentId?: string }) {
    if (badVenue(id)) return false;
    // One conditional UPDATE: the row filter is the claim, so two concurrent callers cannot both see the old status.
    const statuses = opts.whenStatusIn.filter((s): s is DeployStatus => s !== null);
    const parts = [...(opts.whenStatusIn.includes(null) ? ["deploy.is.null"] : []), ...(statuses.length ? [`deploy->>status.in.(${statuses.join(",")})`] : [])];
    if (parts.length === 0) return false;
    let q = this.db.from("venues").update({ deploy: next }).eq("id", id).or(parts.join(","));
    // ->> yields text; a deploy record always carries deployment_id (possibly ""), so eq("") matches a create still in flight.
    if (opts.whenDeploymentId !== undefined) q = q.eq("deploy->>deployment_id", opts.whenDeploymentId);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`claimDeploy ${id}: ${error.message}`);
    return (data?.length ?? 0) === 1;
  }
  async claimPublish(id: string, now = new Date().toISOString()) {
    if (badVenue(id)) return false;
    const stale = new Date(Date.parse(now) - PUBLISH_CLAIM_TTL_MS).toISOString();
    // A draft, or a live venue with an open website-setup draft (wizard_draft set); free, or held by a claim that went stale.
    const open = ["status.eq.draft", "wizard_draft.not.is.null"];
    const free = ["publishing_at.is.null", `publishing_at.lt.${stale}`];
    const { data, error } = await this.db.from("venues").update({ publishing_at: now }).eq("id", id).or(open.flatMap((o) => free.map((f) => `and(${o},${f})`)).join(",")).select("id");
    if (error) throw new Error(`claimPublish ${id}: ${error.message}`);
    return (data?.length ?? 0) === 1;
  }
  async releasePublish(id: string) {
    if (badVenue(id)) return;
    const { error } = await this.db.from("venues").update({ publishing_at: null }).eq("id", id);
    if (error) throw new Error(`releasePublish ${id}: ${error.message}`);
  }
  async setDraftToken(id: string, tokenHash: string | null) {
    await mustRows(this.db.from("venues").update({ draft_token_hash: tokenHash }).eq("id", id).select("id"), `setDraftToken ${id}`);
  }
  async findVenueByDraftToken(tokenHash: string) {
    const { data, error } = await this.db.from("venues").select("*").eq("draft_token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`findVenueByDraftToken: ${error.message}`);
    return data ? this.venue(data) : null;
  }
  async deleteVenue(id: string, opts: { withStorage?: boolean } = {}) {
    if (badVenue(id)) return;
    if (opts.withStorage) await this.removeVenueObjects(id);
    const { error } = await this.db.from("venues").delete().eq("id", id);
    if (error) throw new Error(`deleteVenue ${id}: ${error.message}`);
  }
  /** Removes every object under `<venueId>/` in the media bucket (saveMedia's layout), page by page. */
  private async removeVenueObjects(venueId: string) {
    for (let round = 0; round < 50; round++) {
      const { data, error } = await this.db.storage.from("media").list(venueId, { limit: 100 });
      if (error) throw new Error(`deleteVenue storage list ${venueId}: ${error.message}`);
      const paths = (data ?? []).filter((o) => o.id !== null).map((o) => `${venueId}/${o.name}`);
      if (paths.length === 0) return;
      const { error: removeError } = await this.db.storage.from("media").remove(paths);
      if (removeError) throw new Error(`deleteVenue storage remove ${venueId}: ${removeError.message}`);
    }
  }
    async getSite(venueId: string): Promise<SiteState> {
    const [venue, categories, items, holidays, announcements, media, texts] = await Promise.all([
      this.getVenue(venueId),
      must(this.db.from("categories").select("*").eq("venue_id", venueId).order("position"), "categories"),
      must(this.db.from("items").select("*").eq("venue_id", venueId).order("position").order("created_at"), "items"),
      must(this.db.from("holidays").select("*").eq("venue_id", venueId).order("date"), "holidays"),
      must(this.db.from("announcements").select("*").eq("venue_id", venueId).order("created_at"), "announcements"),
      must(this.db.from("media").select("*").eq("venue_id", venueId).order("created_at"), "media"),
      must(this.db.from("site_texts").select("*").eq("venue_id", venueId), "site_texts"),
    ]);
    return { venue, categories: categories.map(toCategory), items: items.map(toItem), holidays: holidays.map(toHoliday), announcements: announcements.map(toAnnouncement), media: media.map(toMedia), texts: texts.map(toSiteText) };
  }
  async insertCategory(c: NewCategory) {
    return toCategory(await must(this.db.from("categories").insert(c).select("*").single(), "insertCategory"));
  }
  async insertItem(i: NewItem) {
    return toItem(await must(this.db.from("items").insert({ ...i, is_special: i.is_special ?? false, special_expires_at: i.special_expires_at ?? null, image_media_id: i.image_media_id ?? null }).select("*").single(), "insertItem"));
  }
  async setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string) {
    await must(this.db.from("site_texts").upsert({ venue_id: venueId, key, text_bg, text_en }, { onConflict: "venue_id,key" }).select("key"), "setSiteText");
  }
  async clearMenu(venueId: string) {
    for (const t of ["items", "categories", "site_texts"]) {
      const { error } = await this.db.from(t).delete().eq("venue_id", venueId);
      if (error) throw new Error(`clearMenu ${t}: ${error.message}`);
    }
  }
  async clearVenueContent(venueId: string) {
    for (const t of ["change_sets", "conversations", "items", "categories", "holidays", "announcements", "site_texts"]) {
      const { error } = await this.db.from(t).delete().eq("venue_id", venueId);
      if (error) throw new Error(`clearVenueContent ${t}: ${error.message}`);
    }
    const media = await must(this.db.from("media").select("storage_path").eq("venue_id", venueId), "clearVenueContent media");
    if (media.length) {
      const { error } = await this.db.storage.from("media").remove(media.map((m) => m.storage_path as string));
      if (error) throw new Error(`clearVenueContent storage: ${error.message}`);
    }
    const { error: mediaError } = await this.db.from("media").delete().eq("venue_id", venueId);
    if (mediaError) throw new Error(`clearVenueContent media rows: ${mediaError.message}`);
    await mustRows(this.db.from("venues").update({ cover_media_id: null, logo_media_id: null }).eq("id", venueId).select("id"), "clearVenueContent venue");
  }

  async findMember(chatRef: string) {
    const { data, error } = await this.db.from("venue_members").select("*").eq("chat_ref", chatRef).maybeSingle();
    if (error) throw new Error(`findMember: ${error.message}`);
    return data ? toMember(data) : null;
  }
  async listMembers(venueId: string) {
    if (badVenue(venueId)) return [];
    return (await must(this.db.from("venue_members").select("*").eq("venue_id", venueId).order("created_at"), "listMembers")).map(toMember);
  }
  async upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }) {
    checkMemberLang(m.lang);
    // One venue per chat: drop any previous link first (the unique index on chat_ref would reject it).
    const { error } = await this.db.from("venue_members").delete().eq("chat_ref", m.chat_ref).neq("venue_id", m.venue_id);
    if (error) throw new Error(`upsertMember unlink: ${error.message}`);
    const row = { venue_id: m.venue_id, chat_ref: m.chat_ref, role: m.role, lang: m.lang, ...(m.last_seen_at !== undefined ? { last_seen_at: m.last_seen_at } : {}), tg_chat_id: legacyTelegramId(m.chat_ref) }; // legacy: remove in phase 2
    return toMember(await must(this.db.from("venue_members").upsert(row, { onConflict: "venue_id,chat_ref" }).select("*").single(), "upsertMember"));
  }
  async setMemberLang(venueId: string, chatRef: string, lang: ChatLang) {
    checkMemberLang(lang);
    await mustRows(this.db.from("venue_members").update({ lang }).eq("venue_id", venueId).eq("chat_ref", chatRef).select("chat_ref"), "setMemberLang");
  }
  async touchMember(chatRef: string, nowIso: string) {
    const { error } = await this.db.from("venue_members").update({ last_seen_at: nowIso }).eq("chat_ref", chatRef);
    if (error) throw new Error(`touchMember: ${error.message}`);
  }
  async createInvite(venueId: string, role: Role, expiresAt: string) {
    const code = newInviteCode();
    await must(this.db.from("venue_invites").insert({ code, venue_id: venueId, role, expires_at: expiresAt }).select("code"), "createInvite");
    return code;
  }
  async findOpenInvite(venueId: string, role: Role, now: string) {
    if (badVenue(venueId)) return null;
    const { data, error } = await this.db.from("venue_invites").select("code").eq("venue_id", venueId).eq("role", role).is("used_at", null).gt("expires_at", now).order("expires_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(`findOpenInvite: ${error.message}`);
    return data ? (data.code as string) : null;
  }
  async redeemInvite(code: string, chatRef: string, lang: ChatLang, now: string) {
    checkMemberLang(lang); // before the code is used up
    const rows = await must(
      this.db.from("venue_invites").update({ used_at: now }).eq("code", code).is("used_at", null).gt("expires_at", now).select("*"),
      "redeemInvite",
    );
    if (rows.length === 0) return null;
    return this.upsertMember({ venue_id: rows[0].venue_id as string, chat_ref: chatRef, role: rows[0].role as Role, lang });
  }
  async getAdminToken(venueId: string) {
    const { data, error } = await this.db.from("venue_admin_tokens").select("token").eq("venue_id", venueId).maybeSingle();
    if (error) throw new Error(`getAdminToken: ${error.message}`);
    if (data) return data.token as string;
    const token = newToken();
    await must(this.db.from("venue_admin_tokens").insert({ venue_id: venueId, token }).select("venue_id"), "getAdminToken insert");
    return token;
  }
  async findVenueByAdminToken(token: string) {
    const { data, error } = await this.db.from("venue_admin_tokens").select("venue_id").eq("token", token).maybeSingle();
    if (error) throw new Error(`findVenueByAdminToken: ${error.message}`);
    return data ? this.getVenue(data.venue_id as string) : null;
  }
  async removeMember(venueId: string, chatRef: string) {
    if (badVenue(venueId)) return false;
    const rows = await must(this.db.from("venue_members").delete().eq("venue_id", venueId).eq("chat_ref", chatRef).select("chat_ref"), "removeMember");
    return rows.length > 0;
  }
  async listInvites(venueId: string, now: string) {
    if (badVenue(venueId)) return [];
    const rows = await must(this.db.from("venue_invites").select("code, role, expires_at, used_at").eq("venue_id", venueId).gt("expires_at", now).order("expires_at"), "listInvites");
    return rows.map((r) => ({ role: r.role as Role, code_hint: str(r.code).slice(-4), expires_at: iso(r.expires_at), used: r.used_at !== null }));
  }
  async cancelInvites(venueId: string, role?: Role) {
    if (badVenue(venueId)) return 0;
    let q = this.db.from("venue_invites").delete().eq("venue_id", venueId).is("used_at", null);
    if (role) q = q.eq("role", role);
    return (await must(q.select("code"), "cancelInvites")).length;
  }
  async rotateAdminToken(venueId: string) {
    const token = newToken();
    await mustRows(this.db.from("venue_admin_tokens").upsert({ venue_id: venueId, token }, { onConflict: "venue_id" }).select("venue_id"), "rotateAdminToken");
    return token;
  }

  async createChangeSet(cs: NewChangeSet) {
    const { changes, message_ref, ...head } = cs;
    const row = await must<Row>(this.db.from("change_sets").insert({ ...head, apply_at: head.apply_at ?? null, undoes_id: head.undoes_id ?? null, message_ref: message_ref ?? null, proposal_refs: head.proposal_refs ?? null, ...legacyColumns(head.chat_ref, message_ref) }).select("*").single(), "createChangeSet");
    if (changes.length) {
      await must(this.db.from("changes").insert(changes.map((c, i) => ({ change_set_id: row.id, position: i, op: c.op, entity: c.entity, entity_id: c.entity_id, before: c.before, after: c.after }))).select("id"), "createChangeSet changes");
    }
    return this.getChangeSet(row.id as string);
  }
  async getChangeSet(id: string) {
    return toChangeSet(await must(this.db.from("change_sets").select(SET_SELECT).eq("id", id).single(), `getChangeSet ${id}`));
  }
  async findProposed(venueId: string, chatRef: string) {
    const rows = await must(this.db.from("change_sets").select(SET_SELECT).eq("venue_id", venueId).eq("chat_ref", chatRef).eq("status", "proposed").order("created_at", { ascending: false }).limit(1), "findProposed");
    return rows.length ? toChangeSet(rows[0]) : null;
  }
  async listChangeSets(venueId: string, opts: { status?: ChangeSet["status"][]; limit?: number } = {}) {
    let q = this.db.from("change_sets").select(SET_SELECT).eq("venue_id", venueId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit ?? 50);
    if (opts.status) q = q.in("status", opts.status);
    return (await must(q, "listChangeSets")).map(toChangeSet);
  }
  async listDue(now: string, venueId?: string) {
    if (badVenue(venueId)) return [];
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "scheduled").lte("apply_at", now).order("apply_at");
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listDue")).map(toChangeSet);
  }
  async listUpcoming(now: string, until: string, venueId?: string) {
    if (badVenue(venueId)) return [];
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "scheduled").is("reminded_at", null).gt("apply_at", now).lte("apply_at", until);
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listUpcoming")).map(toChangeSet);
  }
  async listProposedBefore(cutoff: string, venueId?: string) {
    if (badVenue(venueId)) return [];
    let q = this.db.from("change_sets").select(SET_SELECT).eq("status", "proposed").lt("created_at", cutoff);
    if (venueId) q = q.eq("venue_id", venueId);
    return (await must(q, "listProposedBefore")).map(toChangeSet);
  }
  async updateChangeSet(id: string, patch: ChangeSetPatch) {
    const clean: Row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return;
    if (patch.message_ref !== undefined) clean.tg_message_id = legacyColumns((await this.getChangeSet(id)).chat_ref, patch.message_ref).tg_message_id; // legacy, phase 2
    await mustRows(this.db.from("change_sets").update(clean).eq("id", id).select("id"), `updateChangeSet ${id}`);
  }

  /**
   * Conditional status flip first (so two appliers cannot both write), then the entity writes.
   * If any write fails, the set is reset to its prior status so it can be retried (every write is idempotent).
   */
  async applyChangeSet(id: string, now: string): Promise<ApplyResult> {
    // The ops come along because a set made only of set_comment_mode rows is never limited (countsTowardLimit).
    const prior = await must<{ status: ChangeSet["status"]; source: ChangeSet["source"]; venue_id: string; changes?: { op: Change["op"] }[] }>(this.db.from("change_sets").select("status, source, venue_id, changes(op)").eq("id", id).maybeSingle(), `applyChangeSet ${id}`);
    if ((prior.status === "proposed" || prior.status === "scheduled") && (await limitBlocks(this, prior, now))) {
      // Conditional like the apply flip: a set decided meanwhile stays as it is. Two applies racing past the count can
      // overshoot the limit by one; the count is not a lock.
      const cancelled = await must(
        this.db.from("change_sets").update({ status: "cancelled", decided_at: now }).eq("id", id).in("status", ["proposed", "scheduled"]).select("id"),
        `applyChangeSet ${id} (limit)`,
      );
      return cancelled.length === 0 ? "skipped" : "limited";
    }
    const flipped = await must(
      this.db.from("change_sets").update({ status: "applied", applied_at: now }).eq("id", id).in("status", ["proposed", "scheduled"]).select(SET_SELECT),
      `applyChangeSet ${id}`,
    );
    if (flipped.length === 0) return "skipped";
    const cs = toChangeSet(flipped[0]);
    try {
      if (cs.decided_at === null) await this.updateChangeSet(id, { decided_at: now });
      for (const c of cs.changes) await this.writeEntity(cs.venue_id, c);
      if (cs.undoes_id) {
        const { error } = await this.db.from("change_sets").update({ status: "reverted", reverted_by: cs.id }).eq("id", cs.undoes_id).eq("status", "applied");
        if (error) throw new Error(`applyChangeSet revert ${cs.undoes_id}: ${error.message}`);
      }
    } catch (e) {
      await this.db.from("change_sets").update({ status: prior.status, applied_at: null, decided_at: cs.decided_at }).eq("id", id);
      throw e;
    }
    return "applied";
  }

  /** Conditional flip, like applyChangeSet's: only a still-proposed set expires. */
  async expireChangeSet(id: string, now: string) {
    const flipped = await must(
      this.db.from("change_sets").update({ status: "expired", decided_at: now }).eq("id", id).eq("status", "proposed").select("id"),
      `expireChangeSet ${id}`,
    );
    return flipped.length === 0 ? "skipped" : "expired";
  }

  /** Conditional flip, like expireChangeSet's: only a still-proposed set is cancelled. */
  async cancelChangeSet(id: string, now: string) {
    const flipped = await must(
      this.db.from("change_sets").update({ status: "cancelled", decided_at: now }).eq("id", id).eq("status", "proposed").select("id"),
      `cancelChangeSet ${id}`,
    );
    return flipped.length === 0 ? ("skipped" as const) : ("cancelled" as const);
  }

  private async writeEntity(venueId: string, c: Change) {
    if (isExternalEntity(c.entity)) return; // lives on the owner's WordPress site or social accounts; the destination push writes it
    if (isRecordOnlyEntity(c.entity)) return; // a saved ad plan: the change row is the whole record
    const table = TABLE[c.entity];
    if (c.entity === "site_text") {
      if (c.after === null) {
        const { error } = await this.db.from(table).delete().eq("venue_id", venueId).eq("key", c.entity_id);
        if (error) throw new Error(`delete site_text: ${error.message}`);
      } else {
        await must(this.db.from(table).upsert({ venue_id: venueId, key: c.entity_id, ...c.after }, { onConflict: "venue_id,key" }).select("key"), "upsert site_text");
      }
      return;
    }
    if (c.after === null) {
      const { error } = await this.db.from(table).delete().eq("id", c.entity_id);
      if (error) throw new Error(`delete ${c.entity} ${c.entity_id}: ${error.message}`);
      return;
    }
    if (c.before === null) {
      await must(this.db.from(table).upsert({ ...c.after, id: c.entity_id }, { onConflict: "id" }).select("id"), `insert ${c.entity} ${c.entity_id}`);
      return;
    }
    await mustRows(this.db.from(table).update(c.after).eq("id", c.entity_id).select("id"), `update ${c.entity} ${c.entity_id}`);
  }

  async listExpiredTimers(now: string, venueId?: string) {
    if (badVenue(venueId)) return [];
    let a = this.db.from("items").select("*").eq("active", true).not("sold_out_until", "is", null).lte("sold_out_until", now);
    let b = this.db.from("items").select("*").eq("is_special", true).eq("active", true).not("special_expires_at", "is", null).lte("special_expires_at", now);
    if (venueId) {
      a = a.eq("venue_id", venueId);
      b = b.eq("venue_id", venueId);
    }
    const [soldOut, specials] = await Promise.all([must(a, "expired sold-out"), must(b, "expired specials")]);
    const out: ExpiredTimer[] = [];
    for (const r of soldOut) out.push({ item: toItem(r), kind: "sold_out" });
    for (const r of specials) out.push({ item: toItem(r), kind: "special" });
    return out;
  }

  async saveMedia(venueId: string, bytes: Uint8Array, contentType: string, opts?: { name?: string }) {
    const id = crypto.randomUUID();
    const path = opts?.name ? `${venueId}/${opts.name}` : `${venueId}/${id}.${extensionFor(contentType)}`;
    const { error } = await this.db.storage.from("media").upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`saveMedia upload: ${error.message}`);
    const public_url = this.db.storage.from("media").getPublicUrl(path).data.publicUrl;
    return toMedia(await must(this.db.from("media").insert({ id, venue_id: venueId, storage_path: path, public_url }).select("*").single(), "saveMedia row"));
  }
  async findMediaByPath(storagePath: string) {
    const { data, error } = await this.db.from("media").select("*").eq("storage_path", storagePath).maybeSingle();
    if (error) throw new Error(`findMediaByPath: ${error.message}`);
    return data ? toMedia(data) : null;
  }
  async getMedia(id: string) {
    const { data, error } = await this.db.from("media").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getMedia: ${error.message}`);
    return data ? toMedia(data) : null;
  }

  async getConversation(venueId: string, chatRef: string) {
    const { data, error } = await this.db.from("conversations").select("*").eq("venue_id", venueId).eq("chat_ref", chatRef).maybeSingle();
    if (error) throw new Error(`getConversation: ${error.message}`);
    if (!data) return null;
    return { turns: (data.turns as Conversation["turns"]) ?? [], correction_for: strOrNull(data.correction_for), updated_at: iso(data.updated_at) };
  }
  async setConversation(venueId: string, chatRef: string, c: Conversation) {
    const row = { venue_id: venueId, chat_ref: chatRef, chat_id: legacyTelegramId(chatRef), turns: c.turns, correction_for: c.correction_for, updated_at: c.updated_at }; // legacy chat_id: remove in phase 2
    await must(this.db.from("conversations").upsert(row, { onConflict: "venue_id,chat_ref" }).select("chat_ref"), "setConversation");
  }

  async bumpRateLimit(key: string, windowMs: number, max: number, now: string) {
    const { data, error } = await this.db.rpc("bump_rate_limit", { p_key: key, p_window_ms: windowMs, p_max: max, p_now: now });
    if (error) throw new Error(`bumpRateLimit: ${error.message}`);
    return data === true;
  }

  // --- Destinations (integrations track, appended 2026-10-10) ---
  private withoutSecrets(d: DestinationWithSecrets): Destination {
    const { secrets: _secrets, ...rest } = d;
    void _secrets;
    return rest;
  }
  async upsertDestination(d: NewDestination): Promise<Destination> {
    const row = await must<Row>(
      this.db.from("venue_destinations")
        .upsert({ venue_id: d.venue_id, kind: d.kind, config: d.config, secrets: d.secrets, status: d.status ?? "connected", last_error: null, updated_at: new Date().toISOString() }, { onConflict: "venue_id,kind" })
        .select("*").single(),
      "upsertDestination",
    );
    return this.withoutSecrets(toDestination(row));
  }
  async getDestination(venueId: string, kind: DestinationKind) {
    if (badVenue(venueId)) return null;
    const { data, error } = await this.db.from("venue_destinations").select("*").eq("venue_id", venueId).eq("kind", kind).maybeSingle();
    if (error) throw new Error(`getDestination: ${error.message}`);
    return data ? toDestination(data) : null;
  }
  async listDestinations(venueId: string) {
    if (badVenue(venueId)) return [];
    const rows = await must(this.db.from("venue_destinations").select("*").eq("venue_id", venueId).order("created_at"), "listDestinations");
    return rows.map((r) => this.withoutSecrets(toDestination(r)));
  }
  async updateDestination(id: string, patch: DestinationPatch) {
    const row: Row = { updated_at: new Date().toISOString() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.last_error !== undefined) row.last_error = patch.last_error;
    if (patch.config !== undefined) row.config = patch.config;
    await mustRows(this.db.from("venue_destinations").update(row).eq("id", id).select("id"), `updateDestination ${id}`);
  }
  async deleteDestination(id: string) {
    const { error } = await this.db.from("venue_destinations").delete().eq("id", id);
    if (error) throw new Error(`deleteDestination ${id}: ${error.message}`);
  }
  async createSync(s: NewSync): Promise<DestinationSync> {
    return toSync(await must(this.db.from("destination_syncs").insert({ venue_id: s.venue_id, destination_id: s.destination_id, change_set_id: s.change_set_id, payload: s.payload, next_at: s.next_at }).select("*").single(), "createSync"));
  }
  async getSync(id: string) {
    return toSync(await must(this.db.from("destination_syncs").select("*").eq("id", id).single(), `getSync ${id}`));
  }
  async listSyncs(opts: ListSyncsOpts) {
    if (badVenue(opts.venueId)) return [];
    const ascending = opts.order !== "desc";
    let q = this.db.from("destination_syncs").select("*").order("created_at", { ascending }).order("id", { ascending });
    if (opts.venueId) q = q.eq("venue_id", opts.venueId);
    if (opts.changeSetId) q = q.eq("change_set_id", opts.changeSetId);
    if (opts.status) q = q.in("status", opts.status);
    if (opts.dueBefore) q = q.lte("next_at", opts.dueBefore);
    if (opts.createdSince) q = q.gte("created_at", opts.createdSince);
    if (opts.limit) q = q.limit(opts.limit);
    return (await must(q, "listSyncs")).map(toSync);
  }
  async updateSync(id: string, patch: SyncPatch) {
    const row: Row = { updated_at: patch.updated_at ?? new Date().toISOString() };
    for (const k of ["status", "attempts", "next_at", "last_error", "result"] as const) if (patch[k] !== undefined) row[k] = patch[k];
    if (patch.leased_until !== undefined && this.hasSyncLease !== false) row.leased_until = patch.leased_until;
    await mustRows(this.db.from("destination_syncs").update(row).eq("id", id).select("id"), `updateSync ${id}`);
  }
  /** False once the database answered that destination_syncs.leased_until does not exist (schema-integrations.sql not applied yet). */
  private hasSyncLease: boolean | undefined;
  /** Conditional update: only a free row (no lease, or an ended one) is taken; Postgres row locking makes it one winner. */
  async claimSync(id: string, now: string, leaseUntil: string) {
    if (this.hasSyncLease === false) return true;
    const { data, error } = await this.db
      .from("destination_syncs")
      .update({ leased_until: leaseUntil })
      .eq("id", id)
      .eq("status", "pending")
      .or(`leased_until.is.null,leased_until.lte."${now}"`)
      .select("id");
    if (error) {
      // Before the column exists every push would fail; keep pushing unleased and say so once.
      if (/leased_until/.test(error.message)) {
        this.hasSyncLease = false;
        console.warn("[destinations] destination_syncs.leased_until is missing; apply supabase/schema-integrations.sql (pushes run without a lease until then)");
        return true;
      }
      throw new Error(`claimSync ${id}: ${error.message}`);
    }
    return (data ?? []).length > 0;
  }

  // --- Monthly change limit (appended 2026-10-13) ---
  async countAppliedChangeSets(venueId: string, fromIso: string, toIso: string) {
    if (badVenue(venueId)) return 0;
    // The sources that never count are left out in SQL; the by-op exemption (a set made only of set_comment_mode rows) needs
    // each set's ops, so the window's sets come back with them and countsTowardLimit decides. A venue applies at most
    // hundreds of sets a month, far below PostgREST's row cap.
    const { data, error } = await this.db
      .from("change_sets")
      .select("source, changes(op)")
      .eq("venue_id", venueId)
      .gte("applied_at", fromIso)
      .lt("applied_at", toIso)
      .not("source", "in", "(undo,auto,comment)");
    if (error) throw new Error(`countAppliedChangeSets: ${error.message}`);
    return ((data ?? []) as { source: ChangeSet["source"]; changes: { op: Change["op"] }[] | null }[]).filter((r) => countsTowardLimit(r.source, r.changes ?? [])).length;
  }
  async setChangeLimit(venueId: string, limit: number | null) {
    checkLimitValue(limit);
    if (badVenue(venueId)) throw new Error(`setChangeLimit ${venueId}: not found`);
    const { data, error } = await this.db.from("venues").update({ change_limit: limit }).eq("id", venueId).select("*").maybeSingle();
    if (error) throw new Error(`setChangeLimit ${venueId}: ${error.message}`);
    if (!data) throw new Error(`setChangeLimit ${venueId}: not found`);
    return this.venue(data);
  }

  // --- Meta data deletion (appended 2026-10-14) ---
  async findDestinationsByConfig(kind: DestinationKind, key: string, value: string) {
    if (!CONFIG_KEY_RE.test(key)) throw new Error(`findDestinationsByConfig: bad key ${key}`);
    const rows = await must(this.db.from("venue_destinations").select("*").eq("kind", kind).eq(`config->>${key}`, value).order("created_at"), "findDestinationsByConfig");
    return rows.map((r) => this.withoutSecrets(toDestination(r)));
  }
  async createDeletionRequest(r: { provider: DeletionProvider; subject_id: string; now: string }) {
    const row = await must<Row>(
      this.db.from("data_deletion_requests").insert({ provider: r.provider, subject_id: r.subject_id, confirmation_code: newConfirmationCode(), status: "pending", created_at: r.now }).select("*").single(),
      "createDeletionRequest",
    );
    return toDeletionRequest(row);
  }
  async completeDeletionRequest(code: string, now: string) {
    const { error } = await this.db.from("data_deletion_requests").update({ status: "completed", completed_at: now }).eq("confirmation_code", code);
    if (error) throw new Error(`completeDeletionRequest: ${error.message}`);
  }
  async getDeletionRequest(code: string) {
    const { data, error } = await this.db.from("data_deletion_requests").select("*").eq("confirmation_code", code).maybeSingle();
    if (error) throw new Error(`getDeletionRequest: ${error.message}`);
    return data ? toDeletionRequest(data) : null;
  }

  // --- Comment replies (appended 2026-10-15) ---
  async upsertComments(venueId: string, rows: NewSocialComment[]) {
    if (rows.length === 0 || badVenue(venueId)) return [];
    // ON CONFLICT (comment_id) DO NOTHING; RETURNING gives only the rows that were inserted.
    const { data, error } = await this.db
      .from("social_comments")
      .upsert(rows.map((r) => ({ venue_id: venueId, ...r, post_permalink: r.post_permalink ?? null })), { onConflict: "comment_id", ignoreDuplicates: true })
      .select("*");
    if (error) throw new Error(`upsertComments: ${error.message}`);
    const order = (c: SocialComment) => rows.findIndex((r) => r.comment_id === c.comment_id);
    return (data ?? []).map(toComment).sort((a, b) => order(a) - order(b));
  }
  async listComments(venueId: string, opts: ListCommentsOpts = {}) {
    if (badVenue(venueId) || (opts.changeSetId !== undefined && !UUID.test(opts.changeSetId))) return [];
    let q = this.db.from("social_comments").select("*").eq("venue_id", venueId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(opts.limit ?? 100);
    if (opts.status) q = q.in("status", opts.status);
    if (opts.since) q = q.gte("created_at", opts.since);
    if (opts.changeSetId !== undefined) q = q.eq("change_set_id", opts.changeSetId);
    return (await must(q, "listComments")).map(toComment);
  }
  async getComment(id: string) {
    if (!UUID.test(id)) return null;
    const { data, error } = await this.db.from("social_comments").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getComment: ${error.message}`);
    return data ? toComment(data) : null;
  }
  async findComment(venueId: string, commentId: string) {
    if (badVenue(venueId)) return null;
    const { data, error } = await this.db.from("social_comments").select("*").eq("venue_id", venueId).eq("comment_id", commentId).maybeSingle();
    if (error) throw new Error(`findComment: ${error.message}`);
    return data ? toComment(data) : null;
  }
  async updateComment(id: string, patch: SocialCommentPatch) {
    const clean: Row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) {
      if (!(await this.getComment(id))) throw new Error(`updateComment ${id}: not found`);
      return;
    }
    if (!UUID.test(id)) throw new Error(`updateComment ${id}: not found`);
    await mustRows(this.db.from("social_comments").update(clean).eq("id", id).select("id"), `updateComment ${id}`);
  }
  async purgeComments(before: string) {
    const { data, error } = await this.db.from("social_comments").delete().lt("created_at", before).select("id");
    if (error) throw new Error(`purgeComments: ${error.message}`);
    return (data ?? []).length;
  }
  async redactComments(before: string) {
    // Plain filters instead of an or(): rows with text left, then rows with only an author name or id left (none after the first).
    let n = 0;
    for (const column of ["text", "author_name", "author_id"] as const) {
      const { data, error } = await this.db.from("social_comments").update({ text: "", author_name: "", author_id: "" }).lt("created_at", before).neq(column, "").select("id");
      if (error) throw new Error(`redactComments: ${error.message}`);
      n += (data ?? []).length;
    }
    return n;
  }
  async redactCommentSets(before: string, venueId?: string) {
    if (badVenue(venueId)) return 0;
    // At most 200 sets per call (the next tick takes the rest); a redacted set no longer matches (its summary_en is the fixed line).
    let q = this.db.from("change_sets").select("id, changes(id, before, after)").eq("source", "comment").lt("created_at", before).neq("summary_en", COMMENT_REDACTED.en).order("created_at").limit(200);
    if (venueId) q = q.eq("venue_id", venueId);
    const sets = await must<Row[]>(q, "redactCommentSets");
    for (const cs of sets) {
      for (const c of (cs.changes as Row[] | null) ?? []) {
        const row = { before: redactCommentRow((c.before as Row | null) ?? null), after: redactCommentRow((c.after as Row | null) ?? null) };
        await mustRows(this.db.from("changes").update(row).eq("id", c.id as string).select("id"), "redactCommentSets change");
      }
      await mustRows(this.db.from("change_sets").update({ summary_bg: COMMENT_REDACTED.bg, summary_en: COMMENT_REDACTED.en, preview_bg: COMMENT_REDACTED.bg, preview_en: COMMENT_REDACTED.en }).eq("id", cs.id as string).select("id"), "redactCommentSets set");
    }
    return sets.length;
  }
  async countCommentActions(venueId: string, fromIso: string, toIso: string) {
    if (badVenue(venueId)) return 0;
    const { count, error } = await this.db
      .from("social_comments")
      .select("id", { count: "exact", head: true })
      .eq("venue_id", venueId)
      .in("status", ["replied", "hidden", "deleted"])
      .gte("replied_at", fromIso)
      .lt("replied_at", toIso);
    if (error) throw new Error(`countCommentActions: ${error.message}`);
    return count ?? 0;
  }

  // --- Translations (appended 2026-10-16) ---
  async getTranslation(lang: ChatLang, sourceHash: string) {
    const { data, error } = await this.db.from("translations").select("text").eq("lang", lang).eq("source_hash", sourceHash).maybeSingle();
    if (error) throw new Error(`getTranslation: ${error.message}`);
    return data ? str(data.text) : null;
  }
  async putTranslation(lang: ChatLang, sourceHash: string, text: string) {
    checkMemberLang(lang); // the column check would refuse it anyway; this fails before the round trip
    await must(this.db.from("translations").upsert({ lang, source_hash: sourceHash, text }, { onConflict: "lang,source_hash" }).select("lang"), "putTranslation");
  }

  // --- Venue surroundings (appended 2026-10-18) ---
  async getSurroundings(venueId: string) {
    const { data, error } = await this.db.from("venue_surroundings").select("*").eq("venue_id", venueId).maybeSingle();
    if (error) throw new Error(`getSurroundings: ${error.message}`);
    if (!data) return null;
    return { venue_id: str(data.venue_id), address: str(data.address), lat: data.lat === null ? null : num(data.lat), lng: data.lng === null ? null : num(data.lng), places: (data.places ?? []) as Place[], fetched_at: isoOrNull(data.fetched_at), failed_at: isoOrNull(data.failed_at) };
  }
  async putSurroundings(row: VenueSurroundings) {
    await must(this.db.from("venue_surroundings").upsert(row, { onConflict: "venue_id" }).select("venue_id"), "putSurroundings");
  }

  // --- Accounts (appended 2026-10-19) ---
  async linkVenueUser(venueId: string, userId: string, role: Role) {
    // ON CONFLICT DO NOTHING: a second link changes nothing, so an owner is never downgraded.
    await must(this.db.from("venue_users").upsert({ venue_id: venueId, user_id: userId, role }, { onConflict: "venue_id,user_id", ignoreDuplicates: true }).select("venue_id"), "linkVenueUser");
  }
  async listVenuesForUser(userId: string) {
    if (badVenue(userId)) return [];
    const links = await must(this.db.from("venue_users").select("venue_id").eq("user_id", userId), "listVenuesForUser");
    if (links.length === 0) return [];
    const rows = await must(this.db.from("venues").select("*").in("id", links.map((l) => l.venue_id as string)).order("created_at").order("id"), "listVenuesForUser venues");
    return rows.map((r) => this.venue(r));
  }
  async isVenueOwner(venueId: string, userId: string) {
    if (badVenue(venueId) || badVenue(userId)) return false;
    const { data, error } = await this.db.from("venue_users").select("role").eq("venue_id", venueId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`isVenueOwner: ${error.message}`);
    return data?.role === "owner";
  }
  async hasOwnerAccount(venueId: string) {
    if (badVenue(venueId)) return false;
    const { data, error } = await this.db.from("venue_users").select("user_id").eq("venue_id", venueId).eq("role", "owner").limit(1);
    if (error) throw new Error(`hasOwnerAccount: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
  async createPendingAccountInvite(venueId: string, email: string) {
    // A pending invite stays as it is (like the memory store); a claimed one is reopened with a fresh created_at.
    const e = email.trim().toLowerCase();
    const { data, error } = await this.db.from("account_invites").select("claimed_at").eq("venue_id", venueId).eq("email", e).maybeSingle();
    if (error) throw new Error(`createPendingAccountInvite: ${error.message}`);
    if (data && data.claimed_at === null) return;
    await must(this.db.from("account_invites").upsert({ venue_id: venueId, email: e, created_at: new Date().toISOString(), claimed_at: null }, { onConflict: "venue_id,email" }).select("venue_id"), "createPendingAccountInvite");
  }
  async claimAccountInvites(userId: string, email: string) {
    const e = email.trim().toLowerCase();
    const pending = await must(this.db.from("account_invites").select("venue_id").eq("email", e).is("claimed_at", null), "claimAccountInvites");
    if (pending.length === 0) return [];
    const ids = pending.map((r) => r.venue_id as string);
    // Link first (an invite makes the account an owner, lifting an earlier staff link), then mark claimed: a crash in between retries next sign-in.
    await must(this.db.from("venue_users").upsert(ids.map((venue_id) => ({ venue_id, user_id: userId, role: "owner" })), { onConflict: "venue_id,user_id" }).select("venue_id"), "claimAccountInvites link");
    // Only the call that flips claimed_at gets the ids, so two concurrent sign-ins never both report them.
    const claimed = await must(this.db.from("account_invites").update({ claimed_at: new Date().toISOString() }).eq("email", e).is("claimed_at", null).in("venue_id", ids).select("venue_id"), "claimAccountInvites mark");
    return claimed.map((r) => r.venue_id as string);
  }
}

export function toDeletionRequest(r: Row): DataDeletionRequest {
  return {
    id: r.id as string,
    provider: r.provider as DeletionProvider,
    subject_id: str(r.subject_id),
    confirmation_code: str(r.confirmation_code),
    status: r.status as DeletionStatus,
    created_at: iso(r.created_at),
    completed_at: r.completed_at ? iso(r.completed_at) : null,
  };
}

// --- Destinations (integrations track, appended 2026-10-10) ---
export function toDestination(r: Row): DestinationWithSecrets {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    kind: r.kind as DestinationKind,
    config: (r.config as Record<string, unknown>) ?? {},
    secrets: str(r.secrets),
    status: (r.status as Destination["status"]) ?? "connected",
    last_error: strOrNull(r.last_error),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
export function toSync(r: Row): DestinationSync {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    destination_id: r.destination_id as string,
    change_set_id: r.change_set_id as string,
    status: r.status as SyncStatus,
    attempts: num(r.attempts),
    next_at: iso(r.next_at),
    last_error: strOrNull(r.last_error),
    payload: (r.payload as Record<string, unknown>) ?? {},
    result: (r.result as Record<string, unknown> | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    leased_until: r.leased_until ? iso(r.leased_until) : null,
  };
}

// --- Comment replies (appended 2026-10-15) ---
export function toComment(r: Row): SocialComment {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    network: r.network as SocialComment["network"],
    post_ref: str(r.post_ref),
    comment_id: str(r.comment_id),
    parent_id: strOrNull(r.parent_id),
    author_id: str(r.author_id),
    author_name: str(r.author_name),
    text: str(r.text),
    created_at: iso(r.created_at),
    seen_at: iso(r.seen_at),
    status: (r.status as CommentStatus) ?? "new",
    change_set_id: strOrNull(r.change_set_id),
    reply_id: strOrNull(r.reply_id),
    replied_at: isoOrNull(r.replied_at),
    post_caption: str(r.post_caption),
    post_permalink: strOrNull(r.post_permalink),
    draft_text: strOrNull(r.draft_text),
    draft_kind: strOrNull(r.draft_kind),
    deferred: Boolean(r.deferred),
    hold_attempts: num(r.hold_attempts ?? 0),
    held_at: isoOrNull(r.held_at),
  };
}
