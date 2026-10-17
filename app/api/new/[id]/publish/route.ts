// app/api/new/[id]/publish/route.ts — makes the draft a live venue and returns the owner's invite (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handlePublish, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/publish">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handlePublish({ store: deps.store, config: deps.config, now: () => new Date(), fetch: deps.fetch, defer: (fn) => after(fn) }, guard.venue);
}
