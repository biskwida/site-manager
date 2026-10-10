// test/wizard-autosave.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Autosave, backoffMs, publishOnce, type SaveResult, type SaveSnapshot } from "@/app/new/components/autosave";

type Patch = Record<string, unknown>;
const OK: SaveResult = { ok: true };
const fail = (status: number, extra: Partial<{ code: string; details: { path: string; bg: string; en: string }[] }> = {}): SaveResult => ({
  ok: false, status, error: { code: extra.code ?? "error", bg: "БГ грешка", en: "EN error", details: extra.details },
});

/** A send() whose responses the test resolves by hand, so we can interleave edits with requests in flight. */
function manualSend() {
  const calls: { patch: Patch; keepalive: boolean; resolve: (r: SaveResult) => void }[] = [];
  const send = vi.fn((patch: Patch, keepalive: boolean) => new Promise<SaveResult>((resolve) => calls.push({ patch, keepalive, resolve })));
  return { send, calls };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("autosave queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces edits into one PUT with later keys winning", async () => {
    const { send, calls } = manualSend();
    const q = new Autosave<Patch>({ send, onChange: () => undefined, debounceMs: 800 });
    q.edit({ name: "A" });
    q.edit({ name: "AB", phone: "1" });
    await vi.advanceTimersByTimeAsync(799);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].patch).toEqual({ name: "AB", phone: "1" });
  });

  it("keeps one PUT in flight and keeps edits made meanwhile (drops only keys still equal to what was sent)", async () => {
    const { send, calls } = manualSend();
    const states: SaveSnapshot[] = [];
    const q = new Autosave<Patch>({ send, onChange: (s) => states.push(s), debounceMs: 800 });
    q.edit({ name: "A", phone: "1" });
    const f1 = q.flush();
    expect(calls).toHaveLength(1);
    q.edit({ name: "AB" }); // typed while the first PUT is in flight
    const f2 = q.flush();
    await tick();
    expect(calls).toHaveLength(1); // still one in flight
    calls[0].resolve(OK);
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].patch).toEqual({ name: "AB" }); // phone was saved and is not resent; the newer name is
    calls[1].resolve(OK);
    // Both flushes resolve once the server has every edit, including the one made while the first PUT flew.
    expect(await f1).toBe(true);
    expect(await f2).toBe(true);
    expect(calls).toHaveLength(2);
    expect(states.at(-1)?.state).toBe("saved");
  });

  it("retries 429, 5xx and network failures with 1 s, 2 s, 4 s … backoff capped at 30 s, without user action", async () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(backoffMs)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    const { send, calls } = manualSend();
    const states: SaveSnapshot[] = [];
    const q = new Autosave<Patch>({ send, onChange: (s) => states.push(s), debounceMs: 800 });
    q.edit({ name: "A" });
    const first = q.flush();
    calls[0].resolve(fail(503));
    expect(await first).toBe(false);
    expect(states.at(-1)?.state).toBe("retrying");
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    calls[1].resolve(fail(0));
    await tick();
    await vi.advanceTimersByTimeAsync(1999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    calls[2].resolve(fail(429));
    await tick();
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toHaveLength(4);
    expect(calls[3].patch).toEqual({ name: "A" });
    calls[3].resolve(OK);
    await tick();
    expect(states.at(-1)?.state).toBe("saved");
  });

  it("on 400/409 surfaces the server's message, drops only the offending keys and saves the rest", async () => {
    const { send, calls } = manualSend();
    const states: SaveSnapshot[] = [];
    const q = new Autosave<Patch>({ send, onChange: (s) => states.push(s), debounceMs: 800 });
    q.edit({ slug: "taken", phone: "1" });
    const f = q.flush();
    calls[0].resolve(fail(409, { code: "slug_taken" }));
    expect(await f).toBe(false);
    const s = states.at(-1)!;
    expect(s.state).toBe("rejected");
    expect(s.message).toEqual({ bg: "БГ грешка", en: "EN error" });
    expect(s.errors).toEqual([{ path: "slug", bg: "БГ грешка", en: "EN error" }]);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(2);
    expect(calls[1].patch).toEqual({ phone: "1" });
    calls[1].resolve(OK);
    await tick();
    expect(states.at(-1)?.state).toBe("rejected"); // the slug is still not saved
    // Fixing the field clears the error once it saves.
    q.edit({ slug: "free" });
    const g = q.flush();
    calls[2].resolve(OK);
    expect(await g).toBe(true);
    expect(states.at(-1)).toMatchObject({ state: "saved", errors: [], message: null });
  });

  it("maps 400 details to keys by their first path segment", async () => {
    const { send, calls } = manualSend();
    const q = new Autosave<Patch>({ send, onChange: () => undefined, debounceMs: 800 });
    q.edit({ categories: [], name: "x" });
    const f = q.flush();
    calls[0].resolve(fail(400, { details: [{ path: "categories.0.items.1.price_eur", bg: "б", en: "e" }] }));
    expect(await f).toBe(false);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls[1].patch).toEqual({ name: "x" });
  });

  it("flush() resolves true when nothing is pending and sends keepalive when asked", async () => {
    const { send, calls } = manualSend();
    const q = new Autosave<Patch>({ send, onChange: () => undefined, debounceMs: 800 });
    expect(await q.flush()).toBe(true);
    q.edit({ name: "A" });
    void q.flush(true);
    expect(calls[0].keepalive).toBe(true);
  });

  it("stops retrying once disposed", async () => {
    const { send, calls } = manualSend();
    const q = new Autosave<Patch>({ send, onChange: () => undefined, debounceMs: 800 });
    q.edit({ name: "A" });
    const f = q.flush();
    calls[0].resolve(fail(503));
    await f;
    q.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });
});

describe("publishOnce", () => {
  it("flushes first and refuses to publish when the flush fails", async () => {
    const publish = vi.fn(async () => "published");
    const r = await publishOnce({ inFlight: { current: false }, flush: async () => false, publish });
    expect(r).toEqual({ status: "unsaved" });
    expect(publish).not.toHaveBeenCalled();
  });
  it("sends one publish however many times it is called while in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const publish = vi.fn(async () => { await gate; return "published"; });
    const inFlight = { current: false };
    const a = publishOnce({ inFlight, flush: async () => true, publish });
    const b = publishOnce({ inFlight, flush: async () => true, publish });
    expect(await b).toEqual({ status: "busy" });
    release();
    expect(await a).toEqual({ status: "done", value: "published" });
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("lets the owner try again after a failed publish", async () => {
    const inFlight = { current: false };
    const r = await publishOnce({ inFlight, flush: async () => true, publish: async () => { throw new Error("x"); } }).catch(() => "threw");
    expect(r).toBe("threw");
    expect(inFlight.current).toBe(false);
  });
});

describe("autosave queue across a StrictMode remount", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("resume() after dispose() saves edits again", async () => {
    const send = vi.fn(async () => ({ ok: true }) as SaveResult);
    const q = new Autosave<Patch>({ send, onChange: () => undefined, debounceMs: 800 });
    q.dispose();
    q.resume();
    q.edit({ name: "A" });
    await vi.advanceTimersByTimeAsync(800);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
