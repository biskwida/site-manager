// src/destinations/registry.ts
import type { DestinationKind } from "../store/types";
import type { DestinationAdapter } from "./types";
import { facebookAdapter } from "./facebook";
import { instagramAdapter } from "./instagram";
import { wordpressAdapter } from "./wordpress";

/** Google and GitHub adapters arrive in later sessions; a destination row of an unknown kind is skipped with a log line. */
export const ADAPTERS: Partial<Record<DestinationKind, DestinationAdapter>> = { wordpress: wordpressAdapter, facebook: facebookAdapter, instagram: instagramAdapter };

export function adapterFor(kind: DestinationKind): DestinationAdapter | null {
  return ADAPTERS[kind] ?? null;
}
