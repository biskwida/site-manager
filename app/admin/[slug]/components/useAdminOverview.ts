"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminActionName, AdminOverview } from "@/src/server/admin";

/** Polls the overview every 3 s (sequence-guarded like useLiveSite); `decide` POSTs a decision, then refetches at once. */
export function useAdminOverview(initial: AdminOverview, slug: string, adminKey: string) {
  const [overview, setOverview] = useState(initial);
  const [unauthorized, setUnauthorized] = useState(false);
  const seq = useRef(0);
  const url = `/api/admin/${encodeURIComponent(slug)}?key=${encodeURIComponent(adminKey)}`;

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

  const decide = useCallback(
    async (action: AdminActionName, changeSetId: string): Promise<boolean> => {
      let ok = false;
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, change_set_id: changeSetId }) });
        ok = res.ok;
      } catch {
        ok = false;
      }
      await load();
      return ok;
    },
    [url, load],
  );

  return { overview, unauthorized, decide };
}

export type Decide = ReturnType<typeof useAdminOverview>["decide"];
