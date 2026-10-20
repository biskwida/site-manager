// app/api/tick/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { getSessionUser } from "@/src/server/session";
import { handleTickRequest } from "@/src/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleTickRequest(req, { ...deps, sessionUser: getSessionUser });
}
export const GET = handle;
export const POST = handle;
