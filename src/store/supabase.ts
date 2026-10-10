// src/store/supabase.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Announcement, BusinessType, Category, Change, ChangeSet, Conversation, DeployInfo, DeployStatus, Holiday, Item, Lang, Media, Member, Role, SiteState, SiteText, SiteTextKey, TemplateId, Venue, VenueStatus } from "../domain/types";
import type { WizardDraft } from "../wizard/schema";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, PUBLISH_CLAIM_TTL_MS, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store, type VenuePatch } from "./types";

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string } | null;

const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
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
    tz: str(r.tz) || "Europe/Sofia",
    default_lang: (r.default_lang as Lang) ?? "bg",
    theme: (r.theme as Venue["theme"]) ?? { accent: "#2f6b4f" },
    template: (r.template as TemplateId) ?? "classic",
    business_type: (r.business_type as BusinessType) ?? "cafe",
    status: (r.status as VenueStatus) ?? "live",
    deploy: (r.deploy as DeployInfo | null) ?? null,
    wizard_draft: (r.wizard_draft as WizardDraft | null) ?? null,
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
  return { venue_id: r.venue_id as string, tg_chat_id: num(r.tg_chat_id), role: r.role as Role, lang: (r.lang as Lang) ?? "bg", created_at: iso(r.created_at) };
}
export function toChange(r: Row): Change {
  return { position: num(r.position), op: r.op as Change["op"], entity: r.entity as Change["entity"], entity_id: str(r.entity_id), before: (r.before as Row | null) ?? null, after: (r.after as Row | null) ?? null };
}
export function toChangeSet(r: Row): ChangeSet {
  return {
    id: r.id as string,
    venue_id: r.venue_id as string,
    chat_id: numOrNull(r.chat_id),
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
    tg_message_id: numOrNull(r.tg_message_id),
    created_at: iso(r.created_at),
    changes: ((r.changes as Row[]) ?? []).map(toChange).sort((a, b) => a.position - b.position),
  };
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
const TABLE: Record<Change["entity"], string> = { venue: "venues", category: "categories", item: "items", holiday: "holidays", announcement: "announcements", media: "media", site_text: "site_texts" };

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
  async claimDeploy(id: string, next: DeployInfo, opts: { whenStatusIn: (DeployStatus | null)[] }) {
    if (badVenue(id)) return false;
    // One conditional UPDATE: the row filter is the claim, so two concurrent callers cannot both see the old status.
    const statuses = opts.whenStatusIn.filter((s): s is DeployStatus => s !== null);
    const parts = [...(opts.whenStatusIn.includes(null) ? ["deploy.is.null"] : []), ...(statuses.length ? [`deploy->>status.in.(${statuses.join(",")})`] : [])];
    if (parts.length === 0) return false;
    const { data, error } = await this.db.from("venues").update({ deploy: next }).eq("id", id).or(parts.join(",")).select("id");
    if (error) throw new Error(`claimDeploy ${id}: ${error.message}`);
    return (data?.length ?? 0) === 1;
  }
  async claimPublish(id: string, now = new Date().toISOString()) {
    if (badVenue(id)) return false;
    const stale = new Date(Date.parse(now) - PUBLISH_CLAIM_TTL_MS).toISOString();
    const { data, error } = await this.db.from("venues").update({ publishing_at: now }).eq("id", id).eq("status", "draft").or(`publishing_at.is.null,publishing_at.lt.${stale}`).select("id");
    if (error) throw new Error(`claimPublish ${id}: ${error.message}`);
    return (data?.length ?? 0) === 1;
  }
  async setDraftToken(id: string, tokenHash: string | null) {
    await mustRows(this.db.from("venues").update({ draft_token_hash: tokenHash }).eq("id", id).select("id"), `setDraftToken ${id}`);
  }
  async findVenueByDraftToken(tokenHash: string) {
    const { data, error } = await this.db.from("venues").select("*").eq("draft_token_hash", tokenHash).maybeSingle();
    if (error) throw new Error(`findVenueByDraftToken: ${error.message}`);
    return data ? this.venue(data) : null;
  }
  async deleteVenue(id: string) {
    if (badVenue(id)) return;
    const { error } = await this.db.from("venues").delete().eq("id", id);
    if (error) throw new Error(`deleteVenue ${id}: ${error.message}`);
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

  async findMember(chatId: number) {
    const { data, error } = await this.db.from("venue_members").select("*").eq("tg_chat_id", chatId).maybeSingle();
    if (error) throw new Error(`findMember: ${error.message}`);
    return data ? toMember(data) : null;
  }
  async listMembers(venueId: string) {
    if (badVenue(venueId)) return [];
    return (await must(this.db.from("venue_members").select("*").eq("venue_id", venueId).order("created_at"), "listMembers")).map(toMember);
  }
  async upsertMember(m: Omit<Member, "created_at">) {
    // One venue per chat: drop any previous link first (the unique index on tg_chat_id would reject it).
    const { error } = await this.db.from("venue_members").delete().eq("tg_chat_id", m.tg_chat_id).neq("venue_id", m.venue_id);
    if (error) throw new Error(`upsertMember unlink: ${error.message}`);
    return toMember(await must(this.db.from("venue_members").upsert(m, { onConflict: "venue_id,tg_chat_id" }).select("*").single(), "upsertMember"));
  }
  async setMemberLang(venueId: string, chatId: number, lang: Lang) {
    await mustRows(this.db.from("venue_members").update({ lang }).eq("venue_id", venueId).eq("tg_chat_id", chatId).select("tg_chat_id"), "setMemberLang");
  }
  async createInvite(venueId: string, role: Role, expiresAt: string) {
    const code = newInviteCode();
    await must(this.db.from("venue_invites").insert({ code, venue_id: venueId, role, expires_at: expiresAt }).select("code"), "createInvite");
    return code;
  }
  async redeemInvite(code: string, chatId: number, lang: Lang, now: string) {
    const rows = await must(
      this.db.from("venue_invites").update({ used_at: now }).eq("code", code).is("used_at", null).gt("expires_at", now).select("*"),
      "redeemInvite",
    );
    if (rows.length === 0) return null;
    return this.upsertMember({ venue_id: rows[0].venue_id as string, tg_chat_id: chatId, role: rows[0].role as Role, lang });
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

  async createChangeSet(cs: NewChangeSet) {
    const { changes, ...head } = cs;
    const row = await must<Row>(this.db.from("change_sets").insert({ ...head, apply_at: head.apply_at ?? null, undoes_id: head.undoes_id ?? null, tg_message_id: head.tg_message_id ?? null }).select("*").single(), "createChangeSet");
    if (changes.length) {
      await must(this.db.from("changes").insert(changes.map((c, i) => ({ change_set_id: row.id, position: i, op: c.op, entity: c.entity, entity_id: c.entity_id, before: c.before, after: c.after }))).select("id"), "createChangeSet changes");
    }
    return this.getChangeSet(row.id as string);
  }
  async getChangeSet(id: string) {
    return toChangeSet(await must(this.db.from("change_sets").select(SET_SELECT).eq("id", id).single(), `getChangeSet ${id}`));
  }
  async findProposed(venueId: string, chatId: number) {
    const rows = await must(this.db.from("change_sets").select(SET_SELECT).eq("venue_id", venueId).eq("chat_id", chatId).eq("status", "proposed").order("created_at", { ascending: false }).limit(1), "findProposed");
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
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) return;
    await mustRows(this.db.from("change_sets").update(clean).eq("id", id).select("id"), `updateChangeSet ${id}`);
  }

  /**
   * Conditional status flip first (so two appliers cannot both write), then the entity writes.
   * If any write fails, the set is reset to its prior status so it can be retried (every write is idempotent).
   */
  async applyChangeSet(id: string, now: string) {
    const prior = await must<{ status: ChangeSet["status"] }>(this.db.from("change_sets").select("status").eq("id", id).maybeSingle(), `applyChangeSet ${id}`);
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

  private async writeEntity(venueId: string, c: Change) {
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

  async saveMedia(venueId: string, bytes: Uint8Array, contentType: string) {
    const id = crypto.randomUUID();
    const path = `${venueId}/${id}.${extensionFor(contentType)}`;
    const { error } = await this.db.storage.from("media").upload(path, bytes, { contentType, upsert: false });
    if (error) throw new Error(`saveMedia upload: ${error.message}`);
    const public_url = this.db.storage.from("media").getPublicUrl(path).data.publicUrl;
    return toMedia(await must(this.db.from("media").insert({ id, venue_id: venueId, storage_path: path, public_url }).select("*").single(), "saveMedia row"));
  }
  async getMedia(id: string) {
    const { data, error } = await this.db.from("media").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`getMedia: ${error.message}`);
    return data ? toMedia(data) : null;
  }

  async getConversation(venueId: string, chatId: number) {
    const { data, error } = await this.db.from("conversations").select("*").eq("venue_id", venueId).eq("chat_id", chatId).maybeSingle();
    if (error) throw new Error(`getConversation: ${error.message}`);
    if (!data) return null;
    return { turns: (data.turns as Conversation["turns"]) ?? [], correction_for: strOrNull(data.correction_for), updated_at: iso(data.updated_at) };
  }
  async setConversation(venueId: string, chatId: number, c: Conversation) {
    await must(this.db.from("conversations").upsert({ venue_id: venueId, chat_id: chatId, turns: c.turns, correction_for: c.correction_for, updated_at: c.updated_at }, { onConflict: "venue_id,chat_id" }).select("chat_id"), "setConversation");
  }

  async bumpRateLimit(key: string, windowMs: number, max: number, now: string) {
    const { data, error } = await this.db.rpc("bump_rate_limit", { p_key: key, p_window_ms: windowMs, p_max: max, p_now: now });
    if (error) throw new Error(`bumpRateLimit: ${error.message}`);
    return data === true;
  }
}
