// src/destinations/registry.ts
import type { DestinationKind } from "../store/types";
import type { DestinationAdapter } from "./types";
import { facebookAdapter } from "./facebook";
import { googleAdapter } from "./google";
import { instagramAdapter } from "./instagram";
import { wordpressAdapter } from "./wordpress";

/** A GitHub adapter arrives in a later session; a destination row of an unknown kind is skipped with a log line. */
export const ADAPTERS: Partial<Record<DestinationKind, DestinationAdapter>> = { wordpress: wordpressAdapter, facebook: facebookAdapter, instagram: instagramAdapter, google: googleAdapter };

export function adapterFor(kind: DestinationKind): DestinationAdapter | null {
  return ADAPTERS[kind] ?? null;
}
