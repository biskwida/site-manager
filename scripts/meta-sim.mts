// scripts/meta-sim.mts
// Posts a signed fake Meta webhook to a local server, so the whole path runs offline against the memory store:
//   npm run dev:offline   (with META_APP_SECRET, META_VERIFY_TOKEN and DEMO_OWNER_CHAT_REF=fb:4242 in .env.local)
//   npm run meta:sim -- fb text "Капучиното става 3,20"      npm run meta:sim -- wa button cs:apply:<id>      npm run meta:sim -- ig text "menu"
// Replies appear in the dev server's terminal as "→ [fb:4242] …" (ConsoleMessenger). Options: --sender <id> (default 4242), --url (default http://localhost:3000/api/meta).
import { createHmac } from "node:crypto";

const [channel, kind, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const opt = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const sender = opt("sender", "4242");
const url = opt("url", "http://localhost:3000/api/meta");
const secret = process.env.META_APP_SECRET?.trim();
if (!secret || !["fb", "ig", "wa"].includes(channel) || !["text", "button"].includes(kind) || rest.length === 0) {
  console.error('Usage: npm run meta:sim -- fb|ig|wa text|button "<text or cs:apply:<id>>" [--sender 4242]  (META_APP_SECRET must be set)');
  process.exit(1);
}
const payload = rest.join(" ");
const mid = `sim-${Date.now()}`;
const body = channel === "wa"
  ? { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1", phone_number_id: "PNID" }, contacts: [{ profile: { name: "Sim" }, wa_id: sender }],
      messages: [kind === "text" ? { from: sender, id: mid, timestamp: "1", type: "text", text: { body: payload } } : { from: sender, id: mid, timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: payload, title: "sim" } } }] } }] }] }
  : { object: channel === "ig" ? "instagram" : "page", entry: [{ id: "PAGE", time: 1, messaging: [kind === "text" ? { sender: { id: sender }, recipient: { id: "PAGE" }, timestamp: 1, message: { mid, text: payload } } : { sender: { id: sender }, recipient: { id: "PAGE" }, timestamp: 1, postback: { mid, title: "sim", payload } }] }] };
const raw = JSON.stringify(body);
const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
console.log(`${res.status} ${await res.text()}  (${channel}:${sender} ${kind} ${mid})`);
