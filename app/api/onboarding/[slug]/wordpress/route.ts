// app/api/onboarding/[slug]/wordpress/route.ts — connects the venue's WordPress site with the code the plugin shows (owner session required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleOnboardingWordPress } from "@/src/server/onboarding";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request, ctx: RouteContext<"/api/onboarding/[slug]/wordpress">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  return handleOnboardingWordPress(req, slug, { store: deps.store, connect: { secretKey: deps.destinationSecretKey, allowLocal: deps.isMemory }, now: () => new Date() });
}
