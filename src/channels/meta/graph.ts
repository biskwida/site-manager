// Meta Graph API: the one version constant and the media fetch shape shared by the parser and the senders.
import { MAX_IMAGE_BYTES } from "../../bot/media";

export const GRAPH = "https://graph.facebook.com/v25.0";
export type MediaFetch = (idOrUrl: string) => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;

export async function graphPost(fetchFn: typeof fetch, path: string, token: string, body: unknown, what: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetchFn(`${GRAPH}/${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = (json.error ?? {}) as Record<string, unknown>;
      console.error(`[meta] ${what} failed HTTP ${res.status} code=${err.code ?? "?"} subcode=${err.error_subcode ?? "?"}`);
      return null;
    }
    return json;
  } catch (e) {
    console.error(`[meta] ${what} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** GET a URL into memory (5 MB cap, same as Telegram downloads). Credentials go in `headers`, never in the URL. */
export async function downloadUrl(
  url: string,
  fetchFn: typeof fetch = fetch,
  headers: Record<string, string> = {},
): Promise<{ bytes: Uint8Array; contentType: string; name?: string }> {
  const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${bytes.byteLength} bytes)`);
  return { bytes, contentType: res.headers.get("content-type") ?? "application/octet-stream", name: new URL(url).pathname.split("/").pop() };
}

/** WhatsApp media: GET /{id} → { url }, then GET url with the bearer token (URL valid 5 minutes). */
export async function downloadWhatsAppMedia(token: string, mediaId: string, fetchFn: typeof fetch = fetch) {
  const meta = await fetchFn(`${GRAPH}/${encodeURIComponent(mediaId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!meta.ok) throw new Error(`media lookup failed (HTTP ${meta.status})`);
  const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
  if (!url) throw new Error("media lookup returned no url");
  const dl = await downloadUrl(url, fetchFn, { authorization: `Bearer ${token}` });
  return { ...dl, contentType: mime_type ?? dl.contentType };
}
