// scripts/set-webhook.mts
// npm run telegram:set-webhook -- https://your-deployment.vercel.app   |   npm run telegram:set-webhook -- --delete
import { Api } from "grammy";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
if (!token || !secret) throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_WEBHOOK_SECRET in .env.local");
const api = new Api(token);
const arg = process.argv[2]?.trim();
if (arg === "--delete") {
  await api.deleteWebhook({ drop_pending_updates: true });
  console.log("webhook deleted; bot:dev (long polling) can run now");
} else {
  const base = (arg || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("Give the https deployment URL: npm run telegram:set-webhook -- https://<deployment>");
  await api.setWebhook(`${base}/api/telegram`, { secret_token: secret, drop_pending_updates: true, allowed_updates: ["message", "callback_query"] });
  console.log(`webhook set to ${base}/api/telegram`);
}
const info = await api.getWebhookInfo();
console.log(`url=${info.url || "(none)"} pending=${info.pending_update_count}${info.last_error_message ? ` last_error=${info.last_error_message}` : ""}`);
