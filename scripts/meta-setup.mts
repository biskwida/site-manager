// scripts/meta-setup.mts
// npm run meta:setup — checks the Meta tokens, registers this app's webhook (WhatsApp, Messenger, Instagram objects and fields),
// subscribes the Page and the WhatsApp Business Account to the app, sets the Messenger Get Started button, prints the enabled channels.
// Never prints a token. Without the webhook objects and the WABA subscription Meta delivers nothing (found in the 2026-10-11 live test).
import { GRAPH } from "../src/channels/meta/graph";
import { loadConfig } from "../src/config";

const cfg = loadConfig(process.env);
const get = async (path: string, token: string) => {
  const r = await fetch(`${GRAPH}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path.split("?")[0]} → HTTP ${r.status}: ${(j.error as { message?: string } | undefined)?.message ?? "unknown"}`);
  return j;
};
const callback = `${cfg.publicBaseUrl}/api/meta`;
console.log(`webhook URL: ${callback}`);
console.log(`verify token: set (${cfg.metaVerifyToken ? "yes" : "NO — set META_VERIFY_TOKEN"})`);
const anyToken = cfg.metaPageToken ?? cfg.whatsappToken;
// The app's webhook: one subscription per object. Meta verifies the callback with a GET right away, so the deployment must be reachable.
async function subscribeApp(object: string, fields: string[]) {
  if (!anyToken || !cfg.metaAppSecret || !cfg.metaVerifyToken) return;
  const app = await get("app?fields=id", anyToken);
  const body = new URLSearchParams({ object, callback_url: callback, verify_token: cfg.metaVerifyToken, fields: fields.join(",") });
  const r = await fetch(`${GRAPH}/${app.id}/subscriptions`, { method: "POST", headers: { authorization: `Bearer ${app.id}|${cfg.metaAppSecret}` }, body });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
  console.log(`webhook ${object} (${fields.join(", ")}) → ${j.success ? "ok" : `HTTP ${r.status}: ${j.error?.message ?? "unknown"}`}`);
}
if (cfg.metaPageToken) {
  const me = await get("me?fields=id,name,instagram_business_account{id,username}", cfg.metaPageToken);
  console.log(`Messenger: Page "${me.name}" (${me.id})`);
  const sub = await fetch(`${GRAPH}/${me.id}/subscribed_apps`, { method: "POST", headers: { authorization: `Bearer ${cfg.metaPageToken}`, "content-type": "application/json" }, body: JSON.stringify({ subscribed_fields: ["messages", "messaging_postbacks", "messaging_referrals"] }) });
  console.log(`Messenger: page subscribed to the app webhook → HTTP ${sub.status}`);
  // A Get Started button makes Messenger deliver the m.me ?ref= code as a postback referral on the first contact.
  const profile = await fetch(`${GRAPH}/me/messenger_profile`, { method: "POST", headers: { authorization: `Bearer ${cfg.metaPageToken}`, "content-type": "application/json" }, body: JSON.stringify({ get_started: { payload: "GET_STARTED" } }) });
  console.log(`Messenger: Get Started button set → HTTP ${profile.status}`);
  const ig = me.instagram_business_account as { id: string; username: string } | undefined;
  console.log(ig ? `Instagram: @${ig.username} (${ig.id}) linked to the Page` : "Instagram: no professional account linked to this Page (link it in Page settings → Linked accounts)");
  await subscribeApp("page", ["messages", "messaging_postbacks", "messaging_referrals"]);
  await subscribeApp("instagram", ["messages", "messaging_postbacks", "messaging_referral"]);
} else console.log("Messenger/Instagram: disabled (META_PAGE_TOKEN not set)");
if (cfg.whatsappToken && cfg.whatsappPhoneNumberId) {
  const n = await get(`${cfg.whatsappPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, cfg.whatsappToken);
  console.log(`WhatsApp: ${n.display_phone_number} (${n.verified_name ?? "test number"}), quality ${n.quality_rating ?? "n/a"}`);
  await subscribeApp("whatsapp_business_account", ["messages"]);
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  if (waba) {
    const r = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: "POST", headers: { authorization: `Bearer ${cfg.whatsappToken}` } });
    console.log(`WhatsApp: business account subscribed to the app → HTTP ${r.status}`);
  } else console.log("WhatsApp: WHATSAPP_BUSINESS_ACCOUNT_ID not set — the account will not deliver messages to this app until it is subscribed (set it and rerun)");
} else console.log("WhatsApp: disabled (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set)");
