// src/bot/inbound.ts
// Channel-agnostic owner messages. Telegram (bot.ts) and the Meta webhook (server/meta.ts) both translate into InboundMessage and call handleInbound.
import { followsAgentReply, holdPhoto } from "../agent/memory";
import { PHOTO_NO_CAPTION } from "../agent/prompt";
import type { ImageInput } from "../agent/run";
import { channelOf, isMetaChannel, maskRef, type Channel } from "../channels/ref";
import { baseLang, countLatinWords, countWords, detectScriptLang, isLatinText, isMarkerlessCyrillic } from "../domain/format";
import type { ChatLang, Member } from "../domain/types";
import { handleDecision, parseCallback } from "./approvals";
import type { BotDeps } from "./bot";
import { copy } from "./copy";
import { adminUrl, publicUrl } from "./links";
import { imageMediaType, MAX_IMAGE_BYTES } from "./media";
import { memberViews, openInviteViews } from "./members";
import { audioContentType } from "./voice";

export interface InboundMedia {
  download: () => Promise<{ bytes: Uint8Array; contentType: string; name?: string }>;
}
export interface InboundMessage {
  chatRef: string;
  kind: "text" | "voice" | "photo" | "button";
  /** Body, caption, or button data ("cs:apply:<id>"). */
  text?: string;
  /** Telegram's language_code as a conversation language ("pt-BR" → "pt", bot.ts); absent on Meta. */
  langHint?: ChatLang;
  media?: InboundMedia;
  /** The message a button belongs to / the inbound id (WhatsApp typing). */
  messageRef?: string;
  /** m.me / ig.me ?ref=, wa.me ?text= */
  referralCode?: string;
  /** Platform message id, for dedupe. */
  eventId?: string;
}

const CODE = /^[A-Z0-9-]{8,}$/;
/** Addresses a message carries. They are not the owner's language: "https://my-open-cafe.bg" would count "my" and "open" as English. */
const LINKS = /https?:\/\/\S+|www\.\S+/gi;
const withoutLinks = (text: string) => text.replace(LINKS, " ");
/** The language a member's text shows by its letters (detectScriptLang with their stored language), not counting its links. */
const scriptLangOf = (text: string, current: ChatLang): ChatLang | null => detectScriptLang(withoutLinks(text), current);
/** Words a text needs before the classifier is asked about it; shorter text (a dish name, "ok", "make it a story") goes by its letters. */
const CLASSIFY_MIN_WORDS = 4;
/** The classifier gets at most this many characters of a message: enough to name its language. */
const CLASSIFY_MAX_CHARS = 300;

/**
 * Whether the classifier, not the letters, names the language of these words (links removed):
 * - Latin-only text of four words or more: German or Dutch can hold two of the English words ("Ich will den Preis in der Karte
 *   ändern"), so the English word list cannot decide it;
 * - Cyrillic without a marker letter, of four words or more in any script, from a member stored in a language other than
 *   Bulgarian: Bulgarian has no letter Russian lacks, so a Bulgarian owner stored as ru (a Russian Telegram) could never get
 *   back to bg by the letters. A member stored as bg is never asked about: their marker-less Cyrillic stays Bulgarian.
 */
function asksClassifier(prose: string, current: ChatLang): boolean {
  if (isLatinText(prose)) return countLatinWords(prose) >= CLASSIFY_MIN_WORDS;
  return current !== "bg" && isMarkerlessCyrillic(prose) && countWords(prose) >= CLASSIFY_MIN_WORDS;
}

/**
 * The language of the owner's own words (a message, a photo caption, a command word), not counting links. When asksClassifier
 * says so, the classifier names it from the first 300 characters (one small-model call, src/bot/lang-classify.ts), English
 * included. Without its answer ("unknown", a failure, a timeout, no classifier) and for everything else the letters decide
 * (detectScriptLang with the stored language: the English word list for Latin text, and marker-less Cyrillic keeps a ru, uk,
 * be, mk or sr member's language). null keeps the stored language. A failing classifier never costs the message.
 */
async function languageOf(d: BotDeps, text: string, current: ChatLang): Promise<ChatLang | null> {
  const prose = withoutLinks(text).trim();
  const byLetters = detectScriptLang(prose, current);
  if (!d.classifyLang || !asksClassifier(prose, current)) return byLetters;
  try {
    return (await d.classifyLang(Array.from(prose).slice(0, CLASSIFY_MAX_CHARS).join(""))) ?? byLetters;
  } catch (e) {
    console.error(`[bot] language classifier failed: ${e instanceof Error ? e.name : "error"}`); // never the owner's words
    return byLetters;
  }
}
const COMMANDS = new Set(["lang", "help", "menu", "undo", "connect", "members"]);
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
  // Telegram tells us the language (any: "pt"); on Meta the letters do (never the classifier: this may be a stranger) and other
  // prose is English. A code, a link or nothing says nothing: Bulgarian.
  const prose = withoutLinks(text);
  const uiLang: ChatLang = m.langHint ?? detectScriptLang(prose) ?? (code === null && /\p{L}/u.test(prose) ? "en" : "bg");
  if (code !== null) {
    // A code is tried first, even from a linked chat: the owner may be setting up another venue (the demo phone, a second
    // café). redeemInvite moves the chat to the code's venue. Only without a usable code does a linked chat get welcome-back.
    const linked = code ? await d.store.redeemInvite(code, m.chatRef, uiLang, now.toISOString()) : null;
    if (!linked) {
      if (member) await welcomeBack(d, member);
      else await say(code ? copy(baseLang(uiLang)).badCode : copy(baseLang(uiLang)).noAccess(channel));
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
    await say(copy(baseLang(uiLang)).noAccess(channel));
    return;
  }

  if (m.kind === "text") {
    if (!text) {
      await welcomeBack(d, member); // opened the chat (Get Started) with nothing to say
      return;
    }
    const cmd = normalizeCommand(text, channel);
    if (cmd) {
      // A command word ("помощ", "menu") is the owner's words and shows a language like any message. A slash command shows none
      // (/connect's arguments are a link and a code), and a language word ("език en") sets the language it names.
      const commandWord = !text.startsWith("/") && splitCommand(cmd).name !== "lang";
      await runCommand(d, commandWord ? await followLanguage(d, member, await languageOf(d, text, member.lang)) : member, channel, cmd);
      return;
    }
    // The owner's language, saved before the run so that what Claudia sends on its own later follows it.
    const speaker = await followLanguage(d, member, await languageOf(d, text, member.lang));
    // Start first: a failed acknowledgement must not lose the message.
    d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: speaker, text, source: "text", replyTo: m.messageRef });
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

/**
 * The member's stored language is the language of their last message that showed one: when `detected` is a language other than
 * the stored one, it is saved and the member comes back with it, so the run and everything Claudia sends on its own (reminders,
 * digests, proposals; they read the stored language) follow. null (a price, an emoji, a caption-less photo) changes nothing and
 * costs no store call. Best-effort like touch(): a failed save is logged and never loses the message, the turn still runs in the
 * language just written.
 */
export async function followLanguage(d: BotDeps, member: Member, detected: ChatLang | null): Promise<Member> {
  if (detected === null || detected === member.lang) return member;
  try {
    await d.store.setMemberLang(member.venue_id, member.chat_ref, detected);
  } catch (e) {
    console.error(`[bot] setMemberLang failed for ${maskRef(member.chat_ref)}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { ...member, lang: detected };
}

/** `previous` is the chat's membership before the redeem (null for a new chat). */
async function welcome(d: BotDeps, member: Member, previous: Member | null) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(baseLang(member.lang));
  if (previous && previous.venue_id !== member.venue_id) await d.messenger.send(member.chat_ref, c.switched(venue.name));
  // An own site (built and hosted elsewhere, reads our feed) is the site the owner and staff know.
  const site = venue.site_url || publicUrl(d.baseUrl, venue.slug);
  if (member.role === "owner") {
    await d.messenger.send(member.chat_ref, c.welcome(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id)), site, channelOf(member.chat_ref)));
    if (venue.site_url) await d.messenger.send(member.chat_ref, c.ownSite(venue.site_url));
    if (d.onOwnerJoined) {
      // The first owner join is the human check that publishes the site; startDeploy ignores venues that already have one
      // and venues with their own site (nothing to publish, so no "being published" line either).
      if (!venue.site_url && venue.status === "live" && venue.deploy === null) await d.messenger.send(member.chat_ref, c.publishing);
      try {
        d.onOwnerJoined(venue.id);
      } catch (e) {
        console.error("[bot] onOwnerJoined failed:", e instanceof Error ? e.message : e);
      }
    }
  } else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, site));
}

async function welcomeBack(d: BotDeps, member: Member) {
  const venue = await d.store.getVenue(member.venue_id);
  const c = copy(baseLang(member.lang));
  if (member.role === "owner") await d.messenger.send(member.chat_ref, c.welcomeBack(venue.name, adminUrl(d.baseUrl, venue.slug, await d.store.getAdminToken(venue.id))));
  else await d.messenger.send(member.chat_ref, c.welcomeStaff(venue.name, publicUrl(d.baseUrl, venue.slug)));
}

async function runCommand(d: BotDeps, member: Member, channel: Channel, cmd: string) {
  const { name, arg } = splitCommand(cmd);
  const lang = baseLang(member.lang);
  const c = copy(lang);
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
      // An own-site venue (site_url) is linked as is: its site may not have a /menu path. Hosted venues get site and menu.
      const hosted = publicUrl(d.baseUrl, venue.slug);
      await d.messenger.send(member.chat_ref, venue.site_url ? c.menu(venue.site_url, null, admin) : c.menu(hosted, `${hosted}/menu`, admin));
      return;
    }
    case "connect": {
      // The arguments are a link and a code: no language to detect, none saved. The reply is in the owner's stored language.
      if (member.role !== "owner") {
        await d.messenger.send(member.chat_ref, c.connectOwnerOnly);
        return;
      }
      const [siteUrl, code] = arg.split(/\s+/);
      if (!siteUrl || !code) {
        await d.messenger.send(member.chat_ref, c.connectUsage);
        return;
      }
      if (!d.connect) {
        await d.messenger.send(member.chat_ref, c.connectUnavailable);
        return;
      }
      const r = await d.connect(member.venue_id, siteUrl, code);
      await d.messenger.send(member.chat_ref, r.ok ? c.connectOk(r.site.name, String(r.destination.config.site_url)) : c.connectFailed(lang === "bg" ? r.reason.bg : r.reason.en));
      return;
    }
    case "members": {
      // Owner-only and read-only: removing access stays with the operator scripts (member:remove, invite:cancel).
      if (member.role !== "owner") {
        await d.messenger.send(member.chat_ref, c.membersOwnerOnly);
        return;
      }
      const venue = await d.store.getVenue(member.venue_id);
      const [members, invites] = await Promise.all([d.store.listMembers(venue.id), d.store.listInvites(venue.id, d.now().toISOString())]);
      await d.messenger.send(member.chat_ref, c.members(venue.name, memberViews(members, lang, venue.tz, member.chat_ref), openInviteViews(invites, lang, venue.tz)));
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

async function handlePhoto(d: BotDeps, stored: Member, m: InboundMessage) {
  const caption = (m.text ?? "").trim();
  // The caption is the owner's words: its language is saved first, so even the download error below comes in it. No caption, no change.
  const member = await followLanguage(d, stored, await languageOf(d, caption, stored.lang));
  const c = copy(baseLang(member.lang));
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
  const image = { data: Buffer.from(bytes).toString("base64"), media_type };
  if (!caption) {
    // Right after the agent's reply ("send me the photo") the photo is part of that conversation: the agent sees it now and goes
    // on, or asks. Otherwise there are no instructions yet: hold it for the owner's next message (often a voice note).
    // Either way it is held first, so the rest of an album joins it instead of starting turns or questions of its own.
    const follows = await followsAgentReply(d.store, member.venue_id, member.chat_ref, d.now());
    if (!(await holdPhoto(d.store, member.venue_id, member.chat_ref, media.id, follows ? "" : c.photoWaiting, d.now()))) return;
    if (!follows) {
      await d.messenger.send(member.chat_ref, c.photoWaiting);
      return;
    }
  }
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member, text: caption || PHOTO_NO_CAPTION, source: "photo", image, mediaId: media.id, replyTo: m.messageRef });
  await d.messenger.typing(member.chat_ref, m.messageRef);
}

async function handleVoice(d: BotDeps, member: Member, m: InboundMessage) {
  const c = copy(baseLang(member.lang));
  if (!d.transcribe) {
    await d.messenger.send(member.chat_ref, c.voiceUnavailable);
    return;
  }
  let text: string;
  try {
    if (!m.media) throw new Error("no media");
    const dl = await m.media.download();
    text = (await d.transcribe(dl.bytes, baseLang(member.lang), audioContentType(dl.contentType, dl.name))).trim();
  } catch (e) {
    console.error(`[bot] voice failed: ${e instanceof Error ? e.message : String(e)}`);
    await d.messenger.send(member.chat_ref, c.voiceFailed);
    return;
  }
  if (!text) {
    await d.messenger.send(member.chat_ref, c.voiceFailed);
    return;
  }
  // A transcript is read by its letters only; it never goes to the classifier.
  const speaker = await followLanguage(d, member, scriptLangOf(text, member.lang));
  d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: speaker, text, source: "voice", replyTo: m.messageRef });
  await d.messenger.send(member.chat_ref, copy(baseLang(speaker.lang)).heard(text));
}
