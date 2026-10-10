import { after } from "next/server";
import { adminAction, adminOverview, type AdminActionName } from "@/src/server/admin";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

async function auth(req: Request, slug: string) {
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return { deps, venue: null };
  return { deps, venue };
}

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string };
  const actions: AdminActionName[] = ["apply", "reject", "cancel", "undo"];
  if (!actions.includes(body.action as AdminActionName) || typeof body.change_set_id !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  const r = await adminAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, body.action as AdminActionName, body.change_set_id);
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
