// app/api/new/[id]/texts/route.ts — "Write for me": tagline, about, welcome and footer note in BG and EN (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { requireDraft } from "@/src/server/wizard";
import { handleTexts } from "@/src/server/wizard-ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/texts">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleTexts(req, { store: deps.store, anthropic: deps.anthropic, model: deps.config.agentModel }, guard.venue);
}
