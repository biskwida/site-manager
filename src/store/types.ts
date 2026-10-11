// src/store/types.ts
import type {
  BusinessType, Category, Change, ChangeSet, ChangeSetStatus, ChangeSource, Conversation, DeployInfo, DeployStatus, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, TemplateId, Venue, VenueStatus, WeekHours,
} from "../domain/types";
import type { WizardDraft } from "../wizard/schema";

/** How long a publish claim (claimPublish) blocks a second publish of the same draft; a publish that died keeps nobody out for longer. */
export const PUBLISH_CLAIM_TTL_MS = 5 * 60_000;

export const DEFAULT_HOURS: WeekHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: { open: "09:00", close: "16:00" },
  sun: null,
};

export interface NewVenue {
  slug: string;
  name: string;
  tagline_bg?: string;
  tagline_en?: string;
  about_bg?: string;
  about_en?: string;
  address?: string;
  phone?: string;
  maps_url?: string;
  instagram?: string;
  hours?: WeekHours;
  tz?: string;
  default_lang?: Lang;
  theme?: { accent: string };
  template?: TemplateId;
  business_type?: BusinessType;
  status?: VenueStatus;
  wizard_draft?: WizardDraft | null;
}
export interface NewCategory {
  venue_id: string;
  name_bg: string;
  name_en: string;
  position: number;
}
export interface NewItem {
  venue_id: string;
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  position: number;
  is_special?: boolean;
  special_expires_at?: string | null;
  image_media_id?: string | null;
}
export interface NewChangeSet {
  venue_id: string;
  chat_ref: string | null;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  source: ChangeSource;
  status: "proposed" | "scheduled";
  apply_at?: string | null;
  undoes_id?: string | null;
  message_ref?: string | null;
  changes: Change[];
}
export type ChangeSetPatch = Partial<Pick<ChangeSet, "status" | "apply_at" | "reminded_at" | "decided_at" | "applied_at" | "reverted_by" | "message_ref" | "preview_bg" | "preview_en">>;
export type VenuePatch = Partial<Pick<Venue,
  "slug" | "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "address" | "phone" | "maps_url" | "instagram" |
  "hours" | "tz" | "default_lang" | "theme" | "template" | "business_type" | "status" | "wizard_draft" | "instagram_import">>;

export interface ExpiredTimer {
  item: Item;
  kind: "sold_out" | "special";
}

export interface Store {
  // venues
  createVenue(v: NewVenue): Promise<Venue>;
  getVenue(id: string): Promise<Venue>;
  getVenueBySlug(slug: string): Promise<Venue | null>;
  /** All venues (oldest first); `status` filters; `deploying: true` keeps only deploy.status in ("pending","building"). */
  listVenues(opts?: { status?: VenueStatus; deploying?: boolean }): Promise<Venue[]>;
  /** Throws on an unknown id or a slug that another venue already has. Keys set to undefined are ignored. */
  updateVenue(id: string, patch: VenuePatch): Promise<Venue>;
  setDeploy(id: string, deploy: DeployInfo | null): Promise<void>;
  /**
   * Conditional deploy write: sets `deploy = next` only while the current deploy status is one of `whenStatusIn`
   * (`null` = no deploy yet) and, when `whenDeploymentId` is given, the current deploy.deployment_id equals it.
   * One atomic update; true when the row changed, false when another request got there first (or the venue is unknown).
   * Deploy starts and template switches claim through this so two requests never both deploy; deploy polls claim their
   * ready/error result with the deployment id they polled, so a result never lands on a newer deployment.
   */
  claimDeploy(id: string, next: DeployInfo, opts: { whenStatusIn: (DeployStatus | null)[]; whenDeploymentId?: string }): Promise<boolean>;
  /**
   * Marks a draft as "publishing now" (`now` ISO, defaults to the clock) only if its status is still `draft` and no other
   * publish claimed it in the last PUBLISH_CLAIM_TTL_MS (a crashed publish releases itself). True when this call won the claim.
   */
  claimPublish(id: string, now?: string): Promise<boolean>;
  /** Drops a publish claim so a failed publish can be retried at once (a successful one ends with status live, where the claim is moot). */
  releasePublish(id: string): Promise<void>;
  /** Stores the sha256 of the wizard's draft token (null clears it). */
  setDraftToken(id: string, tokenHash: string | null): Promise<void>;
  findVenueByDraftToken(tokenHash: string): Promise<Venue | null>;
  /**
   * Deletes the venue and everything that hangs off it: content, members, invites, tokens, change sets, media rows.
   * Storage objects stay unless `withStorage` (abandoned wizard drafts): then every object under `<id>/` in the media
   * bucket is removed first, so a failed storage call leaves the rows for the next attempt.
   */
  deleteVenue(id: string, opts?: { withStorage?: boolean }): Promise<void>;
  /** Everything for one venue, including inactive items (the site filters with domain/effective). */
  getSite(venueId: string): Promise<SiteState>;
  insertCategory(c: NewCategory): Promise<Category>;
  insertItem(i: NewItem): Promise<Item>;
  setSiteText(venueId: string, key: SiteTextKey, text_bg: string, text_en: string): Promise<void>;
  /** Deletes the venue's menu, texts, holidays, announcements, media rows and change sets (demo reset). Members, invites and tokens stay. */
  clearVenueContent(venueId: string): Promise<void>;
  /** Deletes the venue's items, categories and site texts only (a retried wizard publish starts its menu again). Media, change sets and venue fields stay. */
  clearMenu(venueId: string): Promise<void>;

  // members and access (chatRef = "<channel>:<id>", src/channels/ref.ts)
  findMember(chatRef: string): Promise<Member | null>;
  listMembers(venueId: string): Promise<Member[]>;
  upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }): Promise<Member>;
  setMemberLang(venueId: string, chatRef: string, lang: Lang): Promise<void>;
  /** Records an inbound message from the member; no-op for unknown refs. */
  touchMember(chatRef: string, nowIso: string): Promise<void>;
  createInvite(venueId: string, role: Role, expiresAt: string): Promise<string>;
  /** The open invite (unused, expires after `now`) for this venue and role that expires last; null when there is none. */
  findOpenInvite(venueId: string, role: Role, now: string): Promise<string | null>;
  /** Links the chat and marks the code used; null when the code is unknown, used or expired. */
  redeemInvite(code: string, chatRef: string, lang: Lang, now: string): Promise<Member | null>;
  /** Creates the token on first call. */
  getAdminToken(venueId: string): Promise<string>;
  findVenueByAdminToken(token: string): Promise<Venue | null>;

  // change sets
  createChangeSet(cs: NewChangeSet): Promise<ChangeSet>;
  getChangeSet(id: string): Promise<ChangeSet>;
  findProposed(venueId: string, chatRef: string): Promise<ChangeSet | null>;
  /** Newest first. */
  listChangeSets(venueId: string, opts?: { status?: ChangeSetStatus[]; limit?: number }): Promise<ChangeSet[]>;
  /** Scheduled sets with apply_at <= now (oldest first). */
  listDue(now: string, venueId?: string): Promise<ChangeSet[]>;
  /** Scheduled, not yet reminded, apply_at in (now, until]. */
  listUpcoming(now: string, until: string, venueId?: string): Promise<ChangeSet[]>;
  /** Proposed sets created before the cutoff. */
  listProposedBefore(cutoff: string, venueId?: string): Promise<ChangeSet[]>;
  updateChangeSet(id: string, patch: ChangeSetPatch): Promise<void>;
  /**
   * Writes every change and marks the set applied, only if it is still proposed or scheduled.
   * For an undo set, also marks the target reverted. Returns "skipped" when already decided.
   */
  applyChangeSet(id: string, now: string): Promise<"applied" | "skipped">;
  /** Marks the set expired (decided_at = now) only if it is still proposed; "skipped" when it was already decided. */
  expireChangeSet(id: string, now: string): Promise<"expired" | "skipped">;
  listExpiredTimers(now: string, venueId?: string): Promise<ExpiredTimer[]>;

  // media
  saveMedia(venueId: string, bytes: Uint8Array, contentType: string): Promise<Media>;
  getMedia(id: string): Promise<Media | null>;

  // conversations
  getConversation(venueId: string, chatRef: string): Promise<Conversation | null>;
  setConversation(venueId: string, chatRef: string, c: Conversation): Promise<void>;

  // rate limits
  /** Fixed window counter (the window restarts at the first call after it elapses). Returns true when the call is allowed (count after increment <= max). */
  bumpRateLimit(key: string, windowMs: number, max: number, now: string): Promise<boolean>;
}

export function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function extensionFor(contentType: string): string {
  return { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[contentType] ?? "bin";
}

// --- Destinations (integrations track, appended 2026-10-10) ---
export type DestinationKind = "wordpress" | "google" | "github" | "facebook" | "instagram";
export type DestinationStatus = "connected" | "error" | "disconnected";
export interface Destination {
  id: string;
  venue_id: string;
  kind: DestinationKind;
  /** Non-secret settings (site URL, site name, versions, connected_at…). */
  config: Record<string, unknown>;
  status: DestinationStatus;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
/** Only getDestination returns the encrypted secrets blob (base64 ciphertext); never put it on Destination. */
export interface DestinationWithSecrets extends Destination {
  secrets: string;
}
export interface NewDestination {
  venue_id: string;
  kind: DestinationKind;
  config: Record<string, unknown>;
  secrets: string;
  status?: DestinationStatus;
}
export type DestinationPatch = Partial<Pick<Destination, "status" | "last_error" | "config">>;

export type SyncStatus = "pending" | "done" | "failed";
export interface DestinationSync {
  id: string;
  venue_id: string;
  destination_id: string;
  change_set_id: string;
  status: SyncStatus;
  attempts: number;
  /** Earliest instant the next attempt may run (ISO). */
  next_at: string;
  last_error: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /** Set while one run pushes the row (claimSync); null/absent when free. Social track, 2026-10-11. */
  leased_until?: string | null;
}
export interface NewSync {
  venue_id: string;
  destination_id: string;
  change_set_id: string;
  payload: Record<string, unknown>;
  next_at: string;
}
export type SyncPatch = Partial<Pick<DestinationSync, "status" | "attempts" | "next_at" | "last_error" | "result" | "updated_at" | "leased_until">>;

// Declaration merging: the Store interface above gains the destination methods.
export interface Store {
  /** One destination per (venue, kind): replaces config, secrets and status of an existing row, keeping its id. */
  upsertDestination(d: NewDestination): Promise<Destination>;
  getDestination(venueId: string, kind: DestinationKind): Promise<DestinationWithSecrets | null>;
  listDestinations(venueId: string): Promise<Destination[]>;
  updateDestination(id: string, patch: DestinationPatch): Promise<void>;
  /** Deletes the destination and its sync rows. */
  deleteDestination(id: string): Promise<void>;
  createSync(s: NewSync): Promise<DestinationSync>;
  getSync(id: string): Promise<DestinationSync>;
  /** Oldest first (created_at). `dueBefore` keeps rows with next_at <= dueBefore. */
  listSyncs(opts: { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; limit?: number }): Promise<DestinationSync[]>;
  updateSync(id: string, patch: SyncPatch): Promise<void>;
  /**
   * Takes a pending row for one push: sets leased_until = leaseUntil only when the row is free (no lease, or the lease ended at
   * or before `now`). True when this caller got it; a concurrent run gets false and leaves the row alone.
   */
  claimSync(id: string, now: string, leaseUntil: string): Promise<boolean>;
}

// --- Dashboard Instagram import (appended 2026-10-11) ---
export interface Store {
  /**
   * Replaces one destination's config and secrets only while its secrets are still `expectedSecrets` (a reconnect or another
   * refresh in between wins). Status and last_error stay as they are. True when the row was written.
   */
  replaceDestinationSecrets(id: string, expectedSecrets: string, next: { config: Record<string, unknown>; secrets: string }): Promise<boolean>;
}
