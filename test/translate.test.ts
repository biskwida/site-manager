// test/translate.test.ts — Claudia's fixed texts in a conversation language other than Bulgarian or English: the translator (one
// small-model call per text, kept parts as numbered markers, the cache) and withTranslation, the messenger every owner text goes through.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { proposalText } from "@/src/agent/tools";
import type { BotDeps } from "@/src/bot/bot";
import { handleInbound } from "@/src/bot/inbound";
import type { Messenger, ProposalLabels, SendOpts } from "@/src/bot/messenger";
import { makeTranslator, withTranslation, type Translator } from "@/src/bot/translate";
import { commentProposalText, type CommentSetItem } from "@/src/social/comments-propose";
import { planChanges } from "@/src/domain/changes";
import { renderPreview } from "@/src/domain/preview";
import type { Change, Lang, Member } from "@/src/domain/types";
import { sha256Hex } from "@/src/server/hash";
import { InMemoryStore } from "@/src/store/memory";
import type { SocialComment, Store } from "@/src/store/types";
import { makeDemo } from "./helpers";
import { state, TZ } from "./fixtures";

const NOW = "2026-10-16T09:00:00.000Z";

type Call =
  | { method: "send"; chatRef: string; text: string; opts?: SendOpts }
  | { method: "sendProposal"; chatRef: string; text: string; setId: string; lang: Lang; labels?: ProposalLabels }
  | { method: "sendPhoto"; chatRef: string; url: string; caption?: string }
  | { method: "conclude"; chatRef: string; messageRef: string | null; full: string; short: string; opts?: SendOpts }
  | { method: "typing"; chatRef: string; inReplyTo?: string }
  | { method: "edit"; chatRef: string; messageRef: string; text: string }
  | { method: "remove"; chatRef: string; messageRef: string };

/** The channel side: records every call exactly as the wrapper made it (markers and all). `editable: false` = a channel without edit/remove. */
function recorder(o: { editable?: boolean } = {}) {
  const calls: Call[] = [];
  const m: Messenger = {
    send: async (chatRef, text, opts) => (calls.push({ method: "send", chatRef, text, opts }), "m1"),
    sendProposal: async (chatRef, text, setId, lang, labels) => (calls.push({ method: "sendProposal", chatRef, text, setId, lang, labels }), "m2"),
    sendPhoto: async (chatRef, url, caption) => (calls.push({ method: "sendPhoto", chatRef, url, caption }), "m3"),
    conclude: async (chatRef, messageRef, full, short, opts) => void calls.push({ method: "conclude", chatRef, messageRef, full, short, opts }),
    typing: async (chatRef, inReplyTo) => void calls.push({ method: "typing", chatRef, inReplyTo }),
    ...(o.editable === false
      ? {}
      : {
          edit: async (chatRef: string, messageRef: string, text: string) => void calls.push({ method: "edit", chatRef, messageRef, text }),
          remove: async (chatRef: string, messageRef: string) => void calls.push({ method: "remove", chatRef, messageRef }),
        }),
  };
  return { m, calls };
}

/** The wrapper's member lookup (it reads findMember only), by chat ref; counts the lookups. */
function members(langs: Record<string, string>) {
  const looked: string[] = [];
  const store: Pick<Store, "findMember"> = {
    findMember: async (chatRef) => {
      looked.push(chatRef);
      const lang = langs[chatRef];
      return lang ? ({ venue_id: "v1", chat_ref: chatRef, role: "owner", lang, last_seen_at: null, created_at: NOW } satisfies Member) : null;
    },
  };
  return { store, looked };
}

/** A translator that records what it was asked and answers with fn. */
function fakeTranslate(fn: (text: string) => string) {
  const asked: { text: string; to: string }[] = [];
  const translate: Translator = async (text, to) => {
    asked.push({ text, to });
    return fn(text);
  };
  return { translate, asked };
}

/** "German" for the tests: a few fixed words replaced, everything else (markers included) left as it is. */
const GERMAN: [RegExp, string][] = [
  [/Apply this\?/g, "Anwenden?"], [/Apply/g, "Anwenden"], [/Change/g, "Ändern"], [/Cancel/g, "Abbrechen"], [/Price/g, "Preis"],
  [/New comment under the post/g, "Neuer Kommentar unter dem Beitrag"], [/Suggested reply/g, "Vorgeschlagene Antwort"], [/Reply\?/g, "Antworten?"],
  [/\bby\b/g, "von"], [/Post\b/g, "Beitrag"], [/stories are published without text/g, "Storys erscheinen ohne Text"],
  [/Working on it…/g, "Ich arbeite daran…"], [/Reading the menu…/g, "Ich lese die Speisekarte…"], [/Applied/g, "Angewendet"], [/Expired/g, "Abgelaufen"],
  [/You are already linked to/g, "Schon verbunden mit"], [/QR code and dashboard/g, "QR-Code und Übersicht"], [/Dashboard/g, "Übersicht"], [/Site:/g, "Seite:"], [/Menu:/g, "Speisekarte:"],
  [/You are linked as the owner of/g, "Du bist Inhaber von"],
];
const german = (t: string) => GERMAN.reduce((s, [re, to]) => s.replace(re, to), t);

type Reply = { stop_reason: string; content: unknown[] } | Error | ((text: string) => string);
/** A fake Anthropic client: records the request params and options; answers with the scripted message, throws, or "translates" the user text with fn. */
function fakeClient(reply: Reply) {
  const calls: Record<string, unknown>[] = [];
  const options: unknown[] = [];
  const create = async (params: Record<string, unknown>, opts?: unknown) => {
    calls.push(params);
    options.push(opts);
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") {
      const text = ((params.messages as { content: { text: string }[] }[])[0].content[0]).text;
      return { stop_reason: "end_turn", content: [{ type: "text", text: reply(text) }] };
    }
    return reply;
  };
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, calls, options };
}
/** The user text of a recorded request. */
const asked = (call: Record<string, unknown>) => (call.messages as { content: { text: string }[] }[])[0].content[0].text;
const answer = (text: string, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text }] });

/** Runs fn with console.error captured; returns what was logged. */
async function logged(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return lines.join("\n");
}

describe("withTranslation", () => {
  it("a German member gets translated text with kept parts unchanged", async () => {
    const { translate, asked: q } = fakeTranslate((t) => (t === "Price ⟦Cappuccino⟧ → €4.20" ? "Preis ⟦Cappuccino⟧ → €4.20" : t));
    const r = recorder();
    await withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate }).send("tg:1", "Price ⟦Cappuccino⟧ → €4.20");
    expect(q).toEqual([{ text: "Price ⟦Cappuccino⟧ → €4.20", to: "de" }]);
    expect(r.calls).toEqual([{ method: "send", chatRef: "tg:1", text: "Preis Cappuccino → €4.20" }]);
  });

  it("a Bulgarian member gets the text untouched, markers removed (an English member too): no translation", async () => {
    const { translate, asked: q } = fakeTranslate((t) => `XX ${t}`);
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "bg", "tg:2": "en" }).store, translate });
    await m.send("tg:1", "Цена ⟦Капучино⟧ → 4,20 €", { proactive: true });
    await m.sendProposal("tg:2", "• ⟦Cappuccino⟧: €2.90 → €3.20\n\nApply this?", "set-1", "en");
    expect(q).toEqual([]);
    expect(r.calls).toEqual([
      { method: "send", chatRef: "tg:1", text: "Цена Капучино → 4,20 €", opts: { proactive: true } },
      { method: "sendProposal", chatRef: "tg:2", text: "• Cappuccino: €2.90 → €3.20\n\nApply this?", setId: "set-1", lang: "en" },
    ]);
  });

  it("verbatim replies are not translated: the agent wrote them in the owner's language; a marker it echoed is removed", async () => {
    const { translate, asked: q } = fakeTranslate((t) => `XX ${t}`);
    const look = members({ "tg:1": "de" });
    const r = recorder();
    await withTranslation(r.m, { store: look.store, translate }).send("tg:1", "Ich habe ⟦Cappuccino⟧ auf 3,20 € gesetzt.", { verbatim: true });
    expect(q).toEqual([]);
    expect(look.looked).toEqual([]);
    expect(r.calls).toEqual([{ method: "send", chatRef: "tg:1", text: "Ich habe Cappuccino auf 3,20 € gesetzt.", opts: { verbatim: true } }]);
  });

  it("the cache answers the second time without the model, also around another name", async () => {
    const store = new InMemoryStore();
    const { client, calls } = fakeClient(german);
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: makeTranslator(client, "claude-haiku-5-5", store) });
    await m.send("tg:1", "Price ⟦Cappuccino⟧ → €4.20");
    await m.send("tg:1", "Price ⟦Cappuccino⟧ → €4.20");
    await m.send("tg:1", "Price ⟦Flat white⟧ → €4.20"); // the same fixed text around another name
    expect(calls).toHaveLength(1);
    expect(r.calls.map((c) => (c.method === "send" ? c.text : ""))).toEqual(["Preis Cappuccino → €4.20", "Preis Cappuccino → €4.20", "Preis Flat white → €4.20"]);
    expect(await store.getTranslation("de", sha256Hex("Price ⟦1⟧ → €4.20"))).toBe("Preis ⟦1⟧ → €4.20");
  });

  it("a failing model sends the English text, caches nothing and logs no words", async () => {
    const store = new InMemoryStore();
    const { client } = fakeClient(new Anthropic.APIConnectionTimeoutError());
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: makeTranslator(client, "m", store) });
    const log = await logged(() => m.send("tg:1", "Price ⟦Cappuccino⟧ → €4.20"));
    expect(r.calls).toEqual([{ method: "send", chatRef: "tg:1", text: "Price Cappuccino → €4.20" }]);
    expect(await store.getTranslation("de", sha256Hex("Price ⟦1⟧ → €4.20"))).toBeNull();
    expect(log).toMatch(/\[translate\].*APIConnectionTimeoutError/);
    expect(log).not.toMatch(/Price|Cappuccino/);
  });

  it("proposal buttons are translated for a German member", async () => {
    const { translate } = fakeTranslate(german);
    const r = recorder();
    await withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate }).sendProposal("tg:1", "• ⟦Cappuccino⟧: €2.90 → €3.20\n\nApply this?", "set-1", "en");
    expect(r.calls).toEqual([
      { method: "sendProposal", chatRef: "tg:1", text: "• Cappuccino: €2.90 → €3.20\n\nAnwenden?", setId: "set-1", lang: "en", labels: { apply: "✅ Anwenden", change: "✏️ Ändern", cancel: "❌ Abbrechen" } },
    ]);
  });

  it("a translated button label over 20 characters (Meta's limit) keeps its English label; the others are translated", async () => {
    const { translate } = fakeTranslate((t) => german(t).replace("✏️ Ändern", "✏️ Vorschlag bearbeiten"));
    const r = recorder();
    await withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate }).sendProposal("tg:1", "Apply this?", "set-1", "en");
    expect(r.calls[0]).toMatchObject({ labels: { apply: "✅ Anwenden", change: "✏️ Change", cancel: "❌ Abbrechen" } });
  });

  it("button labels whose translation lost a line keep the English labels", async () => {
    const { translate } = fakeTranslate((t) => (t.includes("\n✏️") ? "✅ Anwenden\n❌ Abbrechen" : german(t)));
    const r = recorder();
    await withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate }).sendProposal("tg:1", "Apply this?", "set-1", "en");
    expect(r.calls[0]).toMatchObject({ text: "Anwenden?", labels: undefined });
  });

  it("an unknown chat or a failed member lookup: markers removed, nothing translated, the failure logged without the text", async () => {
    const { translate, asked: q } = fakeTranslate((t) => `XX ${t}`);
    const r = recorder();
    await withTranslation(r.m, { store: members({}).store, translate }).send("fb:9", "Price ⟦Cappuccino⟧");
    const failing: Pick<Store, "findMember"> = { findMember: async () => { throw new Error("db down: Price"); } };
    const log = await logged(() => withTranslation(r.m, { store: failing, translate }).send("tg:1", "Price ⟦Cappuccino⟧ → €4.20"));
    expect(q).toEqual([]);
    expect(r.calls.map((c) => (c.method === "send" ? c.text : ""))).toEqual(["Price Cappuccino", "Price Cappuccino → €4.20"]);
    expect(log).toMatch(/\[translate\] member lookup failed/);
    expect(log).not.toMatch(/Cappuccino|Price/);
  });

  it("photo captions, both texts of a conclusion and status edits are translated; typing and remove pass through", async () => {
    const { translate } = fakeTranslate(german);
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate });
    await m.sendPhoto("tg:1", "https://cdn.example/p.jpg", "Post");
    await m.sendPhoto("tg:1", "https://cdn.example/q.jpg");
    await m.conclude("tg:1", "42", "• ⟦Cappuccino⟧: €2.90 → €3.20\n\n✅ Applied", "✅ Applied", { proactive: true });
    await m.typing("tg:1", "in-1");
    await m.edit?.("tg:1", "7", "📖 Reading the menu…");
    await m.remove?.("tg:1", "7");
    expect(r.calls).toEqual([
      { method: "sendPhoto", chatRef: "tg:1", url: "https://cdn.example/p.jpg", caption: "Beitrag" },
      { method: "sendPhoto", chatRef: "tg:1", url: "https://cdn.example/q.jpg" },
      { method: "conclude", chatRef: "tg:1", messageRef: "42", full: "• Cappuccino: €2.90 → €3.20\n\n✅ Angewendet", short: "✅ Angewendet", opts: { proactive: true } },
      { method: "typing", chatRef: "tg:1", inReplyTo: "in-1" },
      { method: "edit", chatRef: "tg:1", messageRef: "7", text: "📖 Ich lese die Speisekarte…" },
      { method: "remove", chatRef: "tg:1", messageRef: "7" },
    ]);
  });

  it("a channel without edit or remove (Meta) gives the wrapper none either", () => {
    const m = withTranslation(recorder({ editable: false }).m, { store: members({}).store, translate: null });
    expect(m.edit).toBeUndefined();
    expect(m.remove).toBeUndefined();
  });

  it("a translator that throws never costs the message: the English text goes out", async () => {
    const translate: Translator = async () => { throw new Error("boom"); };
    const r = recorder();
    const log = await logged(() => withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate }).send("tg:1", "Price ⟦Cappuccino⟧"));
    expect(r.calls).toEqual([{ method: "send", chatRef: "tg:1", text: "Price Cappuccino" }]);
    expect(log).toMatch(/\[translate\]/);
  });

  it("without a translation model (no API key) other languages get the English text without markers", async () => {
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: null });
    await m.sendProposal("tg:1", "• ⟦Cappuccino⟧: €2.90 → €3.20\n\nApply this?", "set-1", "en");
    expect(r.calls).toEqual([{ method: "sendProposal", chatRef: "tg:1", text: "• Cappuccino: €2.90 → €3.20\n\nApply this?", setId: "set-1", lang: "en" }]);
  });

  it("a German owner gets the proposal in German, the dish name and the caption exactly as written (Review Focus 3)", async () => {
    const { store, venue, items } = await makeDemo();
    const site = await store.getSite(venue.id);
    const { client, calls } = fakeClient(german);
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: makeTranslator(client, "m", store) });
    const caption = "Post of the day: our Cappuccino ☕\nApply for the loyalty card! #coffee";
    const price: Change = { position: 0, op: "set_price", entity: "item", entity_id: items.Cappuccino.id, before: { price_eur: 2.9 }, after: { price_eur: 3.2 } };
    const post: Change = { position: 0, op: "social_post", entity: "social_post", entity_id: "m1", before: null, after: { media_id: "m1", image_url: "https://cdn.example/m1.jpg", caption, targets: ["instagram_post", "instagram_story"] } };
    await m.sendProposal("tg:1", proposalText(renderPreview(site, [price], "en", TZ), "en", null, TZ), "set-1", "en");
    await m.sendProposal("tg:1", proposalText(renderPreview(site, [post], "en", TZ), "en", null, TZ), "set-2", "en");
    const sent = r.calls.map((c) => (c.method === "sendProposal" ? c.text : ""));
    expect(sent[0]).toBe("• Cappuccino: €2.90 → €3.20\n\nAnwenden?");
    expect(sent[1]).toBe("• Beitrag: Instagram (post, story)\n  “Post of the day: our Cappuccino ☕\n  Apply for the loyalty card! #coffee”\n  (Storys erscheinen ohne Text)\n\nAnwenden?");
    // The model never saw the dish name or the caption: they travel as numbered markers.
    expect(calls.map(asked).join("\n")).not.toMatch(/Cappuccino|loyalty/);
  });

  it("a German owner's new dish: one version of the dish, as written, and the note that the Bulgarian version was written, translated", async () => {
    const store = new InMemoryStore();
    const site = state();
    const dish = { category_id: "c-coffee", name_bg: "Сладкиш със сирене", name_en: "Käsekuchen", desc_bg: "С извара", desc_en: "Mit Quark", price_eur: 4.2, allergens: [], is_special: false, special_expires_at: null };
    const changes = planChanges(site, [{ op: "add_item", item: dish }], { newId: () => "new-1", now: NOW });
    const { client, calls } = fakeClient((t) => t.replace("the Bulgarian version for the site was written automatically", "die bulgarische Version für die Website wurde automatisch erstellt").replace("Apply this?", "Anwenden?"));
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: makeTranslator(client, "m", store) });
    await m.sendProposal("tg:1", proposalText(renderPreview(site, changes, "en", TZ), "en", null, TZ), "set-1", "en");
    expect(r.calls[0]).toMatchObject({ text: "• New in “Coffee”: Käsekuchen — €4.20\n  EN: Mit Quark\n  Allergens: none\n(die bulgarische Version für die Website wurde automatisch erstellt)\n\nAnwenden?" });
    // Neither Bulgarian text is shown, and the model never saw the dish or its description.
    expect(r.calls[0]).not.toMatchObject({ text: expect.stringMatching(/\p{Script=Cyrillic}/u) });
    expect(calls.map(asked).join("\n")).not.toMatch(/Käsekuchen|Quark/);
  });

  it("a German owner's comment proposal: the customer's words, name and the drafted reply arrive exactly as written", async () => {
    const store = new InMemoryStore();
    const { client, calls } = fakeClient(german);
    const r = recorder();
    const m = withTranslation(r.m, { store: members({ "tg:1": "de" }).store, translate: makeTranslator(client, "m", store) });
    const comment = { id: "c1", network: "instagram", post_ref: "p1", post_caption: "Apply for our card", author_name: "Maria", text: "Do you have oat milk? Apply it to the Price list!" } as SocialComment;
    const items: CommentSetItem[] = [{ comment, reply_text: "Yes, we do! Cancel nothing, come by.", moderate: null }];
    await m.sendProposal("tg:1", commentProposalText(items, "en"), "set-1", "en");
    expect(r.calls[0]).toMatchObject({
      text: "💬 Neuer Kommentar unter dem Beitrag “Apply for our card” (Instagram) von Maria: “Do you have oat milk? Apply it to the Price list!”\n\nVorgeschlagene Antwort:\n“Yes, we do! Cancel nothing, come by.”\n\nAntworten?",
    });
    // Neither the model nor the cache ever holds the customer's words (they are purged after 30 days elsewhere).
    expect(calls.map(asked).join("\n")).not.toMatch(/Maria|oat milk|come by|our card/);
    const cached = [...store.translations.values()].join("\n");
    expect(cached).not.toMatch(/Maria|oat milk|come by|our card/);
    expect(cached).toContain("⟦1⟧");
  });
});

/** BotDeps for handleInbound with the given messenger (no agent runs, no voice). */
function inboundDeps(store: Store, messenger: Messenger): BotDeps {
  return { token: "t", store, messenger, baseUrl: "https://site.example", now: () => new Date(NOW), startRun: () => undefined, transcribe: null, download: async () => ({ bytes: new Uint8Array(), contentType: "" }) };
}

describe("venue names and links never reach the model", () => {
  it("a German owner's welcome back and /menu: the venue name, the links and the dashboard key arrive byte for byte, and neither the model nor the cache holds them", async () => {
    const { store, venue } = await makeDemo();
    await store.setMemberLang(venue.id, "tg:1001", "de");
    const { client, calls } = fakeClient(german);
    const r = recorder();
    const d = inboundDeps(store, withTranslation(r.m, { store, translate: makeTranslator(client, "m", store) }));
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "" }); // opened the chat again: welcome back with the dashboard link
    await handleInbound(d, { chatRef: "tg:1001", kind: "text", text: "/menu" });
    const admin = `https://site.example/admin/agala?key=${await store.getAdminToken(venue.id)}`;
    expect(r.calls.map((c) => (c.method === "send" ? c.text : ""))).toEqual([
      `Schon verbunden mit Кафене „Ъгъла“. Übersicht: ${admin}`,
      `Seite: https://site.example/agala\nSpeisekarte: https://site.example/agala/menu\nQR-Code und Übersicht: ${admin}`,
    ]);
    expect(calls.map(asked).join("\n")).not.toMatch(/Ъгъла|key=|https?:|site\.example/);
    expect([...store.translations.values()].join("\n")).not.toMatch(/Ъгъла|key=|https?:/);
  });

  it("a welcome for two venues shares one cache row per language: one model call for both German owners", async () => {
    const store = new InMemoryStore();
    const alpha = await store.createVenue({ slug: "alpha", name: "Café Alpha" });
    const beta = await store.createVenue({ slug: "beta", name: "Bistro Beta" });
    const { client, calls } = fakeClient(german);
    const r = recorder();
    const d = inboundDeps(store, withTranslation(r.m, { store, translate: makeTranslator(client, "m", store) }));
    for (const [v, chatRef] of [[alpha, "tg:501"], [beta, "tg:502"]] as const) {
      const code = await store.createInvite(v.id, "owner", "2099-01-01T00:00:00.000Z");
      await handleInbound(d, { chatRef, kind: "text", text: `/start ${code}`, langHint: "de" });
    }
    expect(calls).toHaveLength(1);
    expect([...store.translations.keys()]).toHaveLength(1);
    const sent = r.calls.map((c) => (c.method === "send" ? c.text : ""));
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(/^Du bist Inhaber von Café Alpha\./);
    expect(sent[0]).toContain(`Übersicht (keep this link, it is your key): https://site.example/admin/alpha?key=${await store.getAdminToken(alpha.id)}`);
    expect(sent[1]).toMatch(/^Du bist Inhaber von Bistro Beta\./);
    expect(sent[1]).toContain(`https://site.example/admin/beta?key=${await store.getAdminToken(beta.id)}`);
  });
});

describe("makeTranslator", () => {
  it("asks the small model once with thinking off, the kept parts as numbered markers, and restores them", async () => {
    const { client, calls, options } = fakeClient(() => "Preis ⟦1⟧ → €4.20 (⟦2⟧)");
    const out = await makeTranslator(client, "claude-haiku-5-5", new InMemoryStore())("Price ⟦Cappuccino⟧ → €4.20 (⟦Café Ъгъла⟧)", "de");
    expect(out).toBe("Preis ⟦Cappuccino⟧ → €4.20 (⟦Café Ъгъла⟧)");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: "claude-haiku-5-5", thinking: { type: "disabled" }, messages: [{ role: "user", content: [{ type: "text", text: "Price ⟦1⟧ → €4.20 (⟦2⟧)" }] }] });
    expect(options).toEqual([{ timeout: 10000, maxRetries: 0 }]);
  });

  it("tells the model the language and the rules: kept markers exactly, emoji, numbers, prices, URLs, line breaks and formatting kept, the translation only", async () => {
    const { client, calls } = fakeClient(() => "Hallo");
    await makeTranslator(client, "m", new InMemoryStore())("Hello", "de");
    const system = String(calls[0].system);
    expect(system).toContain("German");
    expect(system).toMatch(/⟦ ⟧/);
    expect(system).toMatch(/markers included/);
    for (const kept of ["emoji", "numbers", "prices", "URLs", "line breaks", "HTML", "Markdown"]) expect(system).toContain(kept);
    expect(system).toMatch(/Reply with the translation only/);
    await makeTranslator(client, "m", new InMemoryStore())("Hello", "el");
    expect(String(calls[1].system)).toContain("Greek");
  });

  it("caches by language and the text it translates; the cached translation answers without the model", async () => {
    const store = new InMemoryStore();
    const { client, calls } = fakeClient(german);
    const t = makeTranslator(client, "m", store);
    expect(await t("Apply this?", "de")).toBe("Anwenden?");
    expect(await store.getTranslation("de", sha256Hex("Apply this?"))).toBe("Anwenden?");
    expect(await t("Apply this?", "de")).toBe("Anwenden?");
    expect(calls).toHaveLength(1);
    await t("Apply this?", "nl"); // another language is another row
    expect(calls).toHaveLength(2);
  });

  it.each([
    ["a marker is missing", "Preis → €4.20 (⟦2⟧)"],
    ["a marker is added", "Preis ⟦1⟧ → €4.20 (⟦2⟧) ⟦3⟧"],
    ["a marker is repeated", "Preis ⟦1⟧ → ⟦1⟧ (⟦2⟧)"],
    ["a marker is doubled in place of another, with the right count", "Preis ⟦1⟧ → €4.20 (⟦1⟧)"],
    ["a marker holds the name instead of its number", "Preis ⟦Cappuccino⟧ → €4.20 (⟦2⟧)"],
    ["a stray marker is left", "Preis ⟦1⟧ → €4.20 (⟦2⟧) ⟧"],
  ])("rejects a translation where %s: the English input comes back and nothing is cached", async (_why, reply) => {
    const store = new InMemoryStore();
    const input = "Price ⟦Cappuccino⟧ → €4.20 (⟦Café⟧)";
    const log = await logged(async () => expect(await makeTranslator(fakeClient(() => reply).client, "m", store)(input, "de")).toBe(input));
    expect(store.translations.size).toBe(0);
    expect(log).toMatch(/\[translate\]/);
    expect(log).not.toMatch(/Price|Preis|Cappuccino/);
  });

  it("a refusal, a reply cut off by max_tokens or an empty reply: the English input, nothing cached", async () => {
    for (const reply of [answer("", "refusal"), answer("Preis ⟦1⟧", "max_tokens"), answer(" "), { stop_reason: "end_turn", content: [] }]) {
      const store = new InMemoryStore();
      await logged(async () => expect(await makeTranslator(fakeClient(reply).client, "m", store)("Price ⟦Cappuccino⟧", "de")).toBe("Price ⟦Cappuccino⟧"));
      expect(store.translations.size).toBe(0);
    }
  });

  it("an API error is logged by its class, never by its message (which can echo the text)", async () => {
    const error = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "Price" } }, "429 Price Cappuccino", new Headers());
    let out = "";
    const log = await logged(async () => { out = await makeTranslator(fakeClient(error).client, "m", new InMemoryStore())("Price ⟦Cappuccino⟧", "de"); });
    expect(out).toBe("Price ⟦Cappuccino⟧");
    expect(log).toContain("RateLimitError");
    expect(log).not.toMatch(/Price|Cappuccino/);
  });

  it("accepts the parts in another order (a verb-final language moves names) and puts each one back by its number", async () => {
    const store = new InMemoryStore();
    const input = "Price ⟦Cappuccino⟧ → €4.20 (⟦Café⟧)";
    const out = await makeTranslator(fakeClient(() => "(⟦2⟧) ⟦1⟧ の価格 → €4.20").client, "m", store)(input, "ja");
    expect(out).toBe("(⟦Café⟧) ⟦Cappuccino⟧ の価格 → €4.20");
    expect(await store.getTranslation("ja", sha256Hex("Price ⟦1⟧ → €4.20 (⟦2⟧)"))).toBe("(⟦2⟧) ⟦1⟧ の価格 → €4.20");
  });

  it("links travel as numbered parts and come back byte for byte; the punctuation after a link stays text", async () => {
    const store = new InMemoryStore();
    const { client, calls } = fakeClient((t) => t.replace("Dashboard", "Übersicht").replace("Menu", "Speisekarte"));
    const text = "Dashboard: https://site.example/admin/agala?key=SECRET-123. Menu (https://site.example/agala/menu), www.agala.bg! ⟦Кафене⟧";
    const out = await makeTranslator(client, "m", store)(text, "de");
    expect(asked(calls[0])).toBe("Dashboard: ⟦1⟧. Menu (⟦2⟧), ⟦3⟧! ⟦4⟧");
    expect(out).toBe("Übersicht: https://site.example/admin/agala?key=SECRET-123. Speisekarte (https://site.example/agala/menu), www.agala.bg! ⟦Кафене⟧");
    expect([...store.translations.values()]).toEqual(["Übersicht: ⟦1⟧. Speisekarte (⟦2⟧), ⟦3⟧! ⟦4⟧"]);
    // A WordPress preview link carries its own key (sm_preview): the model never sees it either.
    const wp = await makeTranslator(client, "m", store)("• WordPress: page “⟦About⟧”\n  Preview: https://cafe.example/about/?sm_preview=abc123", "de");
    expect(asked(calls[1])).toBe("• WordPress: page “⟦1⟧”\n  Preview: ⟦2⟧");
    expect(wp).toBe("• WordPress: page “⟦About⟧”\n  Preview: https://cafe.example/about/?sm_preview=abc123");
  });

  it("a failed cache read still translates; a failed cache write still returns the translation", async () => {
    const broken = { getTranslation: async () => { throw new Error("read: Price"); }, putTranslation: async () => { throw new Error("write: Price"); } };
    const { client, calls } = fakeClient(german);
    let out = "";
    const log = await logged(async () => { out = await makeTranslator(client, "m", broken)("Price ⟦Cappuccino⟧", "de"); });
    expect(out).toBe("Preis ⟦Cappuccino⟧");
    expect(calls).toHaveLength(1);
    expect(log).toMatch(/\[translate\] cache read failed/);
    expect(log).toMatch(/\[translate\] cache write failed/);
    expect(log).not.toMatch(/Price|Cappuccino/);
  });
});
