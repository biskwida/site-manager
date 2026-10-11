// app/api/meta/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleMetaRequest } from "@/src/server/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleMetaRequest(req, { config: deps.config, botDeps: deps.botDeps, handleRun: deps.handleRun, defer: (fn) => after(fn), waDownload: deps.waDownload, fetchUrl: deps.fetchUrl });
}
export const GET = handle;
export const POST = handle;
