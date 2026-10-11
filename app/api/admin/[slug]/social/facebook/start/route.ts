// Sends the owner to the Facebook login for posting (admin key required); Meta redirects back to /api/social/facebook/callback.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleSocialStart } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]/social/facebook/start">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug || !key) return Response.json({ error: "unauthorized" }, { status: 401 });
  return handleSocialStart({ store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date() }, venue, key, "facebook");
}
