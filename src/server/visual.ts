// src/server/visual.ts
// The /api/visual handler: checks the internal secret and the request, then runs the visual service.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { makeMenuPhoto, makeVisual, type VisualDeps } from "../visual/service";

const Body = z.object({
  venueId: z.string().min(1),
  mediaId: z.string().min(1),
  dish: z.string().min(1).max(40),
  price: z.string().max(20).nullish(),
  line: z.string().max(40).nullish(),
  colour: z.string().max(20).nullish(),
  formats: z.array(z.enum(["post", "story"])).min(1).max(4),
});

const MenuBody = z.object({ kind: z.literal("menu"), venueId: z.string().min(1), mediaId: z.string().min(1), itemId: z.string().min(1).optional(), style: z.enum(["match", "white"]).default("white") });

function sameSecret(given: string | null, secret: string): boolean {
  if (!given || !secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleVisualRequest(req: Request, d: { secret: string; visual: VisualDeps }): Promise<Response> {
  if (!sameSecret(req.headers.get("authorization"), d.secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.json().catch(() => null);
  const menu = typeof raw === "object" && raw !== null && (raw as { kind?: unknown }).kind === "menu";
  const parsed = menu ? MenuBody.safeParse(raw) : Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: `bad request: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` }, { status: 400 });
  try {
    if ("kind" in parsed.data) return Response.json(await makeMenuPhoto(d.visual, parsed.data));
    const formats = [...new Set(parsed.data.formats)];
    return Response.json(await makeVisual(d.visual, { ...parsed.data, formats }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[visual] failed:", msg);
    return Response.json({ error: msg }, { status: /not found|could not read/i.test(msg) ? 422 : 500 });
  }
}
