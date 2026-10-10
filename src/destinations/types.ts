// src/destinations/types.ts
import type { Change, ChangeSet, Venue } from "../domain/types";
import type { Destination, DestinationKind } from "../store/types";

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
}
export type PushResult =
  | { ok: true; result: Record<string, unknown>; line: { bg: string; en: string } }
  | { ok: false; retry: boolean; error: string; line: { bg: string; en: string } };

export interface DestinationAdapter {
  kind: DestinationKind;
  /** The changes of a set this destination must receive; empty = nothing to push. */
  relevant(changes: Change[]): Change[];
  push(ctx: PushContext): Promise<PushResult>;
}
