// src/server/item-images.ts
// Copies product photos from an outside url (the Randevue import) into the venue's media and attaches them to the items through
// one "auto" change set, so the change log says where they came from. Runs after the publish response (src/server/wizard.ts);
// it never throws: a failed download just leaves that item without a photo.
import { planChanges } from "../domain/changes";
import { renderPreview } from "../domain/preview";
import type { ChangeOp } from "../domain/types";
import type { Store } from "../store/types";
import { isRandevueImageUrl } from "../wizard/randevue";
import { downloadImage } from "./instagram";

export interface ItemImageSource {
  item_id: string;
  url: string;
}
export interface ItemImageDeps {
  store: Store;
  fetch: typeof fetch;
  now: () => Date;
}

/** Downloads at a time; Supabase's image CDN answers quickly, and the job has the route's remaining time budget. */
export const ITEM_IMAGE_CONCURRENCY = 4;
/** Photos per job: a full Randevue menu has under 200 products. */
export const ITEM_IMAGES_MAX = 200;

/**
 * For every source whose item is still on the menu without a photo and whose url is on Randevue's bucket: download (capped,
 * sniffed), save as media, then one applied change set with a set_item_image per saved photo. Counts only; urls are not logged.
 */
export async function importItemImages(d: ItemImageDeps, venueId: string, sources: ItemImageSource[]): Promise<{ saved: number; failed: number }> {
  const site = await d.store.getSite(venueId);
  const items = new Map(site.items.filter((i) => i.active).map((i) => [i.id, i]));
  const todo: ItemImageSource[] = [];
  let failed = 0;
  const seen = new Set<string>();
  for (const s of sources.slice(0, ITEM_IMAGES_MAX)) {
    const item = items.get(s.item_id);
    if (!item || seen.has(s.item_id) || !isRandevueImageUrl(s.url)) {
      failed++;
      continue;
    }
    seen.add(s.item_id);
    if (item.image_media_id) continue; // already has one (an earlier run, or an upload): nothing to do, not a failure
    todo.push(s);
  }
  const ops: ChangeOp[] = [];
  let at = 0;
  const worker = async () => {
    while (at < todo.length) {
      const s = todo[at++];
      try {
        const r = await downloadImage(d.fetch, s.url, isRandevueImageUrl);
        if (!r.ok) {
          failed++;
          continue;
        }
        const media = await d.store.saveMedia(venueId, r.bytes, r.type);
        ops.push({ op: "set_item_image", item_id: s.item_id, media_id: media.id });
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ITEM_IMAGE_CONCURRENCY, todo.length) }, worker));
  if (!ops.length) return { saved: 0, failed };
  // Sorted by item position so the change log reads like the menu.
  const order = new Map(site.items.map((i) => [i.id, i.position + (site.categories.findIndex((c) => c.id === i.category_id) + 1) * 1000]));
  ops.sort((a, b) => (a.op === "set_item_image" && b.op === "set_item_image" ? (order.get(a.item_id) ?? 0) - (order.get(b.item_id) ?? 0) : 0));
  const nowIso = d.now().toISOString();
  try {
    const fresh = await d.store.getSite(venueId);
    const changes = planChanges(fresh, ops, { newId: () => crypto.randomUUID(), now: nowIso });
    const cs = await d.store.createChangeSet({
      venue_id: venueId,
      chat_ref: null,
      summary_bg: "Снимки от Randevue",
      summary_en: "Photos from Randevue",
      preview_bg: renderPreview(fresh, changes, "bg", fresh.venue.tz),
      preview_en: renderPreview(fresh, changes, "en", fresh.venue.tz),
      source: "auto",
      status: "proposed",
      changes,
    });
    const applied = await d.store.applyChangeSet(cs.id, nowIso);
    if (applied !== "applied") {
      console.error(`[wizard] randevue photos ${cs.id} for venue ${venueId}: ${applied}`);
      return { saved: 0, failed: failed + ops.length };
    }
  } catch (e) {
    console.error("[wizard] randevue photos: change set failed:", e instanceof Error ? e.message : e);
    return { saved: 0, failed: failed + ops.length };
  }
  return { saved: ops.length, failed };
}
