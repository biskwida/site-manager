import type { Messenger, SendOpts } from "../bot/messenger";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { channelOf, isMetaChannel, maskRef, type Channel } from "./ref";

/** Meta's customer-service window is 24 h; one hour of margin. */
export const PROACTIVE_WINDOW_MS = 23 * 3_600_000;

/** Dispatches by chat_ref prefix; proactive sends on Meta channels go out only inside the window since the owner's last message. Never throws. */
export class ChannelRouter implements Messenger {
  private warned = new Set<Channel>();
  constructor(private o: { store: Store; now: () => Date; adapters: Partial<Record<Channel, Messenger>> }) {}
  private pick(chatRef: string): { a: Messenger; ch: Channel } | null {
    let ch: Channel;
    try {
      ch = channelOf(chatRef);
    } catch {
      console.error("[router] malformed chat_ref; message dropped");
      return null;
    }
    const a = this.o.adapters[ch];
    if (!a && !this.warned.has(ch)) {
      this.warned.add(ch);
      console.error(`[router] no adapter for channel ${ch}; messages to it are dropped`);
    }
    return a ? { a, ch } : null;
  }
  private async allowed(chatRef: string, ch: Channel, opts?: SendOpts): Promise<boolean> {
    if (!opts?.proactive || !isMetaChannel(ch)) return true;
    let seen = Number.NEGATIVE_INFINITY;
    try {
      const m = await this.o.store.findMember(chatRef);
      if (m?.last_seen_at) seen = Date.parse(m.last_seen_at);
    } catch (e) {
      console.error(`[router] proactive check failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (this.o.now().getTime() - seen <= PROACTIVE_WINDOW_MS) return true;
    console.log(`[router] skipped proactive ${maskRef(chatRef)}: outside 24h window`);
    return false;
  }
  async send(chatRef: string, text: string, opts?: SendOpts) {
    const p = this.pick(chatRef);
    if (!p || !(await this.allowed(chatRef, p.ch, opts))) return null;
    return p.a.send(chatRef, text, opts);
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    return (await this.pick(chatRef)?.a.sendProposal(chatRef, text, setId, lang)) ?? null;
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts) {
    const p = this.pick(chatRef);
    if (p && (await this.allowed(chatRef, p.ch, opts))) await p.a.conclude(chatRef, messageRef, full, short, opts);
  }
  async typing(chatRef: string, inReplyTo?: string) {
    await this.pick(chatRef)?.a.typing(chatRef, inReplyTo);
  }
  async edit(chatRef: string, messageRef: string, text: string) {
    await this.pick(chatRef)?.a.edit?.(chatRef, messageRef, text);
  }
  async remove(chatRef: string, messageRef: string) {
    await this.pick(chatRef)?.a.remove?.(chatRef, messageRef);
  }
}
