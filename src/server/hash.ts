// src/server/hash.ts
// Server-only helpers (node:crypto). Never import from client components.
import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** 32 random bytes as hex: the wizard's draft token (only its sha256 is stored). */
export function newDraftToken(): string {
  return randomBytes(32).toString("hex");
}
