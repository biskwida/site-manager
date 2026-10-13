// src/server/access.ts
// Who has access to a venue, for the operator scripts (member:list, member:remove, invite:cancel). Kept out of the scripts so it is tested.
// Never prints a whole invite code or a WhatsApp number: codes show their last 4 characters, numbers go through maskRef.
import { memberViews, openInviteViews } from "../bot/members";
import { maskRef, parseRef } from "../channels/ref";
import type { Role, Venue } from "../domain/types";
import type { Store } from "../store/types";
import { formatDateTime } from "../time";

/** "--slug coffique --ref tg:123456" → { slug, ref } (argv as process.argv: the first two entries are skipped). */
export function parseFlags(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 2; i < argv.length; i += 2) args.set(argv[i].replace(/^--/, ""), (argv[i + 1] ?? "").trim());
  return args;
}

/** undefined when absent, null when not a role. */
export function parseRole(v: string | undefined): Role | undefined | null {
  if (v === undefined) return undefined;
  return v === "owner" || v === "staff" ? v : null;
}

export async function memberListLines(store: Store, venue: Venue, now: Date): Promise<string[]> {
  const [members, invites] = await Promise.all([store.listMembers(venue.id), store.listInvites(venue.id, now.toISOString())]);
  const out = [`members of ${venue.slug} (${venue.name}), times in ${venue.tz}:`];
  const views = memberViews(members, "en", venue.tz);
  if (!views.length) out.push("  (none)");
  for (const m of views) {
    out.push(`  ${m.role.padEnd(5)}  ${m.channel.padEnd(9)}  ${m.ref.padEnd(20)}  ${m.lang}  ${(m.lastSeen ? `last seen ${m.lastSeen}` : "never wrote").padEnd(30)}  joined ${m.joined}`);
  }
  out.push("open invites:");
  const open = openInviteViews(invites, "en", venue.tz);
  if (!open.length) out.push("  (none)");
  for (const i of open) out.push(`  ${i.role.padEnd(5)}  expires ${i.expires}  code …${i.hint}`);
  return out;
}

/** "wa:…3456" (or "wa:...3456"), the form member:list prints for WhatsApp, resolved against this venue's members. */
const MASKED_WA = /^wa:(?:…|\.\.\.)(\d{4})$/;

export async function removeMemberByRef(store: Store, venue: Venue, refArg: string): Promise<{ ok: boolean; message: string }> {
  let ref = refArg.trim();
  const notMember = (shown: string) => ({ ok: false, message: `${shown} is not a member of ${venue.slug}; nothing removed. See who is: npm run member:list -- --slug ${venue.slug}` });
  const masked = MASKED_WA.exec(ref);
  if (masked) {
    const shown = `wa:…${masked[1]}`;
    const hits = (await store.listMembers(venue.id)).filter((m) => maskRef(m.chat_ref) === shown);
    if (hits.length > 1) return { ok: false, message: `${shown} matches ${hits.length} members of ${venue.slug}; pass the full number (wa:<digits>); nothing removed.` };
    if (!hits.length) return notMember(shown);
    ref = hits[0].chat_ref;
  } else {
    try {
      parseRef(ref);
    } catch {
      return { ok: false, message: `malformed ref "${ref}": use <channel>:<id>, e.g. --ref tg:123456 (channels: tg, fb, ig, wa)` };
    }
  }
  const member = await store.findMember(ref);
  if (!member || member.venue_id !== venue.id || !(await store.removeMember(venue.id, ref))) return notMember(maskRef(ref));
  const joined = formatDateTime(member.created_at, "en", venue.tz);
  const lines = [
    `removed ${member.role} ${maskRef(ref)} (${memberViews([member], "en", venue.tz)[0].channel}, ${member.lang}, joined ${joined}) from ${venue.slug}.`,
    "The bot now treats that chat as a stranger; its pending proposals can no longer be applied.",
  ];
  if (member.role === "owner" && !(await store.listMembers(venue.id)).some((m) => m.role === "owner")) {
    lines.push(`${venue.slug} has no owner linked now: nobody can approve changes from a chat until a new owner code is redeemed.`);
  }
  return { ok: true, message: lines.join("\n") };
}

export async function cancelInviteCodes(store: Store, venue: Venue, role?: Role): Promise<string> {
  const n = await store.cancelInvites(venue.id, role);
  return `cancelled ${n} unused ${role ? `${role} ` : ""}invite code${n === 1 ? "" : "s"} for ${venue.slug}`;
}
