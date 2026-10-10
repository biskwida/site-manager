// src/channels/meta/parse.ts
// Meta webhook JSON (object = page | instagram | whatsapp_business_account) → InboundMessage[]. Never throws; unknown shapes are skipped with a one-line log of their keys.
import type { InboundMessage } from "../../bot/inbound";
import { makeRef, maskRef, type Channel } from "../ref";
import type { MediaFetch } from "./graph";

type J = Record<string, unknown>;
const obj = (x: unknown): J | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as J) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string | null => (typeof x === "string" && x.length ? x : null);

export function parseMetaWebhook(body: unknown, deps: { waDownload: MediaFetch; fetchUrl: MediaFetch }): InboundMessage[] {
  const b = obj(body);
  if (!b) return [];
  const out: InboundMessage[] = [];
  if (b.object === "page" || b.object === "instagram") {
    const channel: Channel = b.object === "instagram" ? "ig" : "fb";
    for (const e of arr(b.entry)) for (const ev of arr(obj(e)?.messaging)) {
      try { const m = pageEvent(channel, obj(ev), deps.fetchUrl); if (m) out.push(m); } catch (err) { skip("page", ev, err); }
    }
  } else if (b.object === "whatsapp_business_account") {
    for (const e of arr(b.entry)) for (const ch of arr(obj(e)?.changes)) {
      const c = obj(ch);
      if (!c || c.field !== "messages") continue;
      for (const msg of arr(obj(c.value)?.messages)) {
        try { const m = waMessage(obj(msg), deps.waDownload); if (m) out.push(m); } catch (err) { skip("whatsapp", msg, err); }
      }
    }
  } else {
    console.log(`[meta] ignored webhook object ${String(b.object)}`);
  }
  return out;
}

function skip(kind: string, ev: unknown, err: unknown) {
  console.log(`[meta] skipped ${kind} event (${Object.keys(obj(ev) ?? {}).join(",")}): ${err instanceof Error ? err.message : err}`);
}

function pageEvent(channel: Channel, ev: J | null, fetchUrl: MediaFetch): InboundMessage | null {
  const sender = str(obj(ev?.sender)?.id);
  if (!ev || !sender) return null;
  const chatRef = makeRef(channel, sender);
  const ts = String(ev.timestamp ?? "");
  const msg = obj(ev.message);
  if (msg) {
    if (msg.is_echo === true) return null;
    const eventId = str(msg.mid) ?? `${sender}:${ts}`;
    const qr = str(obj(msg.quick_reply)?.payload);
    if (qr) return { chatRef, kind: "button", text: qr, messageRef: eventId, eventId };
    const text = str(msg.text) ?? "";
    // An m.me / ig.me ?ref= link can arrive on the first message itself (no postback, no separate referral event); handleInbound lets the referral win.
    const mref = str(obj(msg.referral)?.ref);
    if (mref) return { chatRef, kind: "text", text, referralCode: mref, messageRef: eventId, eventId };
    const att = arr(msg.attachments).map(obj).filter((a): a is J => a !== null);
    const media = (a: J) => { const url = str(obj(a.payload)?.url); return url ? { download: () => fetchUrl(url) } : null; };
    const image = att.find((a) => a.type === "image");
    if (image) { const m = media(image); return m ? { chatRef, kind: "photo", text, media: m, messageRef: eventId, eventId } : null; }
    const audio = att.find((a) => a.type === "audio");
    if (audio) { const m = media(audio); return m ? { chatRef, kind: "voice", media: m, messageRef: eventId, eventId } : null; }
    if (att.length) { console.log(`[meta] unsupported attachment ${String(att[0].type)} from ${maskRef(chatRef)}`); return null; }
    if (!text) return null;
    return { chatRef, kind: "text", text, messageRef: eventId, eventId };
  }
  const pb = obj(ev.postback);
  if (pb) {
    const eventId = str(pb.mid) ?? `${sender}:${ts}`;
    const payload = str(pb.payload) ?? "";
    if (/^cs:/.test(payload)) return { chatRef, kind: "button", text: payload, messageRef: eventId, eventId };
    const ref = str(obj(pb.referral)?.ref);
    if (ref) return { chatRef, kind: "text", text: "", referralCode: ref, eventId };
    return null;
  }
  const ref = str(obj(ev.referral)?.ref);
  if (ref) return { chatRef, kind: "text", text: "", referralCode: ref, eventId: `${sender}:${ts}` };
  return null; // read, delivery, reaction, …
}

function waMessage(m: J | null, waDownload: MediaFetch): InboundMessage | null {
  const from = str(m?.from);
  const id = str(m?.id);
  if (!m || !from || !id) return null;
  const chatRef = makeRef("wa", from);
  const base = { chatRef, messageRef: id, eventId: id } as const;
  const media = (key: "image" | "audio") => { const mid = str(obj(m[key])?.id); return mid ? { download: () => waDownload(mid) } : null; };
  switch (m.type) {
    case "text": { const body = str(obj(m.text)?.body); return body ? { ...base, kind: "text", text: body } : null; }
    case "image": { const md = media("image"); return md ? { ...base, kind: "photo", text: str(obj(m.image)?.caption) ?? "", media: md } : null; }
    case "audio": { const md = media("audio"); return md ? { ...base, kind: "voice", media: md } : null; }
    case "interactive": { const bid = str(obj(obj(m.interactive)?.button_reply)?.id); return bid ? { ...base, kind: "button", text: bid } : null; }
    case "button": { const p = str(obj(m.button)?.payload); return p ? { ...base, kind: "button", text: p } : null; }
    default: console.log(`[meta] unsupported WhatsApp type ${String(m.type)} from ${maskRef(chatRef)}`); return null;
  }
}
