// test/tick-nudge.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTickNudge, TICK_NUDGE_MS, TICK_NUDGE_WINDOW_MS } from "@/app/components/tickNudge";

describe("startTickNudge", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("POSTs /api/tick?key= at once and every 30 s for 10 minutes, then calls back after each nudge", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return new Response("{}");
    }) as typeof fetch;
    let after = 0;
    const stop = startTickNudge({ adminKey: "k 1", fetcher, onNudged: () => void after++ });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([["/api/tick?key=k%201", { method: "POST" }]]);
    expect(after).toBe(1);
    await vi.advanceTimersByTimeAsync(TICK_NUDGE_MS);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(TICK_NUDGE_WINDOW_MS);
    const n = calls.length;
    expect(n).toBe(TICK_NUDGE_WINDOW_MS / TICK_NUDGE_MS + 1);
    await vi.advanceTimersByTimeAsync(TICK_NUDGE_MS * 3);
    expect(calls).toHaveLength(n); // window over
    stop();
  });

  it("stops when stopped and swallows network errors", async () => {
    let n = 0;
    const fetcher = (async () => {
      n++;
      throw new Error("offline");
    }) as typeof fetch;
    const stop = startTickNudge({ adminKey: "k", fetcher });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(TICK_NUDGE_MS * 4);
    expect(n).toBe(1);
  });
});
