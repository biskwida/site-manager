import type { Announcement, Item } from "./types";

/** Read-time truth: an elapsed sold_out_until means available, no tick needed. */
export function isSoldOut(item: Pick<Item, "sold_out_until">, nowMs: number): boolean {
  return item.sold_out_until !== null && Date.parse(item.sold_out_until) > nowMs;
}

export function isLiveSpecial(item: Pick<Item, "is_special" | "special_expires_at" | "active">, nowMs: number): boolean {
  if (!item.is_special || !item.active) return false;
  return item.special_expires_at === null || Date.parse(item.special_expires_at) > nowMs;
}

/** Active items; specials only while live. */
export function visibleItems<T extends Pick<Item, "is_special" | "special_expires_at" | "active">>(items: T[], nowMs: number): T[] {
  return items.filter((i) => i.active && (!i.is_special || isLiveSpecial(i, nowMs)));
}

export function liveAnnouncements<T extends Pick<Announcement, "expires_at">>(list: T[], nowMs: number): T[] {
  return list.filter((a) => a.expires_at === null || Date.parse(a.expires_at) > nowMs);
}
