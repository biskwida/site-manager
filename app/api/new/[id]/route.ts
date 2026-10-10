// app/api/new/[id]/route.ts — read and autosave the wizard draft (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleGetDraft, handlePutDraft, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleGetDraft({ store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}

export async function PUT(req: Request, ctx: RouteContext<"/api/new/[id]">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handlePutDraft(req, { store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
