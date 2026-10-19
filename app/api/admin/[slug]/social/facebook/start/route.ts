// Sends the owner to the Facebook login for posting (admin key or owner session required); Meta redirects back to /api/social/facebook/callback.
import { after } from "next/server";
import { authorizeAdmin } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { handleSocialStart } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]/social/facebook/start">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const access = await authorizeAdmin(req, slug, { store: deps.store });
  if (!access) return Response.json({ error: "unauthorized" }, { status: 401 });
  return handleSocialStart({ store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date() }, access.venue, access.via === "key" ? access.key : { via: "session" }, "facebook");
}
