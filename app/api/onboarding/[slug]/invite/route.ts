// app/api/onboarding/[slug]/invite/route.ts — "connect another app": a fresh owner code and its app links (owner session required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleOnboardingInvite } from "@/src/server/onboarding";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/onboarding/[slug]/invite">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  return handleOnboardingInvite(req, slug, { store: deps.store, config: deps.config, now: () => new Date() });
}
