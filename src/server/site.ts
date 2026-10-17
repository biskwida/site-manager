// src/server/site.ts
import { applyChanges } from "../domain/changes";
import { unkeep } from "../domain/format";
import type { DraftInfo, SiteState, Venue } from "../domain/types";
import type { Store } from "../store/types";
import { sha256Hex } from "./hash";

export type { DraftInfo } from "../domain/types";

export interface LoadSiteOptions {
  /** A pending change set to preview on top of the live state; needs `key`. */
  draftId?: string | null;
  /** The admin key from the URL. */
  key?: string | null;
  /** The wizard's draft token (from the sm_draft cookie); required to see a venue with status "draft". */
  draftToken?: string | null;
}

/** Live state for a slug; with a valid admin key and a pending draft id, the state with that draft applied on top. Draft venues are null without a matching draft token. */
export async function loadSite(store: Store, slug: string, opts: LoadSiteOptions = {}): Promise<{ state: SiteState; draft: DraftInfo | null } | null> {
  const venue = await store.getVenueBySlug(slug);
  if (!venue) return null;
  if (venue.status === "draft") {
    if (!opts.draftToken) return null;
    const owner = await store.findVenueByDraftToken(sha256Hex(opts.draftToken));
    if (!owner || owner.id !== venue.id) return null;
  }
  let state = await store.getSite(venue.id);
  let draft: DraftInfo | null = null;
  if (opts.draftId && opts.key) {
    const owner = await store.findVenueByAdminToken(opts.key);
    if (owner && owner.id === venue.id) {
      try {
        const cs = await store.getChangeSet(opts.draftId);
        if (cs.venue_id === venue.id) {
          // The banner shows what the chat said, without its keep markers (src/domain/format.ts keep).
          draft = { id: cs.id, status: cs.status, summary_bg: unkeep(cs.summary_bg), summary_en: unkeep(cs.summary_en), preview_bg: unkeep(cs.preview_bg), preview_en: unkeep(cs.preview_en), key: opts.key };
          if (cs.status === "proposed" || cs.status === "scheduled") {
            try {
              state = applyChanges(state, cs.changes);
            } catch (e) {
              console.error("[site] draft apply failed:", e instanceof Error ? e.message : e);
            }
          }
        }
      } catch {
        draft = null;
      }
    }
  }
  return { state, draft };
}

/** The venue as the public feed sends it: no deploy record (provider ids, build errors), no wizard draft, no Instagram import list, no own-site URL, no change limit, no comment settings. */
export type PublicVenue = Omit<Venue, "deploy" | "wizard_draft" | "instagram_import" | "site_url" | "change_limit" | "comment_mode" | "comment_digest_hour" | "comment_limit" | "last_comment_digest_at">;
export type PublicSiteState = Omit<SiteState, "venue"> & { venue: PublicVenue };

/** For GET /api/site/[slug]: everything templates and outside readers (Coffique) use, minus the owner-only venue fields. */
export function publicSiteState(state: SiteState): PublicSiteState {
  const { deploy, wizard_draft, instagram_import, site_url, change_limit, comment_mode, comment_digest_hour, comment_limit, last_comment_digest_at, ...venue } = state.venue;
  void deploy;
  void wizard_draft;
  void instagram_import;
  void site_url;
  void change_limit; // the plan's limit is the owner's business, not the public's
  void comment_mode; // how the owner hears about comments is the owner's business
  void comment_digest_hour;
  void comment_limit;
  void last_comment_digest_at;
  // background is always present for outside readers: null = the design's own page colour.
  return { ...state, venue: { ...venue, theme: { ...venue.theme, background: venue.theme.background ?? null } } };
}

/**
 * Where the hosted /<slug> page sends visitors of an own-site venue: the venue's own site, so one address serves the café.
 * A draft preview (the dashboard's "Preview on the site" link, or a wizard draft) stays on the hosted page, which is the only place a draft can render.
 * null = render the hosted page as usual.
 */
export function ownSiteRedirect(site: { state: SiteState; draft: DraftInfo | null }): string | null {
  const url = site.state.venue.site_url;
  if (!url || site.draft) return null;
  return url;
}
