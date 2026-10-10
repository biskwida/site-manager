// src/server/site.ts
import { applyChanges } from "../domain/changes";
import type { SiteState } from "../domain/types";
import type { Store } from "../store/types";

export interface DraftInfo {
  id: string;
  status: string;
  summary_bg: string;
  summary_en: string;
  preview_bg: string;
  preview_en: string;
}

/** Live state for a slug; with a valid admin key and a pending draft id, the state with that draft applied on top. */
export async function loadSite(store: Store, slug: string, opts: { draftId?: string | null; key?: string | null } = {}): Promise<{ state: SiteState; draft: DraftInfo | null } | null> {
  const venue = await store.getVenueBySlug(slug);
  if (!venue) return null;
  let state = await store.getSite(venue.id);
  let draft: DraftInfo | null = null;
  if (opts.draftId && opts.key) {
    const owner = await store.findVenueByAdminToken(opts.key);
    if (owner && owner.id === venue.id) {
      try {
        const cs = await store.getChangeSet(opts.draftId);
        if (cs.venue_id === venue.id) {
          draft = { id: cs.id, status: cs.status, summary_bg: cs.summary_bg, summary_en: cs.summary_en, preview_bg: cs.preview_bg, preview_en: cs.preview_en };
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
