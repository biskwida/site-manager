// Sends the owner to Google's consent screen for the Business Profile (admin key or owner session required); Google redirects back to /api/social/google/callback on this host.
import { after } from "next/server";
import { adminGate, socialAuthOf } from "@/src/server/admin-auth";
import { getServerDeps } from "@/src/server/deps";
import { handleGoogleStart } from "@/src/server/google-connect";
import { returnTargetOf } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]/social/google/start">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const gate = await adminGate(req, slug, { store: deps.store });
  if ("response" in gate) return gate.response;
  const { access } = gate;
  return handleGoogleStart(req, { store: deps.store, config: deps.config, secretKey: deps.destinationSecretKey, fetch: deps.fetch, now: () => new Date() }, access.venue, socialAuthOf(access), { ret: returnTargetOf(req.url) });
}
