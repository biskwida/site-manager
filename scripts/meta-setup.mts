// scripts/meta-setup.mts
// npm run meta:setup — checks the Meta tokens, subscribes the Page to this app's webhook fields, sets the Messenger Get Started button, prints the webhook URL and the enabled channels. Never prints a token.
import { GRAPH } from "../src/channels/meta/graph";
import { loadConfig } from "../src/config";

const cfg = loadConfig(process.env);
const get = async (path: string, token: string) => {
  const r = await fetch(`${GRAPH}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(`${path.split("?")[0]} → HTTP ${r.status}: ${(j.error as { message?: string } | undefined)?.message ?? "unknown"}`);
  return j;
};
console.log(`webhook URL to paste into the Meta app (Messenger, Instagram and WhatsApp products): ${cfg.publicBaseUrl}/api/meta`);
console.log(`verify token: set (${cfg.metaVerifyToken ? "yes" : "NO — set META_VERIFY_TOKEN"})`);
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
} else console.log("Messenger/Instagram: disabled (META_PAGE_TOKEN not set)");
if (cfg.whatsappToken && cfg.whatsappPhoneNumberId) {
  const n = await get(`${cfg.whatsappPhoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, cfg.whatsappToken);
  console.log(`WhatsApp: ${n.display_phone_number} (${n.verified_name ?? "test number"}), quality ${n.quality_rating ?? "n/a"}`);
} else console.log("WhatsApp: disabled (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set)");
