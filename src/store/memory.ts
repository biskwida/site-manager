// src/store/memory.ts
import { applyChanges } from "../domain/changes";
import type { Category, ChangeSet, Conversation, DeployInfo, DeployStatus, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, Venue, VenueStatus } from "../domain/types";
import { DEFAULT_HOURS, extensionFor, newInviteCode, newToken, PUBLISH_CLAIM_TTL_MS, type ChangeSetPatch, type ExpiredTimer, type NewCategory, type NewChangeSet, type NewItem, type NewVenue, type Store, type VenuePatch, type Destination, type DestinationKind, type DestinationPatch, type DestinationSync, type DestinationWithSecrets, type NewDestination, type NewSync, type SyncPatch, type SyncStatus } from "./types";

const clone = <T>(v: T): T => structuredClone(v);

interface Invite {
  code: string;
  venue_id: string;
  role: Role;
  expires_at: string;
  used_at: string | null;
}

export class InMemoryStore implements Store {
  sites = new Map<string, SiteState>();
  members = new Map<string, Member>(); // one venue per chat
  invites = new Map<string, Invite>();
  tokens = new Map<string, string>(); // venue id -> token
  sets = new Map<string, ChangeSet>();
  conversations = new Map<string, Conversation>();
  files = new Map<string, Uint8Array>();
  draftTokens = new Map<string, string>(); // venue id -> sha256 of the draft token
  publishing = new Map<string, string>(); // venue id -> ISO time of the last publish claim
  rateLimits = new Map<string, { count: number; window_start: number }>();
  private lastTick = 0;
  /** Strictly increasing clock for created_at (so newest-first ordering is stable); tests may override. */
  clock: () => string = () => {
    const t = Math.max(Date.now(), this.lastTick + 1);
    this.lastTick = t;
    return new Date(t).toISOString();
  };

  private site(id: string): SiteState {
    const s = this.sites.get(id);
    if (!s) throw new Error(`venue ${id} not found`);
    return s;
  }

  async createVenue(v: NewVenue): Promise<Venue> {
    const venue: Venue = {
      id: crypto.randomUUID(),
      slug: v.slug,
      name: v.name,
      tagline_bg: v.tagline_bg ?? "",
      tagline_en: v.tagline_en ?? "",
      about_bg: v.about_bg ?? "",
      about_en: v.about_en ?? "",
      address: v.address ?? "",
      phone: v.phone ?? "",
      maps_url: v.maps_url ?? "",
      instagram: v.instagram ?? "",
      cover_media_id: null,
      logo_media_id: null,
      hours: clone(v.hours ?? DEFAULT_HOURS),
      tz: v.tz ?? "Europe/Sofia",
      default_lang: v.default_lang ?? "bg",
      theme: clone(v.theme ?? { accent: "#2f6b4f" }),
      template: v.template ?? "classic",
      business_type: v.business_type ?? "cafe",
      status: v.status ?? "live",
      deploy: null,
      wizard_draft: v.wizard_draft ? clone(v.wizard_draft) : null,
      instagram_import: null,
      created_at: this.clock(),
    };
    if ([...this.sites.values()].some((s) => s.venue.slug === venue.slug)) throw new Error(`slug ${venue.slug} already exists`);
    this.sites.set(venue.id, { venue, categories: [], items: [], holidays: [], announcements: [], media: [], texts: [] });
    return clone(venue);
  }
  async getVenue(id: string) {
    return clone(this.site(id).venue);
  }
  async getVenueBySlug(slug: string) {
    const s = [...this.sites.values()].find((x) => x.venue.slug === slug);
    return s ? clone(s.venue) : null;
  }
  async listVenues(opts: { status?: VenueStatus; deploying?: boolean } = {}) {
    return [...this.sites.values()]
      .map((s) => s.venue)
      .filter((v) => (!opts.status || v.status === opts.status) && (!opts.deploying || (v.deploy !== null && (v.deploy.status === "pending" || v.deploy.status === "building"))))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(clone);
  }
  async updateVenue(id: string, patch: VenuePatch): Promise<Venue> {
    const s = this.site(id);
    if (patch.slug !== undefined && [...this.sites.values()].some((x) => x.venue.id !== id && x.venue.slug === patch.slug)) throw new Error(`slug ${patch.slug} already exists`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (s.venue as unknown as Record<string, unknown>)[k] = clone(v);
    return clone(s.venue);
  }
  async setDeploy(id: string, deploy: DeployInfo | null) {
    this.site(id).venue.deploy = deploy ? clone(deploy) : null;
  }
  async claimDeploy(id: string, next: DeployInfo, opts: { whenStatusIn: (DeployStatus | null)[]; whenDeploymentId?: string }) {
    const s = this.sites.get(id);
    if (!s || !opts.whenStatusIn.includes(s.venue.deploy?.status ?? null)) return false;
    if (opts.whenDeploymentId !== undefined && s.venue.deploy?.deployment_id !== opts.whenDeploymentId) return false;
    s.venue.deploy = clone(next);
    return true;
  }
  async claimPublish(id: string, now = this.clock()) {
    const s = this.sites.get(id);
    if (!s || s.venue.status !== "draft") return false;
    const prev = this.publishing.get(id);
    if (prev && Date.parse(now) - Date.parse(prev) < PUBLISH_CLAIM_TTL_MS) return false;
    this.publishing.set(id, now);
    return true;
  }
  async releasePublish(id: string) {
    this.publishing.delete(id);
  }
  async setDraftToken(id: string, tokenHash: string | null) {
    this.site(id);
    if (tokenHash === null) this.draftTokens.delete(id);
    else this.draftTokens.set(id, tokenHash);
  }
  async findVenueByDraftToken(tokenHash: string) {
    for (const [venueId, h] of this.draftTokens) if (h === tokenHash && this.sites.has(venueId)) return this.getVenue(venueId);
    return null;
  }
  async deleteVenue(id: string, opts: { withStorage?: boolean } = {}) {
    if (opts.withStorage) for (const path of [...this.files.keys()]) if (path.startsWith(`${id}/`)) this.files.delete(path);
    if (!this.sites.has(id)) return;
    this.sites.delete(id);
    this.draftTokens.delete(id);
    this.publishing.delete(id);
    this.tokens.delete(id);
    for (const [chatRef, m] of this.members) if (m.venue_id === id) this.members.delete(chatRef);
    for (const [code, inv] of this.invites) if (inv.venue_id === id) this.invites.delete(code);
    for (const [setId, cs] of this.sets) if (cs.venue_id === id) this.sets.delete(setId);
    for (const key of [...this.conversations.keys()]) if (key.startsWith(`${id}:`)) this.conversations.delete(key);
    for (const [did, d] of this.destinations) if (d.venue_id === id) this.destinations.delete(did);
    for (const [sid, s] of this.syncs) if (s.venue_id === id) this.syncs.delete(sid);
  }
  async getSite(venueId: string) {
    return clone(this.site(venueId));
  }
  async insertCategory(c: NewCategory): Promise<Category> {
    const row: Category = { id: crypto.randomUUID(), active: true, ...c };
    this.site(c.venue_id).categories.push(row);
    return clone(row);
  }
  async insertItem(i: NewItem): Promise<Item> {
    const now = this.clock();
    const row: Item = {
      id: crypto.randomUUID(),
      venue_id: i.venue_id,
      category_id: i.category_id,
      name_bg: i.name_bg,
      name_en: i.name_en,
      desc_bg: i.desc_bg,
      desc_en: i.desc_en,
      price_eur: i.price_eur,
      allergens: [...i.allergens],
      image_media_id: i.image_media_id ?? null,
      sold_out_until: null,
      is_special: i.is_special ?? false,
      special_expires_at: i.special_expires_at ?? null,
      position: i.position,
      active: true,
      created_at: now,
      updated_at: now,
    };
    this.site(i.venue_id).items.push(row);
    return clone(row);
  }
  async setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string) {
    const s = this.site(venueId);
    const existing = s.texts.find((t) => t.key === key);
    if (existing) Object.assign(existing, { text_bg, text_en });
    else s.texts.push({ venue_id: venueId, key, text_bg, text_en });
  }
  async clearMenu(venueId: string) {
    const s = this.site(venueId);
    s.items = [];
    s.categories = [];
    s.texts = [];
  }
  async clearVenueContent(venueId: string) {
    const s = this.site(venueId);
    s.categories = [];
    s.items = [];
    s.holidays = [];
    s.announcements = [];
    s.media = [];
    s.texts = [];
    for (const [id, cs] of this.sets) if (cs.venue_id === venueId) this.sets.delete(id);
    for (const key of [...this.conversations.keys()]) if (key.startsWith(`${venueId}:`)) this.conversations.delete(key);
    for (const [sid, s] of this.syncs) if (s.venue_id === venueId) this.syncs.delete(sid);
  }

  async findMember(chatRef: string) {
    const m = this.members.get(chatRef);
    return m ? clone(m) : null;
  }
  async listMembers(venueId: string) {
    return [...this.members.values()].filter((m) => m.venue_id === venueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(clone);
  }
  async upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }) {
    const prev = this.members.get(m.chat_ref);
    const row: Member = { ...m, last_seen_at: m.last_seen_at ?? prev?.last_seen_at ?? null, created_at: prev?.created_at ?? this.clock() };
    this.members.set(m.chat_ref, row);
    return clone(row);
  }
  async setMemberLang(venueId: string, chatRef: string, lang: Lang) {
    const m = this.members.get(chatRef);
    if (!m || m.venue_id !== venueId) throw new Error(`member ${chatRef} not found`);
    m.lang = lang;
  }
  async touchMember(chatRef: string, nowIso: string) {
    const m = this.members.get(chatRef);
    if (m) m.last_seen_at = nowIso;
  }
  async createInvite(venueId: string, role: Role, expiresAt: string) {
    this.site(venueId);
    const code = newInviteCode();
    this.invites.set(code, { code, venue_id: venueId, role, expires_at: expiresAt, used_at: null });
    return code;
  }
  async findOpenInvite(venueId: string, role: Role, now: string) {
    const open = [...this.invites.values()].filter((i) => i.venue_id === venueId && i.role === role && i.used_at === null && Date.parse(i.expires_at) > Date.parse(now));
    open.sort((a, b) => b.expires_at.localeCompare(a.expires_at));
    return open[0]?.code ?? null;
  }
  async redeemInvite(code: string, chatRef: string, lang: Lang, now: string) {
    const inv = this.invites.get(code);
    if (!inv || inv.used_at !== null || Date.parse(inv.expires_at) <= Date.parse(now)) return null;
    inv.used_at = now;
    return this.upsertMember({ venue_id: inv.venue_id, chat_ref: chatRef, role: inv.role, lang });
  }
  async getAdminToken(venueId: string) {
    this.site(venueId);
    let t = this.tokens.get(venueId);
    if (!t) {
      t = newToken();
      this.tokens.set(venueId, t);
    }
    return t;
  }
  async findVenueByAdminToken(token: string) {
    for (const [venueId, t] of this.tokens) if (t === token) return this.getVenue(venueId);
    return null;
  }

  async createChangeSet(cs: NewChangeSet): Promise<ChangeSet> {
    this.site(cs.venue_id);
    const row: ChangeSet = {
      id: crypto.randomUUID(),
      venue_id: cs.venue_id,
      chat_ref: cs.chat_ref,
      summary_bg: cs.summary_bg,
      summary_en: cs.summary_en,
      preview_bg: cs.preview_bg,
      preview_en: cs.preview_en,
      source: cs.source,
      status: cs.status,
      apply_at: cs.apply_at ?? null,
      reminded_at: null,
      decided_at: null,
      applied_at: null,
      reverted_by: null,
      undoes_id: cs.undoes_id ?? null,
      message_ref: cs.message_ref ?? null,
      created_at: this.clock(),
      changes: clone(cs.changes).map((c, i) => ({ ...c, position: i })),
    };
    this.sets.set(row.id, row);
    return clone(row);
  }
  async getChangeSet(id: string) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    return clone(cs);
  }
  async findProposed(venueId: string, chatRef: string) {
    const cs = [...this.sets.values()].find((x) => x.venue_id === venueId && x.chat_ref === chatRef && x.status === "proposed");
    return cs ? clone(cs) : null;
  }
  async listChangeSets(venueId: string, opts: { status?: ChangeSet["status"][]; limit?: number } = {}) {
    return [...this.sets.values()]
      .filter((x) => x.venue_id === venueId && (!opts.status || opts.status.includes(x.status)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, opts.limit ?? 50)
      .map(clone);
  }
  async listDue(now: string, venueId?: string) {
    return [...this.sets.values()]
      .filter((x) => x.status === "scheduled" && x.apply_at !== null && x.apply_at <= now && (!venueId || x.venue_id === venueId))
      .sort((a, b) => (a.apply_at as string).localeCompare(b.apply_at as string))
      .map(clone);
  }
  async listUpcoming(now: string, until: string, venueId?: string) {
    return [...this.sets.values()]
      .filter((x) => x.status === "scheduled" && x.reminded_at === null && x.apply_at !== null && x.apply_at > now && x.apply_at <= until && (!venueId || x.venue_id === venueId))
      .map(clone);
  }
  async listProposedBefore(cutoff: string, venueId?: string) {
    return [...this.sets.values()].filter((x) => x.status === "proposed" && x.created_at < cutoff && (!venueId || x.venue_id === venueId)).map(clone);
  }
  async updateChangeSet(id: string, patch: ChangeSetPatch) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (cs as unknown as Record<string, unknown>)[k] = v;
  }
  async applyChangeSet(id: string, now: string) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    if (cs.status !== "proposed" && cs.status !== "scheduled") return "skipped";
    const site = this.site(cs.venue_id);
    this.sites.set(cs.venue_id, applyChanges(site, cs.changes));
    cs.status = "applied";
    cs.applied_at = now;
    cs.decided_at ??= now;
    if (cs.undoes_id) {
      const target = this.sets.get(cs.undoes_id);
      if (target && target.status === "applied") {
        target.status = "reverted";
        target.reverted_by = cs.id;
      }
    }
    return "applied";
  }
  async expireChangeSet(id: string, now: string) {
    const cs = this.sets.get(id);
    if (!cs) throw new Error(`change set ${id} not found`);
    if (cs.status !== "proposed") return "skipped";
    cs.status = "expired";
    cs.decided_at = now;
    return "expired";
  }
  async listExpiredTimers(now: string, venueId?: string) {
    const out: ExpiredTimer[] = [];
    for (const s of this.sites.values()) {
      if (venueId && s.venue.id !== venueId) continue;
      for (const i of s.items) {
        if (i.active && i.sold_out_until !== null && i.sold_out_until <= now) out.push({ item: clone(i), kind: "sold_out" });
        if (i.is_special && i.active && i.special_expires_at !== null && i.special_expires_at <= now) out.push({ item: clone(i), kind: "special" });
      }
    }
    return out;
  }

  async saveMedia(venueId: string, bytes: Uint8Array, contentType: string): Promise<Media> {
    const s = this.site(venueId);
    const id = crypto.randomUUID();
    const path = `${venueId}/${id}.${extensionFor(contentType)}`;
    this.files.set(path, bytes);
    const row: Media = { id, venue_id: venueId, storage_path: path, public_url: `memory://media/${path}`, is_gallery: false, position: 0, created_at: this.clock() };
    s.media.push(row);
    return clone(row);
  }
  async getMedia(id: string) {
    for (const s of this.sites.values()) {
      const m = s.media.find((x) => x.id === id);
      if (m) return clone(m);
    }
    return null;
  }

  async getConversation(venueId: string, chatRef: string) {
    const c = this.conversations.get(`${venueId}:${chatRef}`);
    return c ? clone(c) : null;
  }
  async setConversation(venueId: string, chatRef: string, c: Conversation) {
    this.conversations.set(`${venueId}:${chatRef}`, clone(c));
  }

  async bumpRateLimit(key: string, windowMs: number, max: number, now: string) {
    const t = Date.parse(now);
    if (Number.isNaN(t)) throw new Error(`bumpRateLimit: invalid time ${now}`);
    const cur = this.rateLimits.get(key);
    const row = cur && cur.window_start + windowMs > t ? { count: cur.count + 1, window_start: cur.window_start } : { count: 1, window_start: t };
    this.rateLimits.set(key, row);
    return row.count <= max;
  }

  // --- Destinations (integrations track, appended 2026-10-10) ---
  destinations = new Map<string, DestinationWithSecrets>();
  syncs = new Map<string, DestinationSync>();

  private publicDestination(d: DestinationWithSecrets): Destination {
    const { secrets: _secrets, ...rest } = d;
    void _secrets;
    return clone(rest);
  }
  async upsertDestination(d: NewDestination): Promise<Destination> {
    this.site(d.venue_id);
    const now = this.clock();
    const existing = [...this.destinations.values()].find((x) => x.venue_id === d.venue_id && x.kind === d.kind);
    const row: DestinationWithSecrets = {
      id: existing?.id ?? crypto.randomUUID(),
      venue_id: d.venue_id,
      kind: d.kind,
      config: clone(d.config),
      secrets: d.secrets,
      status: d.status ?? "connected",
      last_error: null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.destinations.set(row.id, row);
    return this.publicDestination(row);
  }
  async getDestination(venueId: string, kind: DestinationKind) {
    const d = [...this.destinations.values()].find((x) => x.venue_id === venueId && x.kind === kind);
    return d ? clone(d) : null;
  }
  async listDestinations(venueId: string) {
    return [...this.destinations.values()].filter((x) => x.venue_id === venueId).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((d) => this.publicDestination(d));
  }
  async updateDestination(id: string, patch: DestinationPatch) {
    const d = this.destinations.get(id);
    if (!d) throw new Error(`destination ${id} not found`);
    if (patch.status !== undefined) d.status = patch.status;
    if (patch.last_error !== undefined) d.last_error = patch.last_error;
    if (patch.config !== undefined) d.config = clone(patch.config);
    d.updated_at = this.clock();
  }
  async deleteDestination(id: string) {
    this.destinations.delete(id);
    for (const [sid, s] of this.syncs) if (s.destination_id === id) this.syncs.delete(sid);
  }
  async createSync(s: NewSync): Promise<DestinationSync> {
    const now = this.clock();
    const row: DestinationSync = { id: crypto.randomUUID(), venue_id: s.venue_id, destination_id: s.destination_id, change_set_id: s.change_set_id, status: "pending", attempts: 0, next_at: s.next_at, last_error: null, payload: clone(s.payload), result: null, created_at: now, updated_at: now, leased_until: null };
    this.syncs.set(row.id, row);
    return clone(row);
  }
  async getSync(id: string) {
    const s = this.syncs.get(id);
    if (!s) throw new Error(`sync ${id} not found`);
    return clone(s);
  }
  async listSyncs(opts: { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; limit?: number }) {
    const rows = [...this.syncs.values()]
      .filter((s) => (!opts.venueId || s.venue_id === opts.venueId) && (!opts.changeSetId || s.change_set_id === opts.changeSetId) && (!opts.status || opts.status.includes(s.status)) && (!opts.dueBefore || s.next_at <= opts.dueBefore))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return (opts.limit ? rows.slice(0, opts.limit) : rows).map(clone);
  }
  async claimSync(id: string, now: string, leaseUntil: string) {
    const s = this.syncs.get(id);
    if (!s || s.status !== "pending" || (s.leased_until && s.leased_until > now)) return false;
    s.leased_until = leaseUntil;
    return true;
  }
  async updateSync(id: string, patch: SyncPatch) {
    const s = this.syncs.get(id);
    if (!s) throw new Error(`sync ${id} not found`);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (s as unknown as Record<string, unknown>)[k] = typeof v === "object" && v !== null ? clone(v) : v;
    if (patch.updated_at === undefined) s.updated_at = this.clock();
  }
}
