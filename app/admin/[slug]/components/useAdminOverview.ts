"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminActionName, AdminOverview } from "@/src/server/admin";

/**
 * The admin API URL for this venue. A legacy admin key rides as `?key=`; without one (the account dashboard) the request carries
 * the session cookie on its own (same-origin fetches and navigations send it).
 */
export function adminApiUrl(slug: string, adminKey: string | undefined, path = ""): string {
  return `/api/admin/${encodeURIComponent(slug)}${path}${adminKey ? `?key=${encodeURIComponent(adminKey)}` : ""}`;
}

/** Polls the overview every 3 s (sequence-guarded like useLiveSite); `decide` POSTs a decision, then refetches at once. */
export function useAdminOverview(initial: AdminOverview, slug: string, adminKey: string | undefined) {
  const [overview, setOverview] = useState(initial);
  const [unauthorized, setUnauthorized] = useState(false);
  const seq = useRef(0);
  const url = adminApiUrl(slug, adminKey);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (mine !== seq.current) return; // a newer request already started; drop this stale response
      if (res.status === 401) return setUnauthorized(true);
      if (!res.ok) return;
      const data = (await res.json()) as AdminOverview;
      if (mine !== seq.current) return;
      setOverview(data);
    } catch {
      // keep the last good overview; the next poll retries
    }
  }, [url]);

  useEffect(() => {
    const poll = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(poll);
  }, [load]);

  /** POSTs any dashboard action, then refetches at once. `data` is the parsed JSON (null on a network error or a non-JSON body). */
  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> => {
      let out: { ok: boolean; data: unknown } = { ok: false, data: null };
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        out = { ok: res.ok, data: await res.json().catch(() => null) };
      } catch {
        out = { ok: false, data: null };
      }
      await load();
      return out;
    },
    [url, load],
  );

  const decide = useCallback(async (action: AdminActionName, changeSetId: string): Promise<boolean> => (await post({ action, change_set_id: changeSetId })).ok, [post]);

  return { overview, unauthorized, decide, post, refresh: load };
}

export type Decide = ReturnType<typeof useAdminOverview>["decide"];
export type Post = ReturnType<typeof useAdminOverview>["post"];
export type Refresh = ReturnType<typeof useAdminOverview>["refresh"];
