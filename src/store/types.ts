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
  chat_id: number | null;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  source: ChangeSource;
  status: "proposed" | "scheduled";
  apply_at?: string | null;
  undoes_id?: string | null;
  tg_message_id?: number | null;
  changes: Change[];
}
export type ChangeSetPatch = Partial<Pick<ChangeSet, "status" | "apply_at" | "reminded_at" | "decided_at" | "applied_at" | "reverted_by" | "tg_message_id" | "preview_bg" | "preview_en">>;
export type VenuePatch = Partial<Pick<Venue,
  "slug" | "name" | "tagline_bg" | "tagline_en" | "about_bg" | "about_en" | "address" | "phone" | "maps_url" | "instagram" |
  "hours" | "tz" | "default_lang" | "theme" | "template" | "business_type" | "status" | "wizard_draft">>;

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

  // members and access
  findMember(chatId: number): Promise<Member | null>;
  listMembers(venueId: string): Promise<Member[]>;
  upsertMember(m: Omit<Member, "created_at">): Promise<Member>;
  setMemberLang(venueId: string, chatId: number, lang: Lang): Promise<void>;
  createInvite(venueId: string, role: Role, expiresAt: string): Promise<string>;
  /** Links the chat and marks the code used; null when the code is unknown, used or expired. */
  redeemInvite(code: string, chatId: number, lang: Lang, now: string): Promise<Member | null>;
  /** Creates the token on first call. */
  getAdminToken(venueId: string): Promise<string>;
  findVenueByAdminToken(token: string): Promise<Venue | null>;

  // change sets
  createChangeSet(cs: NewChangeSet): Promise<ChangeSet>;
  getChangeSet(id: string): Promise<ChangeSet>;
  findProposed(venueId: string, chatId: number): Promise<ChangeSet | null>;
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
  getConversation(venueId: string, chatId: number): Promise<Conversation | null>;
  setConversation(venueId: string, chatId: number, c: Conversation): Promise<void>;

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
