// test/meta-send.test.ts
import { describe, expect, it } from "vitest";
import { MetaMessenger } from "@/src/channels/meta/send";
import { proposalParts, splitText } from "@/src/channels/text";

function fakeFetch(status = 200, body: unknown = { message_id: "m_1", recipient_id: "500" }) {
  const calls: { url: string; init: RequestInit; json: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, json: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("splitText / proposalParts", () => {
  it("splits on paragraphs and never exceeds the limit", () => {
    const parts = splitText("a\n\nb\n\n" + "x".repeat(50), 20);
    expect(parts.every((p) => p.length <= 20 && p.length > 0)).toBe(true);
    expect(parts.join("")).toContain("a");
    expect(proposalParts("• A\n• B\n\nДа приложа ли?", 640)).toEqual({ lead: null, ask: "• A\n• B\n\nДа приложа ли?" });
    const long = "• " + "x".repeat(700) + "\n\nДа приложа ли?";
    expect(proposalParts(long, 640)).toEqual({ lead: "• " + "x".repeat(700), ask: "Да приложа ли?" });
  });
});

describe("MetaMessenger", () => {
  it("sends text with a bearer header and returns the message id", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    expect(await m.send("fb:500", "Здравей")).toBe("m_1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/me/messages");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer PT");
    expect(calls[0].json).toEqual({ recipient: { id: "500" }, messaging_type: "RESPONSE", message: { text: "Здравей" } });
  });
  it("sends a proposal as a button template with three postbacks, Instagram included", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    await m.sendProposal("ig:178414", "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", "abc", "bg");
    expect(calls[0].json).toEqual({ recipient: { id: "178414" }, messaging_type: "RESPONSE", message: { attachment: { type: "template", payload: { template_type: "button", text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", buttons: [
      { type: "postback", title: "✅ Приложи", payload: "cs:apply:abc" }, { type: "postback", title: "✏️ Промени", payload: "cs:change:abc" }, { type: "postback", title: "❌ Откажи", payload: "cs:cancel:abc" } ] } } } });
  });
  it("sends a long preview as text first, then a short button message (Review Focus 3)", async () => {
    const { f, calls } = fakeFetch();
    const m = new MetaMessenger({ pageToken: "PT", fetch: f });
    const ref = await m.sendProposal("fb:500", "• " + "x".repeat(700) + "\n\nДа приложа ли?", "abc", "bg");
    expect(calls).toHaveLength(2);
    expect(calls[0].json.message).toEqual({ text: "• " + "x".repeat(700) });
    expect((calls[1].json.message as { attachment: { payload: { text: string } } }).attachment.payload.text).toBe("Да приложа ли?");
    expect(ref).toBe("m_1");
  });
  it("concludes with the short line, shows typing, and returns null on errors without leaking the token", async () => {
    const { f, calls } = fakeFetch(400, { error: { message: "(#100) bad", code: 100, error_subcode: 2018001 } });
    const logs: string[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const m = new MetaMessenger({ pageToken: "SECRET-PT", fetch: f });
      expect(await m.send("fb:500", "x")).toBeNull();
      await m.conclude("fb:500", "m_9", "full text", "✅ Приложено");
      await m.typing("fb:500");
    } finally { console.error = orig; }
    expect(calls[1].json.message).toEqual({ text: "✅ Приложено" });
    expect(calls[2].json).toEqual({ recipient: { id: "500" }, sender_action: "typing_on" });
    expect(logs.join("\n")).toMatch(/send failed HTTP 400 code=100 subcode=2018001/);
    expect(logs.join("\n")).not.toContain("SECRET-PT");
  });
  it("returns null on a malformed chat ref without calling Graph or throwing", async () => {
    const { f, calls } = fakeFetch();
    const logs: string[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const m = new MetaMessenger({ pageToken: "PT", fetch: f });
      expect(await m.send("nonsense", "x")).toBeNull();
      await expect(m.typing("nonsense")).resolves.toBeUndefined();
    } finally { console.error = orig; }
    expect(calls).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/\[meta\] send failed: malformed chat_ref/);
  });
});
