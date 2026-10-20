// app/api/onboarding/[slug]/website/route.ts — the website add-on: starts the wizard on this existing venue (owner session required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleWebsiteDraft } from "@/src/server/onboarding";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/onboarding/[slug]/website">) {
  const { slug } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  return handleWebsiteDraft(req, slug, { store: deps.store, config: deps.config });
}
