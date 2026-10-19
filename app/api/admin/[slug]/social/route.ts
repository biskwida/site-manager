import { after } from "next/server";
import { adminGate } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { disconnectSocial, SOCIAL_KINDS, type SocialKind } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";

/** POST { action: "disconnect", kind: "facebook" | "instagram" } with ?key=<admin token> or an owner session: removes that stored connection. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/social">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const gate = await adminGate(req, slug, { store: deps.store });
  if ("response" in gate) return gate.response;
  const { venue } = gate.access;
  const body = (await req.json().catch(() => ({}))) as { action?: string; kind?: string };
  if (body.action !== "disconnect" || !SOCIAL_KINDS.includes(body.kind as SocialKind)) return Response.json({ error: "bad request" }, { status: 400 });
  const disconnected = await disconnectSocial(deps.store, venue.id, body.kind as SocialKind);
  return Response.json({ ok: true, disconnected });
}
