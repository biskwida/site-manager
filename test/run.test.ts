// test/run.test.ts
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AgentDeps } from "@/src/agent/tools";
import { pickEffort, runTurn } from "@/src/agent/run";
import { appendMemory, holdPhoto, loadMemory } from "@/src/agent/memory";
import { PHOTO_NO_CAPTION } from "@/src/agent/prompt";
import type { VisualClient } from "@/src/visual/client";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");

/** A fake Anthropic client: records the params, optionally runs scripted tool calls, returns a final message. */
function fakeClient(script: { tool: string; input: unknown }[] = [], final: { stop_reason: string; text: string } = { stop_reason: "end_turn", text: "Готово." }) {
  const calls: Record<string, unknown>[] = [];
  const toolResults: string[] = [];
  const client = {
    beta: {
      messages: {
        toolRunner(params: Record<string, unknown>) {
          calls.push(params);
          const run = (async () => {
            const tools = params.tools as { name: string; run: (i: unknown) => Promise<string> }[];
            for (const step of script) toolResults.push(await tools.find((t) => t.name === step.tool)!.run(step.input));
            return { stop_reason: final.stop_reason, content: [{ type: "text", text: final.text }] };
          })();
          return { then: run.then.bind(run) };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls, toolResults };
}

async function setup() {
  const demo = await makeDemo();
  const messenger = new FakeMessenger();
  const member = (await demo.store.findMember("tg:1001"))!;
  const deps: AgentDeps = { store: demo.store, venueId: demo.venue.id, chatRef: "tg:1001", member, messenger, now: () => T0, baseUrl: "https://site.example" };
  return { ...demo, messenger, deps };
}

describe("pickEffort", () => {
  it("raises effort for images, bulk and scheduling cues", () => {
    expect(pickEffort("medium", { hasImage: false, text: "Капучиното става 3,20" })).toBe("medium");
    expect(pickEffort("medium", { hasImage: true, text: "" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "Вдигни всички кафета с 10%" })).toBe("high");
    expect(pickEffort("medium", { hasImage: false, text: "From Monday the latte is 3.50" })).toBe("high");
    expect(pickEffort("low", { hasImage: false, text: "затворени сме утре" })).toBe("high");
    expect(pickEffort("high", { hasImage: false, text: "hi" })).toBe("high");
  });
});

describe("runTurn", () => {
  it("sends the right params, memory and image block, relays the final text and stores memory", async () => {
    const { deps, messenger, store, venue } = await setup();
    await appendMemory(store, venue.id, "tg:1001", { at: T0.toISOString(), owner: "здравей", agent: "Здравейте!" }, T0);
    const { client, calls } = fakeClient([], { stop_reason: "end_turn", text: "Готово, върнах я." });
    const out = await runTurn(deps, { text: "това е новата корица", source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: "m-1" }, { model: "claude-opus-5-5", effort: "medium" }, client);
    expect(out).toBe("Готово, върнах я.");
    const p = calls[0];
    expect(p).toMatchObject({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "high" }, tool_choice: { type: "auto", disable_parallel_tool_use: true }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect((p.tools as unknown[]).length).toBe(9);
    const msg = (p.messages as { content: { type: string; text?: string; source?: { data: string } }[] }[])[0];
    expect(msg.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } });
    expect(msg.content[1].text).toContain("Owner: здравей");
    expect(msg.content[1].text).toContain("media_id: m-1");
    expect(msg.content[1].text).toContain("GMT+03:00");
    expect(messenger.sent[0]).toMatchObject({ chatRef: "tg:1001", text: "Готово, върнах я." });
    const conv = await store.getConversation(venue.id, "tg:1001");
    expect(conv?.turns).toHaveLength(2);
    expect(conv?.turns[1]).toMatchObject({ owner: "[photo media_id: m-1] това е новата корица", agent: "Готово, върнах я." });
  });
  it("records the proposal outcome and does not relay an empty final text", async () => {
    const { deps, messenger, store, venue, items } = await setup();
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "капучиното става три и двайсет", source: "voice" }, { model: "m", effort: "medium" }, client);
    expect(messenger.sent).toHaveLength(1); // only the proposal
    expect(messenger.sent[0].setId).toBeDefined();
    const conv = await store.getConversation(venue.id, "tg:1001");
    expect(conv?.turns[0].outcome).toBe("proposed: Капучино 3,20 € (waiting for the owner's decision)");
  });
  it("records every proposal one message created in the memory outcome", async () => {
    const { deps, store, venue, items } = await setup();
    const { client } = fakeClient([
      { tool: "propose_changes", input: { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] } },
      { tool: "schedule_changes", input: { summary_bg: "Коледа", summary_en: "Christmas", apply_at: "2026-12-20T08:00:00+02:00", changes: [{ op: "add_holiday", date: "2026-12-25", note_bg: "Коледа", note_en: "Christmas" }] } },
    ], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "капучиното е 3,20 и сме затворени на Коледа", source: "text" }, { model: "m", effort: "medium" }, client);
    const conv = await store.getConversation(venue.id, "tg:1001");
    expect(conv?.turns[0].outcome).toBe("proposed: Капучино 3,20 € | Коледа (waiting for the owner's decisions)");
  });
  it("attaches photos held without instructions to the next message and claims them", async () => {
    const { deps, store, venue } = await setup();
    const a = await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg");
    const b = await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg");
    const getMedia = store.getMedia.bind(store);
    store.getMedia = async (id: string) => {
      const m = await getMedia(id);
      return m && { ...m, public_url: m.public_url.replace("memory://media/", "https://media.example/") };
    };
    await holdPhoto(store, venue.id, "tg:1001", a.id, "ack", T0);
    await holdPhoto(store, venue.id, "tg:1001", b.id, "ack", T0);
    const { client, calls } = fakeClient([], { stop_reason: "end_turn", text: "Готово." });
    await runTurn(deps, { text: "сложи първата за корица, а втората в Instagram", source: "voice" }, { model: "m", effort: "medium" }, client);
    const p = calls[0];
    expect(p.output_config).toEqual({ effort: "high" });
    const content = (p.messages as { content: { type: string; text?: string; source?: { type: string; url?: string } }[] }[])[0].content;
    expect(content.slice(0, 2).map((c) => c.source)).toEqual([{ type: "url", url: `https://media.example/${a.storage_path}` }, { type: "url", url: `https://media.example/${b.storage_path}` }]);
    expect(content[2].text).toContain(`media_id: ${a.id}, media_id: ${b.id}`);
    expect(content[2].text).toContain("waiting for instructions");
    expect((await loadMemory(store, venue.id, "tg:1001", T0)).waiting).toEqual([]);
  });
  it("still names held photos it cannot attach (offline storage) so their ids can be used", async () => {
    const { deps, store, venue } = await setup();
    const a = await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg");
    await holdPhoto(store, venue.id, "tg:1001", a.id, "ack", T0);
    const { client, calls } = fakeClient([], { stop_reason: "end_turn", text: "Готово." });
    await runTurn(deps, { text: "това е новата корица", source: "text" }, { model: "m", effort: "medium" }, client);
    const content = (calls[0].messages as { content: { type: string; text?: string }[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(["text"]);
    expect(content[0].text).toContain(`media_id: ${a.id}`);
  });
  it("a photo without a caption that the agent only asks about stays held for the owner's next message", async () => {
    const { deps, messenger, store, venue } = await setup();
    const ago = new Date(T0.getTime() - 2 * 60_000);
    await appendMemory(store, venue.id, "tg:1001", { at: ago.toISOString(), owner: "здравей", agent: "Здравейте! С какво да помогна?" }, ago);
    const p = await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg");
    await holdPhoto(store, venue.id, "tg:1001", p.id, "", T0); // what inbound does before starting the turn (album guard)
    const ask = fakeClient([], { stop_reason: "end_turn", text: "Хубава снимка! За корица ли е, или да я публикувам?" });
    await runTurn(deps, { text: PHOTO_NO_CAPTION, source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: p.id }, { model: "m", effort: "medium" }, ask.client);
    const content = (ask.calls[0].messages as { content: { type: string; text?: string }[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(["image", "text"]); // the photo once, not again as a held one
    expect(content[1].text).toContain("without words right after your last reply");
    expect(content[1].text).not.toContain("(no instructions yet)");
    expect(content[1].text).not.toContain("waiting for instructions");
    expect(messenger.sent.map((s) => s.text)).toEqual(["Хубава снимка! За корица ли е, или да я публикувам?"]); // the model's question, no photoWaiting
    const conv = await store.getConversation(venue.id, "tg:1001");
    expect(conv?.turns).toHaveLength(2);
    expect(conv?.turns[1]).toMatchObject({ owner: `[photo media_id: ${p.id}] ${PHOTO_NO_CAPTION}`, agent: "Хубава снимка! За корица ли е, или да я публикувам?", media_ids: [p.id], waiting: true });
    // The owner's answer gets the photo and uses it up.
    const next = fakeClient([], { stop_reason: "end_turn", text: "Готово." });
    await runTurn(deps, { text: "за стори в инстаграм", source: "text" }, { model: "m", effort: "medium" }, next.client);
    const text = (next.calls[0].messages as { content: { type: string; text?: string }[] }[])[0].content.at(-1)!.text!;
    expect(text).toContain(`media_id: ${p.id}`);
    expect(text).toContain("waiting for instructions");
    expect((await loadMemory(store, venue.id, "tg:1001", T0)).waiting).toEqual([]);
  });
  it("a photo without a caption that the agent acts on is used up; with no words and no proposal it falls back to the usual question", async () => {
    const { deps, messenger, store, venue, items } = await setup();
    const p = await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg");
    await appendMemory(store, venue.id, "tg:1001", { at: T0.toISOString(), owner: "смени водата на 1.50", agent: "Изпратете ми снимката." }, T0);
    await holdPhoto(store, venue.id, "tg:1001", p.id, "", T0);
    const act = fakeClient([{ tool: "propose_changes", input: { summary_bg: "Капучино 3,20 €", summary_en: "Cappuccino €3.20", changes: [{ op: "set_price", item_id: items.Cappuccino.id, price_eur: 3.2 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: PHOTO_NO_CAPTION, source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: p.id }, { model: "m", effort: "medium" }, act.client);
    expect((await loadMemory(store, venue.id, "tg:1001", T0)).waiting).toEqual([]);
    const turns = (await store.getConversation(venue.id, "tg:1001"))!.turns;
    expect(turns.map((t) => t.owner)).toEqual(["смени водата на 1.50", `[photo media_id: ${p.id}] ${PHOTO_NO_CAPTION}`]); // the silent hold is gone
    expect(turns[1].waiting).toBeUndefined();
    expect(messenger.sent).toHaveLength(1); // only the proposal

    const quiet = await setup();
    const q = await quiet.store.saveMedia(quiet.venue.id, new Uint8Array([1]), "image/jpeg");
    await holdPhoto(quiet.store, quiet.venue.id, "tg:1001", q.id, "", T0);
    await runTurn(quiet.deps, { text: PHOTO_NO_CAPTION, source: "photo", image: { data: "AAAA", media_type: "image/jpeg" }, mediaId: q.id }, { model: "m", effort: "medium" }, fakeClient([], { stop_reason: "end_turn", text: "" }).client);
    expect(quiet.messenger.sent.map((s) => s.text)).toEqual(["📷 Получих снимката. Какво да направя с нея? Напишете или изпратете гласово съобщение."]);
    expect((await loadMemory(quiet.store, quiet.venue.id, "tg:1001", T0)).waiting).toEqual([q.id]);
  });
  it("shows typing for the whole turn and removes the status message before the answer", async () => {
    const { deps, messenger } = await setup();
    const slow = {
      beta: { messages: { toolRunner(params: Record<string, unknown>) {
        const run = (async () => {
          const tools = params.tools as { name: string; run: (i: unknown) => Promise<string> }[];
          await new Promise((r) => setTimeout(r, 3_200));
          await tools.find((t) => t.name === "get_menu")!.run({});
          await new Promise((r) => setTimeout(r, 50));
          return { stop_reason: "end_turn", content: [{ type: "text", text: "Готово." }] };
        })();
        return { then: run.then.bind(run) };
      } } },
    } as unknown as Anthropic;
    await runTurn(deps, { text: "колко е капучиното?", source: "text" }, { model: "m", effort: "medium" }, slow);
    expect(messenger.sent.map((s) => s.text)).toEqual(["⏳ Работя по това…", "Готово."]);
    expect(messenger.edited.map((e) => e.text)).toEqual(["📖 Чета менюто…"]);
    expect(messenger.removed).toEqual([{ chatRef: "tg:1001", messageRef: messenger.sent[0].messageRef }]);
  });
  it("tells the owner when the model refuses or errors", async () => {
    const { deps, messenger } = await setup();
    const { client } = fakeClient([], { stop_reason: "refusal", text: "" });
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, client)).toBe("refused");
    expect(messenger.sent[0].text).toBe("Не мога да изпълня това. Опитайте с друга формулировка.");
    const boom = { beta: { messages: { toolRunner() { throw new Error("network down"); } } } } as unknown as Anthropic;
    expect(await runTurn(deps, { text: "x", source: "text" }, { model: "m", effort: "medium" }, boom)).toBe("error");
    expect(messenger.sent[1].text).toBe("Възникна грешка. Опитайте отново след малко.");
  });
  it("sends a picture once per turn: social_post skips the one make_visual just sent, and the next turn starts afresh", async () => {
    const { deps, messenger, store, venue } = await setup();
    const https = (url: string) => url.replace("memory://media/", "https://media.example/");
    const getMedia = store.getMedia.bind(store);
    store.getMedia = async (id: string) => {
      const m = await getMedia(id);
      return m && { ...m, public_url: https(m.public_url) };
    };
    const photo = await store.saveMedia(venue.id, new Uint8Array([1]), "image/jpeg");
    const picture = await store.saveMedia(venue.id, new Uint8Array([2]), "image/jpeg");
    const url = https(picture.public_url);
    const visual: VisualClient = async () => ({ kind: "cutout", backdrop: "teal", pictures: [{ format: "post", media_id: picture.id, url }] });
    const withPictures: AgentDeps = { ...deps, social: { facebook: true, instagram: false }, visual };
    const post = { summary_bg: "Публикация: флат уайт", summary_en: "Post: flat white", media_id: picture.id, caption: "Флат уайт", targets: ["facebook_post"] };
    const first = fakeClient([{ tool: "make_visual", input: { media_id: photo.id, dish: "Флат уайт", formats: ["post"] } }, { tool: "social_post", input: post }], { stop_reason: "end_turn", text: "" });
    await runTurn(withPictures, { text: "направи пост и го пусни във Facebook", source: "text" }, { model: "m", effort: "medium" }, first.client);
    expect(first.toolResults.map((r) => JSON.parse(r).error)).toEqual([undefined, undefined]);
    expect(messenger.photos.map((p) => [p.url, p.caption])).toEqual([[url, "Пост"]]); // make_visual's; social_post did not send it again
    const proposal = messenger.sent.find((s) => s.setId)!;
    await store.updateChangeSet(proposal.setId!, { status: "cancelled" });
    // The next message is a new turn: its proposal shows the picture again, even when the deps still carry an earlier turn's set.
    const second = fakeClient([{ tool: "social_post", input: post }], { stop_reason: "end_turn", text: "" });
    await runTurn({ ...withPictures, sentPhotos: new Set([url]) }, { text: "пусни го пак", source: "text" }, { model: "m", effort: "medium" }, second.client);
    expect(JSON.parse(second.toolResults[0]).status).toBe("proposed");
    expect(messenger.photos.map((p) => [p.url, p.caption])).toEqual([[url, "Пост"], [url, "Facebook пост"]]);
  });
  it("passes correctionFor from memory into the tools", async () => {
    const { deps, store, venue, items } = await setup();
    const { setCorrection } = await import("@/src/agent/memory");
    const site = await store.getSite(venue.id);
    const { planChanges } = await import("@/src/domain/changes");
    const old = await store.createChangeSet({ venue_id: venue.id, chat_ref: "tg:1001", summary_bg: "x", summary_en: "x", preview_bg: "p", preview_en: "p", source: "text", status: "proposed", message_ref: "7", changes: planChanges(site, [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.5 }], { newId: () => "n", now: T0.toISOString() }) });
    await setCorrection(store, venue.id, "tg:1001", old.id, T0);
    const { client } = fakeClient([{ tool: "propose_changes", input: { summary_bg: "y", summary_en: "y", changes: [{ op: "set_price", item_id: items.Latte.id, price_eur: 3.4 }] } }], { stop_reason: "end_turn", text: "" });
    await runTurn(deps, { text: "не, 3,40", source: "text" }, { model: "m", effort: "medium" }, client);
    expect((await store.getChangeSet(old.id)).status).toBe("cancelled");
    expect(await store.findProposed(venue.id, "tg:1001")).not.toBeNull();
  });
});

describe("SYSTEM_PROMPT", () => {
  it("tells the agent to split a message into tasks and do every one", async () => {
    const { SYSTEM_PROMPT } = await import("@/src/agent/prompt");
    expect(SYSTEM_PROMPT).toMatch(/Split the owner's message into tasks/);
    expect(SYSTEM_PROMPT).toMatch(/never stop after the first/i);
    expect(SYSTEM_PROMPT).not.toMatch(/One proposal per message/);
  });
  it("numbers its rules 1, 2, 3, … without gaps or repeats (rules refer to each other by number)", async () => {
    const { SYSTEM_PROMPT } = await import("@/src/agent/prompt");
    const numbers = [...SYSTEM_PROMPT.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    expect(SYSTEM_PROMPT).toMatch(/^12\. Monthly change limit:/m);
  });
});
