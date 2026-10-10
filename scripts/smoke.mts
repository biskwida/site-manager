// scripts/smoke.mts
// One real agent turn (real Anthropic call) without the phone.
//   npm run smoke -- --dry [--text "…"]                  memory store with the demo venue, owner chat 1 (bg), console messenger
//   npm run smoke -- --chat <telegram chat id> [--text "…"]  Supabase store + Telegram: the preview really arrives on that phone
// --chat must belong to a linked member (/start <code> first). Exit 0 unless the turn returned "error".
import { pickEffort, runTurn } from "../src/agent/run";
import { makeRef } from "../src/channels/ref";
import { TelegramMessenger, type Messenger } from "../src/bot/messenger";
import { loadConfig } from "../src/config";
import { seedDemo } from "../src/seed/demo";
import { makeServerDeps } from "../src/server/deps";
import { InMemoryStore } from "../src/store/memory";
import type { Store } from "../src/store/types";
import type { Member } from "../src/domain/types";

const USAGE = 'Usage: npm run smoke -- --dry [--text "…"]   or   npm run smoke -- --chat <telegram chat id> [--text "…"]';
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? "") : undefined;
};
const dry = argv.includes("--dry");
const text = flag("text") || "Капучиното става 3,20";

class ConsoleMessenger implements Messenger {
  private next = 1;
  async send(chatRef: string, t: string) {
    console.log(`→ [${chatRef}] ${t}`);
    return String(this.next++);
  }
  async sendProposal(chatRef: string, t: string) {
    console.log(`→ [${chatRef}] ${t}\n   [✅ Приложи] [✏️ Промени] [❌ Откажи]`);
    return String(this.next++);
  }
  async edit(chatRef: string, messageRef: string, t: string) {
    console.log(`✎ [${chatRef}#${messageRef}] ${t}`);
  }
}

let store: Store;
let messenger: Messenger;
let member: Member;
let baseUrl: string;
let cfg: { model: string; effort: "low" | "medium" | "high"; apiKey: string };

if (dry) {
  const config = loadConfig(process.env, { lenient: true });
  if (!config.anthropicApiKey) {
    console.error("Missing ANTHROPIC_API_KEY in .env.local (npm run env:set -- ANTHROPIC_API_KEY)");
    process.exit(1);
  }
  const mem = new InMemoryStore();
  const { venue } = await seedDemo(mem, config.demoVenueSlug);
  member = await mem.upsertMember({ venue_id: venue.id, chat_ref: "tg:1", role: "owner", lang: "bg" });
  store = mem;
  messenger = new ConsoleMessenger();
  baseUrl = config.publicBaseUrl || "http://localhost:3000";
  cfg = { model: config.agentModel, effort: config.agentEffort, apiKey: config.anthropicApiKey };
  console.log(`mode: dry (memory store, demo venue "${venue.slug}", owner chat 1, console messenger)`);
} else {
  const chat = Number(flag("chat"));
  if (!Number.isInteger(chat) || chat === 0) {
    console.error(`--chat <telegram chat id> of a linked member is required without --dry\n${USAGE}`);
    process.exit(1);
  }
  const deps = await makeServerDeps({ defer: (fn) => void fn() });
  const found = await deps.store.findMember(makeRef("tg", chat));
  if (!found) {
    console.error(`chat ${chat} is not linked to any venue; send /start <code> to the bot from that phone first`);
    process.exit(1);
  }
  member = found;
  store = deps.store;
  messenger = new TelegramMessenger(deps.bot.api);
  baseUrl = deps.config.publicBaseUrl;
  cfg = { model: deps.config.agentModel, effort: deps.config.agentEffort, apiKey: deps.config.anthropicApiKey };
  console.log(`mode: live (${deps.isMemory ? "memory" : "Supabase"} store, chat ${chat}, Telegram messenger)`);
}

const effective = pickEffort(cfg.effort, { hasImage: false, text });
console.log(`model: ${cfg.model}; effort: ${cfg.effort} (this turn: ${effective})`);
console.log(`owner says: ${text}\n`);
const started = Date.now();
const result = await runTurn(
  { store, venueId: member.venue_id, chatRef: member.chat_ref, member, messenger, now: () => new Date(), baseUrl },
  { text, source: "text" },
  { model: cfg.model, effort: cfg.effort, apiKey: cfg.apiKey },
);
console.log(`\nfinal reply (${((Date.now() - started) / 1000).toFixed(1)} s): ${result || "(empty)"}`);
const pending = await store.findProposed(member.venue_id, member.chat_ref);
if (pending) {
  console.log(`pending proposal: ${pending.summary_bg} / ${pending.summary_en} (${pending.changes.length} change${pending.changes.length === 1 ? "" : "s"}: ${pending.changes.map((c) => c.op).join(", ")})`);
} else {
  const last = (await store.listChangeSets(member.venue_id, { limit: 1 }))[0];
  console.log(`pending proposal: none${last ? ` (latest set: ${last.status}: ${last.summary_en})` : ""}`);
}
process.exit(result === "error" ? 1 : 0);
