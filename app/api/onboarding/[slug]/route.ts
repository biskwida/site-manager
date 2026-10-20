// app/api/onboarding/[slug]/route.ts — the checklist's status (owner session required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleOnboardingStatus } from "@/src/server/onboarding";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/onboarding/[slug]">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  return handleOnboardingStatus(req, slug, { store: deps.store, billing: deps.config.billingEnabled });
}
