// src/destinations/secrets.ts
// Server-only (node:crypto): AES-256-GCM for destination secrets such as the WordPress plugin token.
// Blob = base64( iv(12) || tag(16) || ciphertext ). Never log inputs or outputs of these functions.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Used only when SITE_MANAGER_STORE=memory and DESTINATION_SECRET_KEY is unset (offline tests, dev server). */
export const DEV_SECRET_KEY_HEX = "7d2f1c9a4b6e8f0a1c3e5b7d9f2a4c6e8b0d1f3a5c7e9b2d4f6a8c0e1b3d5f7a";

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** 32 bytes as 64 hex chars or 44 base64 chars. */
export function parseSecretKey(raw: string): Buffer {
  const s = raw.trim();
  const buf = /^[0-9a-fA-F]{64}$/.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  if (buf.length !== 32) throw new Error("DESTINATION_SECRET_KEY must be 32 bytes as hex (64 chars) or base64 (44 chars); generate: openssl rand -hex 32");
  return buf;
}

export function encryptSecrets(secrets: Record<string, string>, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(secrets), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptSecrets(blob: string, key: Buffer): Record<string, string> {
  try {
    const bytes = Buffer.from(blob, "base64");
    if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error("too short");
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(plain);
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed as Record<string, string>;
  } catch {
    throw new Error("Could not decrypt destination secrets (wrong DESTINATION_SECRET_KEY or corrupted data)");
  }
}

/** The key to use, or null when secrets cannot be handled (production without the variable). */
export function resolveSecretKey(configured: string | null, isMemory: boolean, log: (s: string) => void = console.warn): Buffer | null {
  if (configured) return parseSecretKey(configured);
  if (isMemory) {
    log("[destinations] DESTINATION_SECRET_KEY is not set; using the fixed development key (memory store only)");
    return parseSecretKey(DEV_SECRET_KEY_HEX);
  }
  return null;
}
