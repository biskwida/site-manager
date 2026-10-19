// app/api/start/venue/route.ts — creates a live venue for path B (own site) or C (social only) of /start, for the signed-in account.
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleStartVenue } from "@/src/server/onboarding";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleStartVenue(req, { store: deps.store, config: deps.config, now: () => new Date() });
}
