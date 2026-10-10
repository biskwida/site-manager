// scripts/dev-bot.mts
// Long polling for local development. Never run while a webhook is set (Telegram allows one or the other):
//   npm run telegram:set-webhook -- --delete   then   npm run bot:dev
import { makeServerDeps } from "../src/server/deps";

const deps = await makeServerDeps({ defer: (fn) => void fn().catch((e) => console.error("[run]", e instanceof Error ? e.message : e)) });
if (!deps.config.telegramToken) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env.local (npm run env:set -- TELEGRAM_BOT_TOKEN)");
const info = await deps.bot.api.getWebhookInfo();
if (info.url) throw new Error(`A webhook is set (${info.url}). Run: npm run telegram:set-webhook -- --delete`);
console.log(`[bot:dev] polling as @${(await deps.bot.api.getMe()).username}; store=${deps.isMemory ? "memory" : "supabase"}; base=${deps.config.publicBaseUrl}`);
await deps.bot.start({ onStart: () => console.log("[bot:dev] started; Ctrl-C to stop") });
