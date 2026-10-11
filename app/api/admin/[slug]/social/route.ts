import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { disconnectSocial, SOCIAL_KINDS, type SocialKind } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";

/** POST { action: "disconnect", kind: "facebook" | "instagram" } with ?key=<admin token>: removes that stored connection. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/social">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; kind?: string };
  if (body.action !== "disconnect" || !SOCIAL_KINDS.includes(body.kind as SocialKind)) return Response.json({ error: "bad request" }, { status: 400 });
  const disconnected = await disconnectSocial(deps.store, venue.id, body.kind as SocialKind);
  return Response.json({ ok: true, disconnected });
}
