import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { loadSite, publicSiteState } from "@/src/server/site";

export const dynamic = "force-dynamic";

// Public JSON feed. Deployed venue sites poll it cross-origin, so it allows any origin (it carries no secrets and no cookies matter).
const FEED_HEADERS = {
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
} as const;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: FEED_HEADERS });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/site/[slug]">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const site = await loadSite(deps.store, slug);
  if (!site) return Response.json({ error: "not found" }, { status: 404, headers: FEED_HEADERS });
  return Response.json({ state: publicSiteState(site.state), now: new Date().toISOString() }, { headers: FEED_HEADERS });
}
