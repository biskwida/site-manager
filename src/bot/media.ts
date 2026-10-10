// src/bot/media.ts
import type { Bot, Context } from "grammy";
import type { ImageInput } from "../agent/run";
import { detectLang } from "../domain/format";
import type { BotDeps } from "./bot";
import { requireMember } from "./bot";
import { copy } from "./copy";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The URL carries the bot token: it is built here, used once, and never logged or put in an error. */
export async function downloadTelegramFile(token: string, filePath: string, fetchFn: typeof fetch = fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetchFn(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`file too large (${buf.byteLength} bytes)`);
  return { bytes: buf, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

const IMAGE_TYPES: ImageInput["media_type"][] = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const UNINFORMATIVE_TYPES = ["", "application/octet-stream", "binary/octet-stream"];

export function imageMediaType(contentType: string, filePath: string): ImageInput["media_type"] | null {
  const ct = contentType.split(";")[0].trim().toLowerCase();
  if ((IMAGE_TYPES as string[]).includes(ct)) return ct as ImageInput["media_type"];
  if (ct.startsWith("image/")) return "image/jpeg";
  // Only an uninformative header lets the extension decide; a definite non-image type is refused.
  if (!UNINFORMATIVE_TYPES.includes(ct)) return null;
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg" || ext === undefined || !filePath.includes(".")) return "image/jpeg";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function registerMediaHandlers(bot: Bot, d: BotDeps): void {
  const handleImage = async (ctx: Context, fileId: string, caption: string | undefined) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const lang = detectLang(caption ?? "") ?? member.lang;
    const c = copy(lang);
    let media_type: ImageInput["media_type"] | null;
    let bytes: Uint8Array;
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      bytes = dl.bytes;
      media_type = imageMediaType(dl.contentType, file.file_path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[bot] image download failed: ${msg}`);
      await ctx.reply(/too large/.test(msg) ? c.photoTooBig : c.photoFailed);
      return;
    }
    if (!media_type) {
      await ctx.reply(c.photoFailed);
      return;
    }
    const media = await d.store.saveMedia(member.venue_id, bytes, media_type);
    d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text: caption ?? "", source: "photo", image: { data: toBase64(bytes), media_type }, mediaId: media.id });
    await ctx.replyWithChatAction("typing").catch(() => undefined);
  };

  bot.on("message:photo", (ctx) => handleImage(ctx, ctx.message.photo.at(-1)!.file_id, ctx.message.caption));
  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("image/")) return;
    await handleImage(ctx, doc.file_id, ctx.message.caption);
  });

  const handleVoice = async (ctx: Context, fileId: string) => {
    const member = await requireMember(d, ctx);
    if (!member) return;
    const c = copy(member.lang);
    if (!d.transcribe) {
      await ctx.reply(c.voiceUnavailable);
      return;
    }
    let text: string;
    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("no file_path");
      const dl = await d.download(file.file_path);
      text = (await d.transcribe(dl.bytes, member.lang)).trim();
    } catch (e) {
      console.error(`[bot] voice failed: ${e instanceof Error ? e.message : String(e)}`);
      await ctx.reply(c.voiceFailed);
      return;
    }
    if (!text) {
      await ctx.reply(c.voiceFailed);
      return;
    }
    const lang = detectLang(text) ?? member.lang;
    d.startRun({ venueId: member.venue_id, chatRef: member.chat_ref, member: { ...member, lang }, text, source: "voice" });
    await ctx.reply(copy(lang).heard(text)).catch(() => undefined);
  };
  bot.on("message:voice", (ctx) => handleVoice(ctx, ctx.message.voice.file_id));
  bot.on("message:audio", (ctx) => handleVoice(ctx, ctx.message.audio.file_id));
}
