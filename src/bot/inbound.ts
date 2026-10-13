// src/bot/inbound.ts
// Channel-agnostic owner messages. Telegram (bot.ts) and the Meta webhook (server/meta.ts) both translate into InboundMessage and call handleInbound.
import { holdPhoto } from "../agent/memory";
import type { ImageInput } from "../agent/run";
import { channelOf, isMetaChannel, maskRef, type Channel } from "../channels/ref";
import { detectLang } from "../domain/format";
import type { Lang, Member } from "../domain/types";
import { handleDecision, parseCallback } from "./approvals";
import type { BotDeps } from "./bot";
import { copy } from "./copy";
import { adminUrl, publicUrl } from "./links";
import { imageMediaType, MAX_IMAGE_BYTES } from "./media";
import { audioContentType } from "./voice";

export interface InboundMedia {
  download: () => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;
}
export interface InboundMessage {
  chatRef: string;
  kind: "text" | "voice" | "photo" | "button";
  /** Body, caption, or button data ("cs:apply:<id>"). */
  text?: string;
  /** Telegram language_code; absent on Meta. */
  langHint?: Lang;
  media?: InboundMedia;
  /** The message a button belongs to / the inbound id (WhatsApp typing). */
  messageRef?: string;
  /** m.me / ig.me ?ref=, wa.me ?text= */
  referralCode?: string;
  /** Platform message id, for dedupe. */
  eventId?: string;
}

const CODE = /^[A-Z0-9-]{8,}$/;
const COMMANDS = new Set(["lang", "help", "menu", "undo", "connect"]);
/** Command words for Meta channels, where there is no command menu. No word for undo: a plain "отмени" may be meant for a proposal, not the last applied change; "/undo" or asking the agent ("върни последната промяна") still works. */
const WORDS: [RegExp, string][] = [
  [/^(menu|меню)$/i, "/menu"],
  [/^(help|помощ)$/i, "/help"],
  [/^(language|език)\s+(bg|en)$/i, "/lang $2"],
];

/** Slash commands pass through; on Meta channels command words ("меню", "language en", …) become their slash form; anything else is null. On Telegram plain words stay text for the agent. */
export function normalizeCommand(text: string, channel: Channel): string | null {
  const t = text.trim();
  if (t.startsWith("/")) return t;
  if (!isMetaChannel(channel)) return null;
  for (const [re, cmd] of WORDS) {
    const m = re.exec(t);
    if (m) return cmd.replace("$2", (m[2] ?? "").toLowerCase());
  }
  return null;
}

/** "/lang@site_manager_bot en" → { name: "lang", arg: "en" }; the arg is the whole rest ("/connect <url> <code>"). */
function splitCommand(cmd: string): { name: string; arg: string } {
  const m = /^\/(\S*)(?:\s+([\s\S]*))?$/.exec(cmd.trim());
  const head = m?.[1] ?? "";
  return { name: head.replace(/@\w+$/, "").toLowerCase(), arg: (m?.[2] ?? "").trim() };
}

/** "/start CODE" → CODE, "/start" → "", a bare code from a non-member → itself, otherwise null. */
function startCode(text: string, isMember: boolean): string | null {
  const m = /^\/start(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (m) return (m[1] ?? "").trim().toUpperCase();
  const bare = text.trim().toUpperCase();
  return !isMember && CODE.test(bare) ? bare : null;
}

export async function handleInbound(d: BotDeps, m: InboundMessage): Promise<void> {
  const channel: Channel = channelOf(m.chatRef);
  const now = d.now();
  await touch(d, m.chatRef, now);
  const member = await d.store.findMember(m.chatRef);
  const text = (m.text ?? "").trim();
  const say = (t: string) => d.messenger.send(m.chatRef, t);

  if (m.kind === "button") {
    const parsed = parseCallback(text);
    if (!parsed) return;
    const r = await handleDecision({ store: d.store, messenger: d.messenger, now: d.now }, m.chatRef, parsed.decision, parsed.setId);
    // Telegram edits the proposal and removes the buttons; Meta sends the short status. Best-effort, never throws.
    if (r.edit) await d.messenger.conclude(m.chatRef, m.messageRef ?? null, r.edit.full, r.edit.short);
    if (r.reply) await say(r.reply);
    return;
  }

  // Linking: /start <code>, a referral code, or a bare code from someone not yet linked.
  // A linked member who reopens the deep link and writes something is talking to the agent; the stale referral is ignored.
  const referral = m.referralCode !== undefined && !(member && text) ? m.referralCode : undefined;
  const code = referral !== undefined ? referral.trim().toUpperCase() : m.kind === "text" ? startCode(text, member !== null) : null;
  // Telegram tells us the language; on Meta, Cyrillic means Bulgarian and other prose English. A code or nothing says nothing: Bulgarian.
  const uiLang: Lang = m.langHint ?? detectLang(text) ?? (code === null && /\p{L}/u.test(text) ? "en" : "bg");
  if (code !== null) {
    // A code is tried first, even from a linked chat: the owner may be setting up another venue (the demo phone, a second
    // café). redeemInvite moves the chat to the code's venue. Only without a usable code does a linked chat get welcome-back.
    const linked = code ? await d.store.redeemInvite(code, m.chatRef, uiLang, now.toISOString()) : null;
    if (!linked) {
      if (member) await welcomeBack(d, member);
      else await say(code ? copy(uiLang).badCode : copy(uiLang).noAccess(channel));
      return;
    }
    // An owner tapping a staff code for their own venue must not demote themselves (the code is still used up).
    if (member && member.venue_id === linked.venue_id && member.role === "owner" && linked.role !== "owner") {
      Object.assign(linked, await d.store.upsertMember({ venue_id: member.venue_id, chat_ref: m.chatRef, role: "owner", lang: member.lang }));
    }
    await touch(d, m.chatRef, now);
    await welcome(d, linked, member);
    return;
  }

  if (!member) {
    const cmd = m.kind === "text" ? normalizeCommand(text, channel) : null;
    if (cmd && !COMMANDS.has(splitCommand(cmd).name)) return; // unknown command: silent, as before
    await say(copy(uiLang).noAccess(channel));
    return;
  }

  if (m.kind === "text") {
    if (!text) {
      await welcomeBack(d, member); // opened the chat (Get Started) with nothing to say
      return;
    }
    const cmd = normalizeCommand(text, channel);
    if (cmd) {
      await runCommand(d, member, channel, cmd);
      return;
    }
    // Start first: a failed acknowledgement must not lose the message.
    const lang = detectLang(text) ?? member.lang;
    d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text, source: "text" });
    await d.messenger.typing(m.chatRef, m.messageRef);
    return;
  }
  if (m.kind === "photo") {
    await handlePhoto(d, member, m);
    return;
  }
  if (m.kind === "voice") await handleVoice(d, member, m);
}

/** Records the owner's last message for Meta's 24-hour window. Best-effort: a failure costs at most a skipped reminder, never the message. */
async function touch(d: BotDeps, chatRef: string, now: Date) {
  try {
    await d.store.touchMember(chatRef, now.toISOString());
  } catch (e) {
    console.error(`[bot] touchMember failed for ${maskRef(chatRef)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** `previous` is the chat's membership before the redeem (null for a new chat). */
async function welcome(d: BotDeps, member: Member, previous: Member | null) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(member.lang);
  if (previous && previous.venue_id !== member.venue_id) await d.messenger.send(member.chat_ref, c.switched(venue.name));
  if (member.role === "owner") {
    await d.messenger.send(member.chat_ref, c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), publicUrl(d.baseUrl, venue.slug), channelOf(member.chat_ref)));
    if (d.onOwnerJoined) {
      // The first owner join is the human check that publishes the site; startDeploy ignores venues that already have one.
      if (venue.status === "live" && venue.deploy === null) await d.messenger.send(member.chat_ref, c.publishing);
      try {
        d.onOwnerJoined(venue.id);
      } catch (e) {
        console.error("[bot] onOwnerJoined failed:", e instanceof Error ? e.message : e);
      }
    }
  } else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
}

async function welcomeBack(d: BotDeps, member: Member) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(member.lang);
  if (member.role === "owner") await d.messenger.send(member.chat_ref, c.welcomeBack(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id))));
  else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
}

async function runCommand(d: BotDeps, member: Member, channel: Channel, cmd: string) {
  const { name, arg } = splitCommand(cmd);
  const c = copy(member.lang);
  switch (name) {
    case "lang": {
      const l = (arg.split(/\s+/)[0] ?? "").toLowerCase();
      if (l !== "bg" && l !== "en") {
        await d.messenger.send(member.chat_ref, c.langUsage(channel));
        return;
      }
      await d.store.setMemberLang(member.venue_id, member.chat_ref, l);
      await d.messenger.send(member.chat_ref, copy(l).langSet);
      return;
    }
    case "help":
      await d.messenger.send(member.chat_ref, c.help(channel));
      return;
    case "menu": {
      const venue = await d.store.getVenue(member.venue_id);
      const admin = member.role === "owner" ? adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)) : null;
      await d.messenger.send(member.chat_ref, c.menu(publicUrl(d.baseUrl, venue.slug), admin));
      return;
    }
    case "connect": {
      const lang = detectLang(cmd) ?? member.lang;
      const cc = copy(lang);
      if (member.role !== "owner") {
        await d.messenger.send(member.chat_ref, cc.connectOwnerOnly);
        return;
      }
      const [siteUrl, code] = arg.split(/\s+/);
      if (!siteUrl || !code) {
        await d.messenger.send(member.chat_ref, cc.connectUsage);
        return;
      }
      if (!d.connect) {
        await d.messenger.send(member.chat_ref, cc.connectUnavailable);
        return;
      }
      const r = await d.connect(member.venue_id, siteUrl, code);
      await d.messenger.send(member.chat_ref, r.ok ? cc.connectOk(r.site.name, String(r.destination.config.site_url)) : cc.connectFailed(lang === "bg" ? r.reason.bg : r.reason.en));
      return;
    }
    case "undo":
      d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member, text: "Undo the last change.", source: "text" });
      await d.messenger.typing(member.chat_ref);
      return;
    default:
      return; // unknown command: silent, as before
  }
}

async function handlePhoto(d: BotDeps, member: Member, m: InboundMessage) {
  const caption = (m.text ?? "").trim();
  const lang = detectLang(caption) ?? member.lang;
  const c = copy(lang);
  let bytes: Uint8Array;
  let media_type: ImageInput["media_type"] | null;
  try {
    if (!m.media) throw new Error("no media");
    const dl = await m.media.download();
    // Checked here too: Meta downloads do not go through downloadTelegramFile.
    if (dl.bytes.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${dl.bytes.byteLength} bytes)`);
    bytes = dl.bytes;
    media_type = imageMediaType(dl.contentType, dl.name ?? "");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[bot] image download failed: ${msg}`);
    await d.messenger.send(member.chat_ref, /too large/.test(msg) ? c.photoTooBig : c.photoFailed);
    return;
  }
  if (!media_type) {
    await d.messenger.send(member.chat_ref, c.photoFailed);
    return;
  }
  const media = await d.store.saveMedia(member.venue_id, bytes, media_type);
  if (!caption) {
    // No instructions yet: hold the photo for the owner's next message (often a voice note) instead of guessing.
    if (await holdPhoto(d.store, member.venue_id, member.chat_ref, media.id, c.photoWaiting, d.now())) await d.messenger.send(member.chat_ref, c.photoWaiting);
    return;
  }
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text: caption, source: "photo", image: { data: Buffer.from(bytes).toString("base64"), media_type }, mediaId: media.id });
  await d.messenger.typing(member.chat_ref, m.messageRef);
}

async function handleVoice(d: BotDeps, member: Member, m: InboundMessage) {
  const c = copy(member.lang);
  if (!d.transcribe) {
    await d.messenger.send(member.chat_ref, c.voiceUnavailable);
    return;
  }
  let text: string;
  try {
    if (!m.media) throw new Error("no media");
    const dl = await m.media.download();
    text = (await d.transcribe(dl.bytes, member.lang, audioContentType(dl.contentType, dl.name))).trim();
  } catch (e) {
    console.error(`[bot] voice failed: ${e instanceof Error ? e.message : String(e)}`);
    await d.messenger.send(member.chat_ref, c.voiceFailed);
    return;
  }
  if (!text) {
    await d.messenger.send(member.chat_ref, c.voiceFailed);
    return;
  }
  const lang = detectLang(text) ?? member.lang;
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text, source: "voice" });
  await d.messenger.send(member.chat_ref, copy(lang).heard(text));
}
