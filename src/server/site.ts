// src/server/site.ts
import { applyChanges } from "../domain/changes";
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
          draft = { id: cs.id, status: cs.status, summary_bg: cs.summary_bg, summary_en: cs.summary_en, preview_bg: cs.preview_bg, preview_en: cs.preview_en, key: opts.key };
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

/** The venue as the public feed sends it: no deploy record (provider ids, build errors), no wizard draft, no Instagram import list. */
export type PublicVenue = Omit<Venue, "deploy" | "wizard_draft" | "instagram_import">;
export type PublicSiteState = Omit<SiteState, "venue"> & { venue: PublicVenue };

/** For GET /api/site/[slug]: everything templates and outside readers (Coffique) use, minus the owner-only venue fields. */
export function publicSiteState(state: SiteState): PublicSiteState {
  const { deploy, wizard_draft, instagram_import, ...venue } = state.venue;
  void deploy;
  void wizard_draft;
  void instagram_import;
  // background is always present for outside readers: null = the design's own page colour.
  return { ...state, venue: { ...venue, theme: { ...venue.theme, background: venue.theme.background ?? null } } };
}
