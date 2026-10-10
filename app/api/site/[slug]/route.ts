import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { loadSite } from "@/src/server/site";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/site/[slug]">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const site = await loadSite(deps.store, slug);
  if (!site) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ state: site.state, now: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
