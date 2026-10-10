// src/templates/shared/useLiveSite.ts
"use client";
import { useEffect, useRef, useState } from "react";
import type { SiteState } from "@/src/domain/types";
import type { Changed } from "./types";

const POLL_MS = 5000;
const CLOCK_MS = 15000;

function signature(s: SiteState): Map<string, string> {
  const m = new Map<string, string>();
  for (const i of s.items) m.set(i.id, JSON.stringify([i.name_bg, i.name_en, i.desc_bg, i.desc_en, i.price_eur, i.allergens, i.image_media_id, i.sold_out_until, i.is_special, i.special_expires_at, i.active]));
  m.set("venue", JSON.stringify(s.venue));
  return m;
}

/**
 * Polls `feedUrl` (the public feed: `{ state: SiteState }`) every 5 s while `live`. `changed` maps ids whose content just
 * changed to the change time, for the flash. No realtime: this hook also runs inside deployed venue sites that have no Supabase keys.
 */
export function useLiveSite(initial: SiteState, feedUrl: string, live: boolean): { state: SiteState; changed: Changed } {
  const [state, setState] = useState(initial);
  const [changed, setChanged] = useState<Changed>(new Map());
  const seq = useRef(0);
  const prev = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!live) return; // a draft preview shows a fixed state and never polls
    prev.current ??= signature(initial);
    let stop = false;
    const load = async () => {
      const mine = ++seq.current;
      try {
        const res = await fetch(feedUrl, { cache: "no-store" });
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
      } catch {
        // keep the last good state; the next poll retries
      }
    };
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      stop = true;
      window.clearInterval(poll);
    };
    // `initial` only seeds the first signature; the page remounts the template (keyed) when the server state source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedUrl, live]);

  return { state, changed };
}

/** Wall clock for open/closed and timers: starts from the server's `now` (hydration-safe) and ticks every 15 s. */
export function useNow(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(clock);
  }, []);
  return now;
}
