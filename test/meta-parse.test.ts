// test/meta-parse.test.ts
import { describe, expect, it } from "vitest";
import { parseMetaWebhook } from "@/src/channels/meta/parse";

const deps = { waDownload: async (id: string) => ({ bytes: new Uint8Array([1]), contentType: `wa:${id}` }), fetchUrl: async (url: string) => ({ bytes: new Uint8Array([2]), contentType: `url:${url}` }) };
const page = (messaging: unknown[], object = "page") => ({ object, entry: [{ id: "PAGE1", time: 1, messaging }] });
const wa = (value: Record<string, unknown>) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "1555", phone_number_id: "PNID" }, ...value } }] }] });

describe("parseMetaWebhook: Messenger and Instagram", () => {
  it("maps text, image, audio, quick reply, postback, referral and skips echoes/reads", async () => {
    const out = parseMetaWebhook(page([
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 1, message: { mid: "m1", text: "Капучиното става 3,20" } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 2, message: { mid: "m2", text: "корица", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 3, message: { mid: "m3", attachments: [{ type: "audio", payload: { url: "https://cdn/v.mp4" } }] } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 4, message: { mid: "m4", text: "✅ Приложи", quick_reply: { payload: "cs:apply:abc" } } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 5, postback: { mid: "m5", title: "✅ Приложи", payload: "cs:apply:abc" } },
      { sender: { id: "501" }, recipient: { id: "PAGE1" }, timestamp: 6, postback: { mid: "m6", title: "Get Started", payload: "GET_STARTED", referral: { ref: "ABCD2345", source: "SHORTLINK", type: "OPEN_THREAD" } } },
      { sender: { id: "502" }, recipient: { id: "PAGE1" }, timestamp: 7, referral: { ref: "WXYZ6789", source: "SHORTLINK", type: "OPEN_THREAD" } },
      { sender: { id: "PAGE1" }, recipient: { id: "500" }, timestamp: 8, message: { mid: "m8", is_echo: true, text: "echo" } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 9, read: { watermark: 9 } },
      { sender: { id: "500" }, recipient: { id: "PAGE1" }, timestamp: 10, message: { mid: "m10", attachments: [{ type: "video", payload: { url: "https://cdn/v.mp4" } }] } },
    ]), deps);
    expect(out.map((m) => [m.chatRef, m.kind, m.text ?? "", m.referralCode ?? "", m.eventId])).toEqual([
      ["fb:500", "text", "Капучиното става 3,20", "", "m1"],
      ["fb:500", "photo", "корица", "", "m2"],
      ["fb:500", "voice", "", "", "m3"],
      ["fb:500", "button", "cs:apply:abc", "", "m4"],
      ["fb:500", "button", "cs:apply:abc", "", "m5"],
      ["fb:501", "text", "", "ABCD2345", "m6"],
      ["fb:502", "text", "", "WXYZ6789", "502:7"],
    ]);
    expect(await out[1].media!.download()).toMatchObject({ contentType: "url:https://cdn/x.jpg" });
  });
  it("uses the ig: prefix for the instagram object", () => {
    const out = parseMetaWebhook(page([{ sender: { id: "178414" }, recipient: { id: "IG1" }, timestamp: 1, message: { mid: "i1", text: "hi" } }], "instagram"), deps);
    expect(out[0]).toMatchObject({ chatRef: "ig:178414", kind: "text", text: "hi", eventId: "i1" });
  });
});

describe("parseMetaWebhook: WhatsApp", () => {
  it("maps text, image, audio, button replies and skips statuses (Review Focus 4)", async () => {
    const out = parseMetaWebhook(wa({
      contacts: [{ profile: { name: "T" }, wa_id: "359888123456" }],
      messages: [
        { from: "359888123456", id: "wamid.1", timestamp: "1", type: "text", text: { body: "Баницата свърши" } },
        { from: "359888123456", id: "wamid.2", timestamp: "2", type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", sha256: "x", caption: "дъската" } },
        { from: "359888123456", id: "wamid.3", timestamp: "3", type: "audio", audio: { id: "MEDIA2", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { from: "359888123456", id: "wamid.4", timestamp: "4", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "cs:cancel:abc", title: "❌ Откажи" } } },
        { from: "359888123456", id: "wamid.5", timestamp: "5", type: "button", button: { payload: "cs:apply:abc", text: "✅ Приложи" } },
        { from: "359888123456", id: "wamid.6", timestamp: "6", type: "sticker", sticker: { id: "S" } },
      ],
    }), deps);
    expect(out.map((m) => [m.chatRef, m.kind, m.text ?? "", m.messageRef, m.eventId])).toEqual([
      ["wa:359888123456", "text", "Баницата свърши", "wamid.1", "wamid.1"],
      ["wa:359888123456", "photo", "дъската", "wamid.2", "wamid.2"],
      ["wa:359888123456", "voice", "", "wamid.3", "wamid.3"],
      ["wa:359888123456", "button", "cs:cancel:abc", "wamid.4", "wamid.4"],
      ["wa:359888123456", "button", "cs:apply:abc", "wamid.5", "wamid.5"],
    ]);
    expect(await out[2].media!.download()).toMatchObject({ contentType: "wa:MEDIA2" });
    expect(parseMetaWebhook(wa({ statuses: [{ id: "wamid.9", status: "delivered", timestamp: "9", recipient_id: "359888123456" }] }), deps)).toEqual([]);
  });
  it("never throws on unknown or malformed bodies", () => {
    expect(parseMetaWebhook({ object: "user", entry: [] }, deps)).toEqual([]);
    expect(parseMetaWebhook(null, deps)).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: {} }] }] }, deps)).toEqual([]);
    expect(parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [{ from: "1", id: "x", type: "text" }] } }] }] }, deps)).toEqual([]);
  });
});
