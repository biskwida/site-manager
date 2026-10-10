// src/bot/media.ts
import type { ImageInput } from "../agent/run";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The URL carries the bot token: it is built here, used once, and never logged or put in an error. */
export async function downloadTelegramFile(token: string, filePath: string, fetchFn: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetchFn(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${buf.byteLength} bytes)`);
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

const IMAGE_TYPES: ImageInput["media_type"][] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const UNINFORMATIVE_TYPES = ["", "application/octet-stream", "binary/octet-stream"];

export function imageMediaType(contentType: string, filePath: string): ImageInput["media_type"] | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if ((IMAGE_TYPES as string[]).includes(ct)) return ct as ImageInput["media_type"];
  if (ct.startsWith("image/")) return "image/jpeg";
  // Only an uninformative header lets the extension decide; a definite non-image type is refused.
  if (!UNINFORMATIVE_TYPES.includes(ct)) return null;
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg" || ext === undefined || !filePath.includes(".")) return "image/jpeg";
  return null;
}
