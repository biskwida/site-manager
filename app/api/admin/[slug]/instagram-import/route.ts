// Dashboard "Import photos from Instagram" (admin key required): GET lists the connected account's photos and the live menu's
// dishes; POST { picks } imports them as one applied change set. Uses the stored Instagram connection; no OAuth here.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleDashboardInstagramImport, handleDashboardInstagramList, type DashboardInstagramDeps } from "@/src/server/dashboard-instagram";

export const dynamic = "force-dynamic";
// Up to 12 downloads (a few at a time, 10 s timeout per hop) plus the Instagram reads; the import stops starting downloads at 240 s.
export const maxDuration = 300;

async function auth(req: Request, slug: string) {
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return { venue: null, d: null };
  // deps.store is the decorated store: the apply reaches connected destinations like every other dashboard apply.
  const d: DashboardInstagramDeps = { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date() };
  return { venue, d };
}

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]/instagram-import">) {
  const { slug } = await ctx.params;
  const { venue, d } = await auth(req, slug);
  if (!venue || !d) return Response.json({ error: "unauthorized" }, { status: 401 });
  return handleDashboardInstagramList(d, venue);
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]/instagram-import">) {
  const { slug } = await ctx.params;
  const { venue, d } = await auth(req, slug);
  if (!venue || !d) return Response.json({ error: "unauthorized" }, { status: 401 });
  return handleDashboardInstagramImport(req, d, venue);
}
