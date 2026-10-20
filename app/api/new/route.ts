// app/api/new/route.ts — creates a wizard draft (rate-limited) and sets the httpOnly draft cookie.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { handleNewDraft } from "@/src/server/wizard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  // A draft started while signed in remembers it (a second cookie), so a publish that finds no session can offer "Log in to save this business".
  const user = await getSessionUser();
  return handleNewDraft(req, { store: deps.store, config: deps.config, now: () => new Date() }, { userId: user?.id ?? null });
}
