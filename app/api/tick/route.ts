// app/api/tick/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleTickRequest } from "@/src/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleTickRequest(req, deps);
}
export const GET = handle;
export const POST = handle;
