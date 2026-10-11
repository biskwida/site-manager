// app/api/new/route.ts — creates a wizard draft (rate-limited) and sets the httpOnly draft cookie.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleNewDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleNewDraft(req, { store: deps.store, config: deps.config, now: () => new Date() });
}
