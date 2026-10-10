// scripts/e2e-offline.mts
// npm run e2e  — the demo flow offline (memory store, no network, no keys):
// proposal → approve → applied; instant sold-out; specials; schedule; undo; bulk via the dashboard; tick; a Messenger owner via handleInbound + ChannelRouter. Exit 1 on any mismatch.
import { makeTools } from "../src/agent/tools";
import { handleDecision } from "../src/bot/approvals";
import { handleInbound } from "../src/bot/inbound";
import { ConsoleMessenger } from "../src/channels/console";
import { ChannelRouter } from "../src/channels/router";
import { seedDemo } from "../src/seed/demo";
import { adminAction, adminOverview } from "../src/server/admin";
import { InMemoryStore } from "../src/store/memory";
import { runTick } from "../src/tick";

const store = new InMemoryStore();
const { venue, items } = await seedDemo(store);
await store.upsertMember({ venue_id: venue.id, chat_ref: "tg:1", role: "owner", lang: "bg" });
const member = (await store.findMember("tg:1"))!;
const messenger = new ConsoleMessenger();
let now = new Date("2026-10-09T09:00:00.000Z"); // Friday 12:00 in Sofia
const clock = () => now;
const tools = makeTools({ store, venueId: venue.id, chatRef: "tg:1", member, messenger, now: clock, baseUrl: "http://localhost:3000" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (name: string, input: unknown): Promise<any> => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  const out = JSON.parse(await (t.run as (i: unknown) => Promise<string>)(t.parse(input)));
  if (out.error) console.log(`   tool ${name} error: ${out.error}`);
  return out;
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error(`FAIL ${msg}`);
    process.exit(1);
  }
  console.log(`PASS ${msg}`);
};
const decide = (setId: string) => handleDecision({ store, messenger, now: clock }, "tg:1", "apply", setId);
const price = async (id: string) => (await store.getSite(venue.id)).items.find((i) => i.id === id)!.price_eur;
const cap = items.find((i) => i.name_en === "Cappuccino")!;
const ban = items.find((i) => i.name_en === "Cheese banitsa")!;

console.log("\n1. „Капучиното става 3,20“");
const p = await call("propose_changes", { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: cap.id, price_eur: 3.2 }] });
assert(p.status === "proposed" && (await price(cap.id)) === 2.9, "proposal sent, nothing applied yet");
await decide(p.change_set_id);
assert((await price(cap.id)) === 3.2, "✅ applies the price");

console.log("\n2. „Баницата свърши“");
const so = await call("propose_changes", { summary_bg: "Баницата свърши", summary_en: "Banitsa sold out", changes: [{ op: "set_sold_out", item_id: ban.id, until: "next_opening" }] });
assert(so.status === "applied" && so.sold_out_until === "2026-10-10T06:00:00.000Z", "sold out instantly until tomorrow 09:00 (Saturday opening)");

console.log("\n3. Снимка на дъската → специални предложения");
const sp = await call("propose_changes", {
  summary_bg: "Днешни предложения", summary_en: "Today's specials",
  changes: [{ op: "add_item", item: { category_id: items[0].category_id, name_bg: "Супа топчета", name_en: "Meatball soup", desc_bg: "", desc_en: "", price_eur: 4.5, allergens: [1, 3], is_special: true, special_expires_at: "closing_today" } }],
});
await decide(sp.change_set_id);
assert((await store.getSite(venue.id)).items.some((i) => i.is_special && i.name_bg === "Супа топчета" && i.special_expires_at === "2026-10-09T15:00:00.000Z"), "special on the menu until closing (18:00)");

console.log("\n4. „Затворени сме на 24 и 25 декември“ (scheduled)");
const sc = await call("schedule_changes", {
  summary_bg: "Коледни почивни дни", summary_en: "Christmas closure", apply_at: "2026-12-20T08:00:00+02:00",
  changes: [{ op: "add_holiday", date: "2026-12-24", note_bg: "Бъдни вечер", note_en: "Christmas Eve" }, { op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }],
});
await decide(sc.change_set_id);
assert((await store.getChangeSet(sc.change_set_id)).status === "scheduled", "approved → scheduled");

console.log("\n5. „Върни цената на капучиното“");
const u = await call("undo", { change_set_id: p.change_set_id });
await decide(u.change_set_id);
assert((await price(cap.id)) === 2.9 && (await store.getChangeSet(p.change_set_id)).status === "reverted", "undo reverts and marks the original");

console.log("\n6. Bulk: „Вдигни всички кафета с 10%“");
const coffee = (await store.getSite(venue.id)).categories[0];
const b = await call("propose_bulk_price_change", { category_id: coffee.id, percent: 10, rounding: "0.10" });
assert(Array.isArray(b.rows) && b.rows.length === 4, "table preview with 4 rows");
const dash = await adminAction({ store, messenger, now: clock, baseUrl: "http://x" }, venue, "apply", b.change_set_id);
assert(dash.ok && (await price(cap.id)) === 3.2, "dashboard approval applies the bulk change (2,90 → 3,19 → 3,20)");

console.log("\n7. Next morning: the tick writes the auto sets; later it applies the scheduled set on time");
now = new Date("2026-10-10T06:30:00.000Z");
const t1 = await runTick({ store, messenger, now });
assert(t1.auto.length === 2, "banitsa back in stock + special expired, logged as auto sets");
now = new Date("2026-12-20T06:30:00.000Z");
const t2 = await runTick({ store, messenger, now });
assert(t2.applied.includes(sc.change_set_id) && (await store.getSite(venue.id)).holidays.length === 2, "scheduled holidays applied on time");

console.log("\n8. Messenger owner: bare-code link, apply tap, the 24 h rule");
// Meta leg: a Messenger owner links with a bare code, proposes, taps apply; a proactive reminder is skipped after 25 h of silence.
const fbLog: string[] = [];
const router = new ChannelRouter({ store, now: clock, adapters: { fb: new ConsoleMessenger((l) => fbLog.push(l)) } });
const botDeps = { token: "t", store, messenger: router, baseUrl: "http://localhost:3000", now: clock, startRun: () => undefined, transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
const code = await store.createInvite(venue.id, "owner", new Date(clock().getTime() + 86_400_000).toISOString());
await handleInbound(botDeps, { chatRef: "fb:4242", kind: "text", text: code });
assert(fbLog.at(-1)?.includes("Свързахте се като собственик") === true, "fb owner linked with a bare code");
const metaCs = await store.createChangeSet({ venue_id: venue.id, chat_ref: "fb:4242", summary_bg: "Чай 2,20 €", summary_en: "Tea €2.20", preview_bg: "• Чай: 2,00 € → 2,20 €", preview_en: "• Tea", source: "text", status: "proposed", changes: [] });
await handleInbound(botDeps, { chatRef: "fb:4242", kind: "button", text: `cs:apply:${metaCs.id}` });
assert((await store.getChangeSet(metaCs.id)).status === "applied" && fbLog.at(-1)?.includes("✅ Приложено") === true, "fb apply tap concluded");
assert((await router.send("fb:4242", "reminder", { proactive: true })) !== null, "proactive inside the window is sent");
await store.touchMember("fb:4242", new Date(clock().getTime() - 25 * 3_600_000).toISOString());
assert((await router.send("fb:4242", "reminder", { proactive: true })) === null, "proactive after 25 h is skipped");

const o = await adminOverview(store, venue, now, "http://x");
console.log(`\nlog: ${o.log.map((s) => `${s.status}:${s.summary_en}`).join(" | ")}`);
console.log("\nOFFLINE E2E OK");
