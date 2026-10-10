// app/components/tickNudge.ts — client helper shared by the done page and the dashboard's SiteCard.
// While a deploy is in flight, POST /api/tick?key=<admin key> (the tick's per-venue auth) so the deployment is polled promptly.
// The background watch after the deploy starts and the 5-minute cron also finish it; this only shortens the wait for the viewer.

export const TICK_NUDGE_MS = 30_000;
export const TICK_NUDGE_WINDOW_MS = 10 * 60_000;

/** Nudges at once, then every TICK_NUDGE_MS for TICK_NUDGE_WINDOW_MS. `onNudged` runs after each nudge (e.g. to refetch). Returns stop. */
export function startTickNudge(o: { adminKey: string; fetcher?: typeof fetch; onNudged?: () => void }): () => void {
  const fetcher = o.fetcher ?? ((input, init) => fetch(input, init));
  const started = Date.now();
  let stopped = false;
  const nudge = async () => {
    if (stopped || Date.now() - started > TICK_NUDGE_WINDOW_MS) return;
    try {
      await fetcher(`/api/tick?key=${encodeURIComponent(o.adminKey)}`, { method: "POST" });
    } catch {
      // offline or refused: the next nudge, the background watch or the cron catches up
    }
    if (!stopped) o.onNudged?.();
  };
  void nudge();
  const timer = setInterval(() => void nudge(), TICK_NUDGE_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
