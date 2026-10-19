// app/api/new/[id]/randevue/route.ts — read a menu from a randevue.app page for the owner to review (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { requireDraft } from "@/src/server/wizard";
import { handleRandevue } from "@/src/server/wizard-randevue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/randevue">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleRandevue(req, { store: deps.store, fetch: deps.fetch, now: () => new Date() }, guard.venue);
}
