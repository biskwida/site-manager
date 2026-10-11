export type Lang = "bg" | "en";
export const LANGS: readonly Lang[] = ["bg", "en"];

import type { WizardDraft } from "../wizard/schema";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** "HH:MM" 24-hour wall-clock times in the venue's zone. */
export interface DayHours {
  open: string;
  close: string;
}
/** null = closed that day. */
export type WeekHours = Record<Weekday, DayHours | null>;

export interface Holiday {
  id: string;
  venue_id: string;
  /** YYYY-MM-DD in the venue's zone. */
  date: string;
  note_bg: string;
  note_en: string;
}

export type TemplateId = "classic" | "nocturne" | "lumen" | "furna" | "mehana" | "kvartal";
// Newest designs first: this order drives the wizard chooser, the Look step and the dashboard template menu.
export const TEMPLATE_IDS: readonly TemplateId[] = ["furna", "mehana", "kvartal", "classic", "nocturne", "lumen"];
export type BusinessType = "cafe" | "bar" | "restaurant";
export const BUSINESS_TYPES: readonly BusinessType[] = ["cafe", "bar", "restaurant"];
export type VenueStatus = "draft" | "live";
export type DeployStatus = "pending" | "building" | "ready" | "error";
export interface DeployInfo {
  provider: "vercel" | "fake";
  project_id: string;
  deployment_id: string;
  /** Real production URL from the provider, with https://; null until the first deployment is ready. */
  url: string | null;
  status: DeployStatus;
  /** Short, secret-free. */
  error: string | null;
  /** Template that was deployed. */
  template: TemplateId;
  /** ISO; set on every status transition (pollDeployments measures its 20-minute timeout from it). */
  updated_at: string;
  /** Optional custom domain attached to the provider project (Task 11); absent or null when none. */
  custom_domain?: string | null;
  /** Whether the provider confirmed the DNS records for custom_domain at the last connect/check; absent or null when no domain. */
  domain_verified?: boolean | null;
}
/** Moved here from src/server/site.ts (which re-exports it) so templates can import it. */
export interface DraftInfo {
  id: string;
  status: string;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  /** The admin key the preview link carried; the banner's Apply/Reject calls use it. */
  key: string;
}

export interface Venue {
  id: string;
  slug: string;
  name: string;
  tagline_bg: string;
  tagline_en: string;
  about_bg: string;
  about_en: string;
  address: string;
  phone: string;
  maps_url: string;
  instagram: string;
  cover_media_id: string | null;
  logo_media_id: string | null;
  hours: WeekHours;
  tz: string;
  default_lang: Lang;
  theme: { accent: string };
  template: TemplateId;
  business_type: BusinessType;
  status: VenueStatus;
  deploy: DeployInfo | null;
  /** The wizard's unpublished form; null for every live venue. */
  wizard_draft: WizardDraft | null;
  /** Server-only: photos the owner may import from their Instagram (wizard drafts; cleared on publish). Never in the public feed. */
  instagram_import: InstagramImport | null;
  created_at: string;
}

/** One image the owner can pick (a single-image post or one image of a carousel), as read once from the Instagram API. */
export interface InstagramCandidate {
  id: string;
  /** Instagram CDN URL (https, *.cdninstagram.com or *.fbcdn.net); the import route fetches only these stored URLs. */
  url: string;
  thumb: string;
  /** At most 280 characters. */
  caption: string;
  /** https://www.instagram.com/... or "". */
  permalink: string;
  /** ISO timestamp or "". */
  taken_at: string;
}
export interface InstagramImport {
  fetched_at: string;
  username?: string;
  items: InstagramCandidate[];
}

export interface Category {
  id: string;
  venue_id: string;
  name_bg: string;
  name_en: string;
  position: number;
  active: boolean;
}

export interface Item {
  id: string;
  venue_id: string;
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  image_media_id: string | null;
  sold_out_until: string | null;
  is_special: boolean;
  special_expires_at: string | null;
  position: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Announcement {
  id: string;
  venue_id: string;
  text_bg: string;
  text_en: string;
  expires_at: string | null;
  created_at: string;
}

export interface Media {
  id: string;
  venue_id: string;
  storage_path: string;
  public_url: string;
  is_gallery: boolean;
  position: number;
  created_at: string;
}

export const SITE_TEXT_KEYS = ["welcome", "footer_note"] as const;
export type SiteTextKey = (typeof SITE_TEXT_KEYS)[number];
export const VENUE_TEXT_KEYS = ["tagline", "about", "address", "phone", "maps_url", "instagram"] as const;
export type VenueTextKey = (typeof VENUE_TEXT_KEYS)[number];
export type TextKey = SiteTextKey | VenueTextKey;
/** Single-language keys: the agent passes the same value as text_bg and text_en; only text_bg is stored. */
export const MONO_TEXT_KEYS: readonly TextKey[] = ["address", "phone", "maps_url", "instagram"];

export interface SiteText {
  venue_id: string;
  key: SiteTextKey;
  text_bg: string;
  text_en: string;
}

/** Everything the public site, the preview and the agent need for one venue. */
export interface SiteState {
  venue: Venue;
  categories: Category[];
  items: Item[];
  holidays: Holiday[];
  announcements: Announcement[];
  media: Media[];
  texts: SiteText[];
}

export interface NewItemInput {
  category_id: string;
  name_bg: string;
  name_en: string;
  desc_bg: string;
  desc_en: string;
  price_eur: number;
  allergens: number[];
  is_special: boolean;
  special_expires_at: string | null;
  image_media_id?: string | null;
}
export type ItemPatch = Partial<Pick<Item, "category_id" | "name_bg" | "name_en" | "desc_bg" | "desc_en" | "price_eur" | "allergens" | "position">>;

export type ChangeOp =
  | { op: "set_price"; item_id: string; price_eur: number }
  | { op: "set_sold_out"; item_id: string; until: string | null }
  | { op: "add_item"; item: NewItemInput; id?: string }
  | { op: "update_item"; item_id: string; patch: ItemPatch }
  | { op: "remove_item"; item_id: string }
  | { op: "set_item_image"; item_id: string; media_id: string | null }
  | { op: "set_cover_image"; media_id: string | null }
  | { op: "set_logo_image"; media_id: string | null }
  | { op: "add_gallery_image"; media_id: string }
  | { op: "remove_gallery_image"; media_id: string }
  | { op: "set_hours"; hours: WeekHours }
  | { op: "add_holiday"; date: string; note_bg: string; note_en: string; id?: string }
  | { op: "remove_holiday"; holiday_id: string }
  | { op: "add_announcement"; text_bg: string; text_en: string; expires_at: string | null; id?: string }
  | { op: "remove_announcement"; announcement_id: string }
  | { op: "set_text"; key: TextKey; text_bg: string; text_en: string }
  | { op: "set_theme"; accent: string };
export type OpName = ChangeOp["op"];
export const OP_NAMES: readonly OpName[] = [
  "set_price", "set_sold_out", "add_item", "update_item", "remove_item", "set_item_image", "set_cover_image", "set_logo_image",
  "add_gallery_image", "remove_gallery_image", "set_hours", "add_holiday", "remove_holiday", "add_announcement", "remove_announcement",
  "set_text", "set_theme",
];

export type Entity = "venue" | "category" | "item" | "holiday" | "announcement" | "media" | "site_text" | WpEntity;
export type Row = Record<string, unknown>;

/**
 * One entity write. `before`/`after` are patches (the touched keys only) for updates,
 * `before: null` + full row for inserts, full row + `after: null` for deletes.
 * Undo swaps them. For `site_text`, entity_id is the text key.
 */
export interface Change {
  position: number;
  op: OpName | WpOpName;
  entity: Entity;
  entity_id: string;
  before: Row | null;
  after: Row | null;
}

export type ChangeSource = "text" | "voice" | "photo" | "dashboard" | "auto" | "undo";
export type ChangeSetStatus = "proposed" | "scheduled" | "applied" | "rejected" | "expired" | "cancelled" | "reverted";

export interface ChangeSet {
  id: string;
  venue_id: string;
  chat_ref: string | null;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
  source: ChangeSource;
  status: ChangeSetStatus;
  apply_at: string | null;
  reminded_at: string | null;
  decided_at: string | null;
  applied_at: string | null;
  reverted_by: string | null;
  /** For source "undo": the set this one reverts. */
  undoes_id: string | null;
  /** The proposal message on the owner's channel (Telegram message id as text; Meta ids as given). */
  message_ref: string | null;
  created_at: string;
  changes: Change[];
}

export type Role = "owner" | "staff";
export interface Member {
  venue_id: string;
  /** "<channel>:<id>", see src/channels/ref.ts. */
  chat_ref: string;
  role: Role;
  lang: Lang;
  /** Last inbound message from this member; Meta channels may only be messaged proactively within 24 h of it. */
  last_seen_at: string | null;
  created_at: string;
}

export interface ConversationTurn {
  at: string;
  owner: string;
  agent: string;
  outcome?: string;
}
export interface Conversation {
  turns: ConversationTurn[];
  /** Set by the ✏️ Change button: the next message corrects this proposal. */
  correction_for: string | null;
  updated_at: string;
}

// --- WordPress write channel (integrations track, appended 2026-10-10) ---
/** Ops produced by the WordPress tools (src/agent/wp-tools.ts) from live WordPress data; never by planChange. */
export type WpOpName = "wp_edit_page" | "wp_upload_photo" | "wp_set_option" | "wp_edit_menu" | "wp_edit_product";
export const WP_OP_NAMES: readonly WpOpName[] = ["wp_edit_page", "wp_upload_photo", "wp_set_option", "wp_edit_menu", "wp_edit_product"];
/** Entities that live on the owner's WordPress site, not in our database: the store applies them as no-ops and the destination push writes them. */
export type WpEntity = "wp_page" | "wp_media" | "wp_option" | "wp_menu" | "wp_product";
export const WP_ENTITIES: readonly WpEntity[] = ["wp_page", "wp_media", "wp_option", "wp_menu", "wp_product"];
export function isWpEntity(e: string): e is WpEntity {
  return (WP_ENTITIES as readonly string[]).includes(e);
}
