// app/api/new/[id]/publish/route.ts — makes the draft a live venue and returns the owner's invite (draft cookie required; a signed-in account is linked as the owner).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { handlePublish, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/publish">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  // A signed-in owner becomes the venue's account owner; without a session this is exactly as before.
  const user = await getSessionUser();
  return handlePublish({ store: deps.store, config: deps.config, now: () => new Date() }, guard.venue, { userId: user?.id ?? null, startDeploy: deps.startDeploy });
}
