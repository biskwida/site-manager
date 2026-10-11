// app/api/new/[id]/instagram/start/route.ts — sends the owner to Instagram's sign-in with a signed state (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleInstagramStart } from "@/src/server/instagram";
import { requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]/instagram/start">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleInstagramStart(req, { store: deps.store, config: deps.config, fetch: deps.fetch, now: () => new Date() }, guard.venue);
}
