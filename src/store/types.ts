// src/store/types.ts
import type {
  BusinessType, Category, Change, ChangeSet, ChangeSetStatus, ChangeSource, ChatLang, CommentMode, CommentNetwork, Conversation, DeployInfo, DeployStatus, Item, Lang, Media, Member, Role, SiteState, SiteTextKey, TemplateId, Venue, VenueStatus, WeekHours,
} from "../domain/types";
import { isChatLang } from "../domain/types";
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
  /** Monthly change limit; default null (unlimited). */
  change_limit?: number | null;
  /** Comment replies: how the owner hears about comments (default "each"), the digest hour (default 9) and the monthly cap on comment actions (default COMMENT_LIMIT_DEFAULT; null = unlimited). */
  comment_mode?: CommentMode;
  comment_digest_hour?: number;
  comment_limit?: number | null;
  tz?: string;
  default_lang?: Lang;
  theme?: Venue["theme"];
  template?: TemplateId;
  business_type?: BusinessType;
  status?: VenueStatus;
  wizard_draft?: WizardDraft | null;
  /** The venue's own external site (https); see Venue.site_url. */
  site_url?: string | null;
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
  /** Comment sets: one proposal message per owner chat, { chat_ref: message_ref }. */
  proposal_refs?: Record<string, string> | null;
  changes: Change[];
}
export type ChangeSetPatch = Partial<Pick<ChangeSet, "status" | "apply_at" | "reminded_at" | "decided_at" | "applied_at" | "reverted_by" | "message_ref" | "preview_bg" | "preview_en" | "proposal_refs" | "summary_bg" | "summary_en">>;
export type VenuePatch = Partial<Pick<Venue,
  "slug" | "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "address" | "phone" | "maps_url" | "instagram" |
  "hours" | "tz" | "default_lang" | "theme" | "template" | "business_type" | "status" | "wizard_draft" | "instagram_import" | "site_url" |
  "comment_mode" | "comment_digest_hour" | "comment_limit" | "last_comment_digest_at">>;

export interface InviteSummary {
  role: Role;
  /** Last 4 characters of the code, enough to tell codes apart, not enough to redeem one. */
  code_hint: string;
  expires_at: string;
  used: boolean;
}

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
  /** Members' `lang` must be a conversation language code (checkMemberLang), here and in setMemberLang and redeemInvite. */
  upsertMember(m: Omit<Member, "created_at" | "last_seen_at"> & { last_seen_at?: string | null }): Promise<Member>;
  setMemberLang(venueId: string, chatRef: string, lang: ChatLang): Promise<void>;
  /** Records an inbound message from the member; no-op for unknown refs. */
  touchMember(chatRef: string, nowIso: string): Promise<void>;
  createInvite(venueId: string, role: Role, expiresAt: string): Promise<string>;
  /** The open invite (unused, expires after `now`) for this venue and role that expires last; null when there is none. */
  findOpenInvite(venueId: string, role: Role, now: string): Promise<string | null>;
  /** Links the chat and marks the code used; null when the code is unknown, used or expired. A `lang` that is not a language code is refused before the code is used. */
  redeemInvite(code: string, chatRef: string, lang: ChatLang, now: string): Promise<Member | null>;
  /** Creates the token on first call. */
  getAdminToken(venueId: string): Promise<string>;
  findVenueByAdminToken(token: string): Promise<Venue | null>;
  /** Unlinks the chat from this venue; true when a row was deleted (false when the chat is not this venue's member). The chat is then a stranger to the bot. */
  removeMember(venueId: string, chatRef: string): Promise<boolean>;
  /** Invites that have not expired at `now`, used ones included, soonest expiry first. Codes are stored in plain text; only the last 4 characters leave the store. */
  listInvites(venueId: string, now: string): Promise<InviteSummary[]>;
  /** Deletes the venue's unused invites (expired ones too) of `role`, or of every role when omitted; returns how many. Used ones stay as history. */
  cancelInvites(venueId: string, role?: Role): Promise<number>;
  /** Replaces the dashboard key with a fresh one (creating it if there was none) and returns it; the old key stops working at once. Throws on an unknown venue. */
  rotateAdminToken(venueId: string): Promise<string>;

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
   * Returns "limited" (and marks the set cancelled, decided_at = now, nothing written) when the venue's monthly change limit
   * is already reached in the month of `now` (src/store/usage.ts limitBlocks): this is the one choke point every apply goes through.
   */
  applyChangeSet(id: string, now: string): Promise<ApplyResult>;
  /** Marks the set expired (decided_at = now) only if it is still proposed; "skipped" when it was already decided. */
  expireChangeSet(id: string, now: string): Promise<"expired" | "skipped">;
  /** Marks the set cancelled (decided_at = now) only if it is still proposed; "skipped" when it was already decided (a racing ✅ wins). */
  cancelChangeSet(id: string, now: string): Promise<"cancelled" | "skipped">;
  listExpiredTimers(now: string, venueId?: string): Promise<ExpiredTimer[]>;

  // media
  /** `opts.name` stores the file at `<venue>/<name>` instead of a random name (used for cached cut-outs). */
  saveMedia(venueId: string, bytes: Uint8Array, contentType: string, opts?: { name?: string }): Promise<Media>;
  getMedia(id: string): Promise<Media | null>;
  findMediaByPath(storagePath: string): Promise<Media | null>;

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
export interface ListSyncsOpts { venueId?: string; changeSetId?: string; status?: SyncStatus[]; dueBefore?: string; createdSince?: string; order?: "asc" | "desc"; limit?: number }
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
  /**
   * Oldest first (created_at), or newest first with order "desc". `dueBefore` keeps rows with next_at <= dueBefore;
   * `createdSince` keeps rows with created_at >= createdSince (the comment poller's 14-day window).
   */
  listSyncs(opts: ListSyncsOpts): Promise<DestinationSync[]>;
  updateSync(id: string, patch: SyncPatch): Promise<void>;
  /**
   * Takes a pending row for one push: sets leased_until = leaseUntil only when the row is free (no lease, or the lease ended at
   * or before `now`). True when this caller got it; a concurrent run gets false and leaves the row alone.
   */
  claimSync(id: string, now: string, leaseUntil: string): Promise<boolean>;
}

// --- Monthly change limit (appended 2026-10-13; definition in src/domain/limits.ts) ---
/** applyChangeSet's outcome; "limited" = refused by the monthly change limit (the set is now cancelled). */
export type ApplyResult = "applied" | "skipped" | "limited";
// Declaration merging: the Store interface above gains the limit methods.
export interface Store {
  /**
   * Change sets of the venue with applied_at in [fromIso, toIso) that count toward the monthly limit (countsTowardLimit:
   * not "undo", "auto" or "comment", and not made only of set_comment_mode rows). A set applied and later reverted still counts: it reached `applied`. Proposed, scheduled, rejected,
   * expired and cancelled sets have no applied_at and never count.
   */
  countAppliedChangeSets(venueId: string, fromIso: string, toIso: string): Promise<number>;
  /** Sets (a whole number >= 0) or clears (null = unlimited) the venue's monthly change limit; throws on an unknown venue. */
  setChangeLimit(venueId: string, limit: number | null): Promise<Venue>;
}

/** Throws unless the limit is null or a whole number >= 0. */
export function checkLimitValue(limit: number | null): void {
  if (limit !== null && !(Number.isInteger(limit) && limit >= 0)) throw new Error(`change limit must be a whole number >= 0 or null, got ${limit}`);
}

/** Throws unless `lang` is a conversation language code (isChatLang), the check venue_members.lang has in supabase/schema.sql. */
export function checkMemberLang(lang: string): void {
  if (!isChatLang(lang)) throw new Error(`member language must be a lower-case two-letter code, got ${JSON.stringify(lang)}`);
}

// --- Meta data deletion (appended 2026-10-14; src/server/meta-deletion.ts) ---
export type DeletionProvider = "facebook" | "instagram";
export type DeletionStatus = "pending" | "completed";
/** One data deletion request Meta sent us (the user removed the app); the confirmation code is what the status page looks up. */
export interface DataDeletionRequest {
  id: string;
  provider: DeletionProvider;
  /** The app-scoped user id from Meta's signed_request. */
  subject_id: string;
  confirmation_code: string;
  status: DeletionStatus;
  created_at: string;
  completed_at: string | null;
}
/** Config keys findDestinationsByConfig may look up (letters and underscores only: the Supabase store builds a JSON path from it). */
export const CONFIG_KEY_RE = /^[a-z_]{1,40}$/;
// Declaration merging: the Store interface above gains the deletion methods.
export interface Store {
  /** Destinations of `kind` (any venue) whose config[key] equals `value` as a string; oldest first, without secrets. Throws on a key outside CONFIG_KEY_RE. */
  findDestinationsByConfig(kind: DestinationKind, key: string, value: string): Promise<Destination[]>;
  /** Creates a pending request with a fresh 12-character confirmation code (CODE_ALPHABET). */
  createDeletionRequest(r: { provider: DeletionProvider; subject_id: string; now: string }): Promise<DataDeletionRequest>;
  /** Marks the request completed at `now`; no-op for an unknown code. */
  completeDeletionRequest(code: string, now: string): Promise<void>;
  getDeletionRequest(code: string): Promise<DataDeletionRequest | null>;
}

export function newConfirmationCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

// --- Comment replies (appended 2026-10-15; spec docs/superpowers/specs/2026-10-15-comment-replies-design.md) ---
/** new: seen, not proposed yet · proposed: a change set is waiting · replied/hidden/deleted: the action went out · ignored: ❌ or un-hidden · expired: the proposal timed out or the comment is gone · own: the venue's own comment · nested: a reply to a reply (never proposed in v1). */
export type CommentStatus = "new" | "proposed" | "replied" | "ignored" | "expired" | "own" | "nested" | "hidden" | "deleted";
export const COMMENT_STATUSES: readonly CommentStatus[] = ["new", "proposed", "replied", "ignored", "expired", "own", "nested", "hidden", "deleted"];
/** One customer comment under a post Site Manager published. Customer content: purged after 30 days (src/social/comments-poll.ts). */
export interface SocialComment {
  id: string;
  venue_id: string;
  network: CommentNetwork;
  /** Meta post id (Facebook) or media id (Instagram). */
  post_ref: string;
  /** Meta's comment id; unique across networks. */
  comment_id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  text: string;
  /** When the customer wrote it (Meta's timestamp). */
  created_at: string;
  /** When the poll stored it. */
  seen_at: string;
  status: CommentStatus;
  change_set_id: string | null;
  reply_id: string | null;
  /** When the reply or moderation went out (countCommentActions). */
  replied_at: string | null;
  /** The caption of the post it is under (for the proposal text and the dashboard). */
  post_caption: string;
  post_permalink: string | null;
  /** The drafted reply and its kind, kept so the dashboard and ✏️ show them without a second model call. */
  draft_text: string | null;
  draft_kind: string | null;
  /** Held because no owner could be reached inside Meta's 24 h window; retried by the next tick. */
  deferred: boolean;
  /** Proposal sends that reached no owner in a row (the bot blocked, an outage); reset when a proposal goes out. */
  hold_attempts: number;
  /** When the last of those failed sends was (null when none). */
  held_at: string | null;
}
export type NewSocialComment = Pick<SocialComment, "network" | "post_ref" | "comment_id" | "parent_id" | "author_id" | "author_name" | "text" | "created_at" | "seen_at" | "status" | "post_caption"> & { post_permalink?: string | null };
export type SocialCommentPatch = Partial<Pick<SocialComment, "status" | "change_set_id" | "reply_id" | "replied_at" | "draft_text" | "draft_kind" | "deferred" | "hold_attempts" | "held_at">>;
export interface ListCommentsOpts {
  status?: CommentStatus[];
  limit?: number;
  /** Keeps created_at >= since. */
  since?: string;
  /** Only the comments of this change set. */
  changeSetId?: string;
}
// Declaration merging: the Store interface above gains the comment methods.
export interface Store {
  /** Inserts the rows whose comment_id is not stored yet and returns exactly those (a comment seen by two polls is stored once). */
  upsertComments(venueId: string, rows: NewSocialComment[]): Promise<SocialComment[]>;
  /** Newest first (created_at, then id). Default limit 100. */
  listComments(venueId: string, opts?: ListCommentsOpts): Promise<SocialComment[]>;
  getComment(id: string): Promise<SocialComment | null>;
  /** By Meta's comment id, within one venue. */
  findComment(venueId: string, commentId: string): Promise<SocialComment | null>;
  /** Throws on an unknown id. Keys set to undefined are ignored. */
  updateComment(id: string, patch: SocialCommentPatch): Promise<void>;
  /** Deletes every venue's rows with created_at < before (60 days: COMMENT_ROW_RETENTION_MS); returns how many. */
  purgeComments(before: string): Promise<number>;
  /**
   * The 30-day rule for the rows themselves: blanks text, author_name and author_id (the commenter's Meta id) of every venue's rows with created_at < before that
   * still hold any (the row, its status and replied_at stay for the monthly comment count). Returns how many it blanked.
   */
  redactComments(before: string): Promise<number>;
  /**
   * The 30-day rule for the customer text kept on change sets: every set with source "comment" created before `before` (and not
   * redacted yet) gets comment_text and author_name blanked in its rows' before/after and COMMENT_REDACTED as its summaries and
   * previews. `venueId` narrows it to one venue (tests on a shared database). Returns how many sets it redacted.
   */
  redactCommentSets(before: string, venueId?: string): Promise<number>;
  /** Replies and moderations that went out in [fromIso, toIso): rows with status replied, hidden or deleted and replied_at in the window. */
  countCommentActions(venueId: string, fromIso: string, toIso: string): Promise<number>;
}

// --- Translations (appended 2026-10-16; src/bot/translate.ts) ---
// Declaration merging: the Store interface above gains the translation cache (table translations, server-only).
export interface Store {
  /** The cached translation into `lang` of the fixed text whose sha256 hex is `sourceHash`; null when there is none. */
  getTranslation(lang: ChatLang, sourceHash: string): Promise<string | null>;
  /** Stores a translation; a second write for the same language and text replaces the first. `lang` must pass checkMemberLang (translations.lang check). */
  putTranslation(lang: ChatLang, sourceHash: string, text: string): Promise<void>;
}

/** What a comment set says once its customer text is gone (redactCommentSets). */
export const COMMENT_REDACTED = { bg: "Коментар, изтрит след 30 дни", en: "Comment removed after 30 days" } as const;
/** A change row's before/after without the customer's text and name (other keys kept); null stays null. */
export function redactCommentRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return row;
  const out = { ...row };
  if ("comment_text" in out) out.comment_text = "";
  if ("author_name" in out) out.author_name = "";
  return out;
}
