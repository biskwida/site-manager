"use client";
import { useEffect, useRef, useState } from "react";
import type { SiteState } from "@/src/domain/types";
import { supabaseBrowser } from "@/src/lib/supabase-browser";

const TABLES = ["items", "categories", "venues", "holidays", "announcements", "site_texts", "media"];

function signature(s: SiteState): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of s.items) m.set(i.id, JSON.stringify([i.name_bg, i.name_en, i.desc_bg, i.desc_en, i.price_eur, i.allergens, i.image_media_id, i.sold_out_until, i.is_special, i.special_expires_at, i.active]));
  m.set("venue", JSON.stringify(s.venue));
  return m;
}

/** Polls every 5 s and refetches on realtime events (when configured). `changed` maps ids whose content just changed to the change time, for the flash. */
export function useLiveSite(initial: SiteState, slug: string, live: boolean) {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [changed, setChanged] = useState<ReadonlyMap<string, number>>(new Map());
  const seq = useRef(0);
  const prev = useRef<Map<string, string> | null>(null);
  const venueId = initial.venue.id;

  useEffect(() => {
    if (!live) return; // a draft preview shows a fixed state and never polls
    prev.current ??= signature(initial);
    let stop = false;
    const load = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(`/api/site/${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (!res.ok || mine !== seq.current || stop) return; // a newer request already started; drop this stale response
        const data = (await res.json()) as { state: SiteState };
        if (mine !== seq.current || stop) return;
        const sig = signature(data.state);
        const at = Date.now();
        const diff = new Map<string, number>();
        for (const [id, v] of sig) if (prev.current?.get(id) !== v) diff.set(id, at);
        prev.current = sig;
        if (diff.size) setChanged((c) => new Map([...c, ...diff]));
        setState(data.state);
        setNow(at);
      } catch {
        // keep the last good state; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), 5000); // safety net if realtime is off
    const clock = window.setInterval(() => setNow(Date.now()), 15000);
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 250);
    };
    const sb = supabaseBrowser();
    const channel = sb
      ? TABLES.reduce(
          (ch, table) => ch.on("postgres_changes", { event: "*", schema: "public", table, filter: table === "venues" ? `id=eq.${venueId}` : `venue_id=eq.${venueId}` }, refresh),
          sb.channel(`site-${venueId}`),
        ).subscribe()
      : null;
    return () => {
      stop = true;
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.clearTimeout(timer);
      if (sb && channel) void sb.removeChannel(channel);
    };
    // `initial` only seeds the first signature; the page remounts this view (keyed) when the server state source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, live, venueId]);

  return { state, now, changed };
}
