// app/api/telegram/route.ts
import { after } from "next/server";
import { getServerDeps } from "@/src/server/deps";
import { handleTelegramRequest } from "@/src/server/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleTelegramRequest(req, deps);
}
