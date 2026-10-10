// app/api/new/[id]/media/route.ts — multipart image upload into the draft venue's media (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMedia, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/media">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleMedia(req, { store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
