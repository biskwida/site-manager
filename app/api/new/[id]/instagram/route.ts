// app/api/new/[id]/instagram/route.ts — the owner's Instagram photos read at sign-in, for picking (draft cookie required).
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleInstagramList } from "@/src/server/instagram";
import { requireDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/new/[id]/instagram">) {
  const { id } = await ctx.params;
  const deps = await getServerDeps((fn) => after(fn));
  const guard = await requireDraft(req, deps, id);
  if (guard instanceof Response) return guard;
  return handleInstagramList({ store: deps.store, config: deps.config, fetch: deps.fetch, now: () => new Date() }, guard.venue);
}
