// src/bot/members.ts
// Who has access to a venue, in display form: shared by the owner's /members command (inbound.ts) and the member:list script (server/access.ts).
import { channelOf, maskRef, type Channel } from "../channels/ref";
import type { ChatLang, Lang, Member, Role } from "../domain/types";
import type { InviteSummary } from "../store/types";
import { formatDateTime } from "../time";

export const CHANNEL_NAMES: Record<Channel, string> = { tg: "Telegram", fb: "Messenger", ig: "Instagram", wa: "WhatsApp" };

export interface MemberView {
  role: Role;
  /** "Telegram", "WhatsApp", … */
  channel: string;
  /** The ref as logs show it (maskRef): a WhatsApp phone number keeps only its last four digits. */
  ref: string;
  /** The platform id part of `ref`, without the channel prefix. */
  id: string;
  /** The member's conversation language ("bg", "de"); /members shows it in capitals. */
  lang: ChatLang;
  /** Formatted in the venue's time zone; null when the member never wrote. */
  lastSeen: string | null;
  joined: string;
  /** The chat asking (the owner who sent /members). */
  you: boolean;
}
export interface InviteView {
  role: Role;
  expires: string;
  /** Last 4 characters of the code. */
  hint: string;
}

export function memberViews(members: Member[], lang: Lang, tz: string, selfRef?: string): MemberView[] {
  return members.map((m) => {
    const ref = maskRef(m.chat_ref);
    return {
      role: m.role,
      channel: CHANNEL_NAMES[channelOf(m.chat_ref)],
      ref,
      id: ref.slice(ref.indexOf(":") + 1),
      lang: m.lang,
      lastSeen: m.last_seen_at ? formatDateTime(m.last_seen_at, lang, tz) : null,
      joined: formatDateTime(m.created_at, lang, tz),
      you: m.chat_ref === selfRef,
    };
  });
}

/** Only codes that can still be redeemed (listInvites already drops expired ones). */
export function openInviteViews(invites: InviteSummary[], lang: Lang, tz: string): InviteView[] {
  return invites.filter((i) => !i.used).map((i) => ({ role: i.role, expires: formatDateTime(i.expires_at, lang, tz), hint: i.code_hint }));
}
