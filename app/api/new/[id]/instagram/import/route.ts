// app/api/new/[id]/instagram/import/route.ts — copies picked Instagram photos into the draft's media (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleInstagramImport } from "@/src/server/instagram";
import { requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/instagram/import">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleInstagramImport(req, { store: deps.store, config: deps.config, fetch: deps.fetch, now: () => new Date() }, guard.venue);
}
