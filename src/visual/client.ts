// src/visual/client.ts
// How the agent asks for a picture: over HTTP to /api/visual, so the cut-out model stays in that one function.
import type { VisualRequest, VisualResult } from "./service";

export type VisualClient = (req: VisualRequest) => Promise<VisualResult>;

export const VISUAL_PATH = "/api/visual";

export function httpVisualClient(o: { baseUrl: string; secret: string; fetch?: typeof fetch; timeoutMs?: number }): VisualClient {
  const f = o.fetch ?? fetch;
  return async (req) => {
    const res = await f(`${o.baseUrl}${VISUAL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.secret}` },
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(o.timeoutMs ?? 55_000),
    });
    const body = (await res.json().catch(() => ({}))) as Partial<VisualResult> & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `The picture service answered HTTP ${res.status}.`);
    return body as VisualResult;
  };
}
