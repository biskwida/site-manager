import { after } from "next/server";
import { disconnectWordPress } from "@/src/destinations/connect";
import { authorizeAdmin } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

/** POST { action: "disconnect" } with ?key=<admin token> or an owner session: removes the stored WordPress connection. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/wordpress">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const access = await authorizeAdmin(req, slug, { store: deps.store });
  if (!access) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { venue } = access;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "disconnect") return Response.json({ error: "bad request" }, { status: 400 });
  const disconnected = await disconnectWordPress({ store: deps.store, secretKey: deps.destinationSecretKey }, venue.id);
  return Response.json({ ok: true, disconnected });
}
