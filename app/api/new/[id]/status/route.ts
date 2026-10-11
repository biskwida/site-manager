// app/api/new/[id]/status/route.ts — venue status, deploy and site URL; polls the deployer while pending/building (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleStatus, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]/status">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleStatus({ store: deps.store, config: deps.config, now: () => new Date(), deployer: deps.deployer, messenger: deps.messenger }, guard.venue);
}
