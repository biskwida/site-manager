// Meta Graph API: the one version constant and the media fetch shape shared by the parser and the senders.
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
