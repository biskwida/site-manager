// src/destinations/types.ts
import type { Change, ChangeSet, SiteState, Venue } from "../domain/types";
import type { Destination, DestinationKind } from "../store/types";
import type { GoogleCreds } from "./google-api";

export interface PushContext {
  venue: Venue;
  destination: Destination;
  /** Decrypted secrets for this destination; never log them. */
  secrets: Record<string, string>;
  changeSet: ChangeSet;
  /** The subset of changeSet.changes this adapter handles, in position order. */
  changes: Change[];
  fetch?: typeof fetch;
  now: Date;
  /** Results already stored on this destination's sync rows of the same set (an earlier, partly failed attempt): skip what they published. */
  prior?: Record<string, unknown>[];
  /** Results stored on this destination's sync rows of another set (for an undo: the set it reverts). */
  resultsOf?: (changeSetId: string) => Promise<Record<string, unknown>[]>;
  /** Replaces the destination's config and secrets (encrypted by the caller), e.g. after a token refresh. Keeps its status. */
  saveConnection?: (config: Record<string, unknown>, secrets: Record<string, string>) => Promise<void>;
  /**
   * Re-reads the destination and writes `set` (and removes `remove`) onto its current config, keeping every other key and the
   * secrets as they are now. Does nothing when the destination is gone or disconnected meanwhile. Used by Google.
   */
  patchConfig?: (set: Record<string, unknown>, remove?: readonly string[]) => Promise<void>;
  /** Waits between polls (Instagram containers); tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
  /** Stores a partial result on the sync row right away (before a call whose answer might be lost). */
  checkpoint?: (partial: Record<string, unknown>) => Promise<void>;
  /** The venue's site as stored now (after the apply that queued this push). */
  loadSite?: () => Promise<SiteState>;
  /** Claudia's Google OAuth client; null when GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. */
  google?: GoogleCreds | null;
}
export type PushResult =
  | { ok: true; result: Record<string, unknown>; line: { bg: string; en: string } }
  | { ok: false; retry: boolean; error: string; line: { bg: string; en: string }; /** The plugin's error code (sm_unauthorized…), when it sent one. */ code?: string; /** What this attempt did publish before failing; stored as the row's result so a retry skips it. */ partial?: Record<string, unknown> };

export interface DestinationAdapter {
  kind: DestinationKind;
  /** The changes of a set this destination must receive; empty = nothing to push. */
  relevant(changes: Change[]): Change[];
  push(ctx: PushContext): Promise<PushResult>;
}
