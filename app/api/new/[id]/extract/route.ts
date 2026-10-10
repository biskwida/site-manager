// app/api/new/[id]/extract/route.ts — read a menu from photos/PDF with Claude for the owner to review (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { requireDraft } from "@/src/server/wizard";
import { handleExtract } from "@/src/server/wizard-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/extract">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleExtract(req, { store: deps.store, anthropic: deps.anthropic, model: deps.config.agentModel }, guard.venue);
}
