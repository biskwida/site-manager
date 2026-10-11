// app/api/new/[id]/invite/route.ts — a fresh owner code and its app links, to connect one more app (draft cookie required, live venues only).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleInvite, requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: RouteContext<"/api/new/[id]/invite">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleInvite({ store: deps.store, config: deps.config, now: () => new Date() }, guard.venue);
}
