// src/visual/client.ts
// How the agent asks for a picture: over HTTP to /api/visual, so the cut-out model stays in that one function.
import type { RestyleRequest, RestyleResult } from "./restyle";
import type { MenuPhotoRequest, MenuPhotoResult, VisualRequest, VisualResult } from "./service";

/**
 * Asking for a picture; `menuPhoto` asks for the plain website photo, `restyle` for an AI-restyled photo (present only when the
 * deployment has the image model key). Both optional so a plain function still is a client.
 */
export type VisualClient = ((req: VisualRequest) => Promise<VisualResult>) & {
  menuPhoto?: (req: MenuPhotoRequest) => Promise<MenuPhotoResult>;
  restyle?: (req: RestyleRequest) => Promise<RestyleResult>;
};

export const VISUAL_PATH = "/api/visual";

export function httpVisualClient(o: { baseUrl: string; secret: string; fetch?: typeof fetch; timeoutMs?: number; restyle?: boolean }): VisualClient {
  const f = o.fetch ?? fetch;
  const post = async <T>(payload: unknown): Promise<T> => {
    const res = await f(`${o.baseUrl}${VISUAL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${o.secret}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(o.timeoutMs ?? 55_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(body.error ?? `The picture service answered HTTP ${res.status}.`);
    return body as T;
  };
  const client = (req: VisualRequest) => post<VisualResult>(req);
  return Object.assign(client, {
    menuPhoto: (req: MenuPhotoRequest) => post<MenuPhotoResult>({ kind: "menu", ...req }),
    ...(o.restyle ? { restyle: (req: RestyleRequest) => post<RestyleResult>({ kind: "restyle", ...req }) } : {}),
  });
}
