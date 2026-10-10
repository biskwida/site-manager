// The wizard's save queue: one PUT in flight, edits merged while it flies, automatic retries for transient failures,
// and server-rejected fields surfaced instead of retried forever. Framework-free so it is unit-tested in node.
import type { PublishError } from "@/src/wizard/schema";

export type SaveResult = { ok: true } | { ok: false; status: number; error: { code: string; bg: string; en: string; details?: PublishError[] } };
export type SaveState = "idle" | "saving" | "saved" | "retrying" | "rejected";
export interface SaveSnapshot {
  state: SaveState;
  /** Field errors from rejected saves (400/409), until those fields save. */
  errors: PublishError[];
  /** The server's message for the last rejection; null otherwise. */
  message: { bg: string; en: string } | null;
}

export interface AutosaveOptions<P> {
  send: (patch: Partial<P>, keepalive: boolean) => Promise<SaveResult>;
  onChange: (s: SaveSnapshot) => void;
  debounceMs?: number;
}

const BACKOFF_MAX_MS = 30_000;
/** 1 s, 2 s, 4 s … capped at 30 s; `attempt` counts failures so far minus one. */
export function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, 1000 * 2 ** attempt);
}

const isTransient = (status: number) => status === 0 || status === 429 || status >= 500;
const head = (path: string) => path.split(".")[0];

export class Autosave<P extends object> {
  private pending: Partial<P> = {};
  private inflight: Promise<boolean> | null = null;
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private disposed = false;
  private snap: SaveSnapshot = { state: "idle", errors: [], message: null };

  constructor(private readonly o: AutosaveOptions<P>) {}

  /** Merge an edit (later keys win) and save it after the debounce, unless a retry is already scheduled. */
  edit(patch: Partial<P>): void {
    Object.assign(this.pending, patch);
    if (this.retry !== undefined || this.disposed) return;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.drain(false), this.o.debounceMs ?? 800);
  }

  /** Save everything pending now. True when the server has every edit and no field is rejected. */
  flush(keepalive = false): Promise<boolean> {
    clearTimeout(this.debounce);
    this.debounce = undefined;
    clearTimeout(this.retry);
    this.retry = undefined;
    return this.drain(keepalive);
  }

  get snapshot(): SaveSnapshot {
    return this.snap;
  }

  /** Undo dispose() (React's dev StrictMode unmounts and remounts effects once); pending edits are scheduled again. */
  resume(): void {
    if (!this.disposed) return;
    this.disposed = false;
    if (this.hasPending()) this.edit({});
  }

  /** No more timers after this (an in-flight request still settles). */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.debounce);
    clearTimeout(this.retry);
  }

  private set(next: Partial<SaveSnapshot>) {
    this.snap = { ...this.snap, ...next };
    this.o.onChange(this.snap);
  }

  private hasPending() {
    return Object.keys(this.pending).length > 0;
  }

  private async drain(keepalive: boolean): Promise<boolean> {
    while (this.inflight) await this.inflight;
    if (!this.hasPending()) return this.snap.errors.length === 0;
    const sent: Partial<P> = { ...this.pending };
    this.set({ state: "saving" });
    this.inflight = this.o.send(sent, keepalive).then((r) => {
      this.inflight = null;
      return this.settle(sent, r);
    });
    const ok = await this.inflight;
    if (!ok) return false;
    return this.hasPending() ? this.drain(keepalive) : this.snap.errors.length === 0;
  }

  /** Drop a sent key only while it still holds the value that was sent (an edit made meanwhile must still go out). */
  private dropSent(sent: Partial<P>, keys: string[]) {
    const pending = this.pending as Record<string, unknown>;
    const s = sent as Record<string, unknown>;
    for (const k of keys) if (Object.is(pending[k], s[k])) delete pending[k];
  }

  private settle(sent: Partial<P>, r: SaveResult): boolean {
    const keys = Object.keys(sent);
    if (r.ok) {
      this.failures = 0;
      this.dropSent(sent, keys);
      const errors = this.snap.errors.filter((e) => !keys.includes(head(e.path)));
      this.set({ state: errors.length ? "rejected" : this.hasPending() ? "saving" : "saved", errors, message: errors.length ? this.snap.message : null });
      return true;
    }
    if (isTransient(r.status)) {
      const wait = backoffMs(this.failures);
      this.failures += 1;
      this.set({ state: "retrying" });
      if (!this.disposed) {
        clearTimeout(this.retry);
        this.retry = setTimeout(() => { this.retry = undefined; void this.drain(false); }, wait);
      }
      return false;
    }
    // Rejected (400/409, or a 4xx we cannot fix by retrying): show it, stop sending the offending fields, keep the rest.
    this.failures = 0;
    const details = r.error.details?.length ? r.error.details : r.error.code === "slug_taken" ? [{ path: "slug", bg: r.error.bg, en: r.error.en }] : [];
    const named = details.map((d) => head(d.path)).filter((k) => keys.includes(k));
    this.dropSent(sent, named.length ? named : keys);
    const errors = [...this.snap.errors.filter((e) => !details.some((d) => d.path === e.path)), ...details];
    this.set({ state: "rejected", errors, message: { bg: r.error.bg, en: r.error.en } });
    if (this.hasPending() && !this.disposed) {
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.drain(false), this.o.debounceMs ?? 800);
    }
    return false;
  }
}

export type PublishOutcome<T> = { status: "busy" } | { status: "unsaved" } | { status: "done"; value: T };

/**
 * One click, one publish: the ref guard holds across renders, the pending autosave goes out first, and a failed save
 * stops the publish (the server would build the site from an older draft). On success the guard stays set: the page is leaving.
 */
export async function publishOnce<T>({ inFlight, flush, publish, succeeded = () => true }: { inFlight: { current: boolean }; flush: () => Promise<boolean>; publish: () => Promise<T>; succeeded?: (v: T) => boolean }): Promise<PublishOutcome<T>> {
  if (inFlight.current) return { status: "busy" };
  inFlight.current = true;
  try {
    if (!(await flush())) {
      inFlight.current = false;
      return { status: "unsaved" };
    }
    const value = await publish();
    if (!succeeded(value)) inFlight.current = false;
    return { status: "done", value };
  } catch (e) {
    inFlight.current = false;
    throw e;
  }
}
