import { after } from "next/server";
import { disconnectWordPress } from "@/src/destinations/connect";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

/** POST { action: "disconnect" } with ?key=<admin token>: removes the stored WordPress connection. */
export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/wordpress">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "disconnect") return Response.json({ error: "bad request" }, { status: 400 });
  const disconnected = await disconnectWordPress({ store: deps.store, secretKey: deps.destinationSecretKey }, venue.id);
  return Response.json({ ok: true, disconnected });
}
