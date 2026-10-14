// test/whatsapp-send.test.ts
import { describe, expect, it } from "vitest";
import { WhatsAppMessenger } from "@/src/channels/whatsapp/send";

function fakeFetch(status = 200, body: unknown = { messaging_product: "whatsapp", messages: [{ id: "wamid.out1" }] }) {
  const calls: { url: string; headers: Record<string, string>; json: Record<string, unknown> }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers as Record<string, string>) ?? {}, json: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { f, calls };
}

describe("WhatsAppMessenger", () => {
  it("sends text to the phone-number endpoint", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    expect(await m.send("wa:359888123456", "Готово")).toBe("wamid.out1");
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PNID/messages");
    expect(calls[0].headers.authorization).toBe("Bearer WT");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "359888123456", type: "text", text: { body: "Готово", preview_url: false } });
  });
  it("sends a proposal as three reply buttons and splits long previews", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    await m.sendProposal("wa:359888123456", "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?", "abc", "en");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "359888123456", type: "interactive", interactive: { type: "button", body: { text: "• Капучино: 2,90 € → 3,20 €\n\nДа приложа ли?" }, action: { buttons: [
      { type: "reply", reply: { id: "cs:apply:abc", title: "✅ Apply" } }, { type: "reply", reply: { id: "cs:change:abc", title: "✏️ Change" } }, { type: "reply", reply: { id: "cs:cancel:abc", title: "❌ Cancel" } } ] } } });
    await m.sendProposal("wa:359888123456", "• " + "x".repeat(1100) + "\n\nДа приложа ли?", "abc", "bg");
    expect(calls[1].json.type).toBe("text");
    expect((calls[2].json.interactive as { body: { text: string } }).body.text).toBe("Да приложа ли?");
  });
  it("typing marks the inbound message read with a typing indicator, and is skipped without one", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    await m.typing("wa:359888123456");
    expect(calls).toHaveLength(0);
    await m.typing("wa:359888123456", "wamid.in1");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.in1", typing_indicator: { type: "text" } });
  });
  it("returns null on a malformed chat ref without calling Graph or throwing", async () => {
    const { f, calls } = fakeFetch();
    const logs: string[] = [];
    const orig = console.error; console.error = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
      expect(await m.send("nonsense", "x")).toBeNull();
      await expect(m.typing("nonsense")).resolves.toBeUndefined();
    } finally { console.error = orig; }
    expect(calls).toHaveLength(0);
    expect(logs.join("\n")).toMatch(/\[meta\] send failed: malformed chat_ref/);
  });
  it("sends a photo by link with its caption", async () => {
    const { f, calls } = fakeFetch();
    const m = new WhatsAppMessenger({ token: "WT", phoneNumberId: "PNID", fetch: f });
    expect(await m.sendPhoto("wa:359888123456", "https://cdn.example/p.jpg", "Флат уайт")).toBe("wamid.out1");
    expect(calls[0].json).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "359888123456", type: "image", image: { link: "https://cdn.example/p.jpg", caption: "Флат уайт" } });
  });
});
