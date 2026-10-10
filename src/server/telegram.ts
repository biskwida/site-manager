// src/server/telegram.ts
import { webhookCallback, type Bot } from "grammy";

const handlers = new WeakMap<Bot, (req: Request) => Promise<Response>>();

/** Verifies Telegram's secret header, then hands the update to grammY. The bot's handlers only schedule work, so this returns fast. */
export async function handleTelegramRequest(req: Request, deps: { config: { telegramWebhookSecret: string }; bot: Bot }): Promise<Response> {
  const secret = deps.config.telegramWebhookSecret;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) return new Response("unauthorized", { status: 401 });
  let handler = handlers.get(deps.bot);
  if (!handler) {
    handler = webhookCallback(deps.bot, "std/http", { timeoutMilliseconds: 25_000, onTimeout: "return" }) as unknown as (req: Request) => Promise<Response>;
    handlers.set(deps.bot, handler);
  }
  try {
    return await handler(req);
  } catch (e) {
    console.error("[telegram] webhook failed:", e instanceof Error ? e.message : e);
    return new Response("ok", { status: 200 }); // never make Telegram retry
  }
}
