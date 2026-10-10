// Owner identity across channels: "<channel>:<id>". The id is the platform's own (Telegram chat id, Messenger PSID, Instagram-scoped id, WhatsApp phone digits).
export type Channel = "tg" | "fb" | "ig" | "wa";

const ID = /^[A-Za-z0-9_.-]+$/;
const REF = /^(tg|fb|ig|wa):([A-Za-z0-9_.-]+)$/;

export function makeRef(channel: Channel, id: string | number): string {
  const s = String(id).trim();
  if (!ID.test(s)) throw new Error("bad channel id");
  return `${channel}:${s}`;
}
export function parseRef(ref: string): { channel: Channel; id: string } {
  const m = REF.exec(ref);
  if (!m) throw new Error(`malformed chat_ref: ${ref}`);
  return { channel: m[1] as Channel, id: m[2] };
}
export function channelOf(ref: string): Channel {
  return parseRef(ref).channel;
}
export function isMetaChannel(c: Channel): boolean {
  return c !== "tg";
}
/** The numeric Telegram id for the legacy bigint columns; null for every other channel. Remove in the phase-2 code cleanup, before the migration runs. */
export function legacyTelegramId(ref: string | null): number | null {
  if (ref === null) return null;
  const { channel, id } = parseRef(ref);
  return channel === "tg" ? Number(id) : null;
}
