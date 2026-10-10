import type { Messenger, SendOpts } from "../bot/messenger";
import type { Lang } from "../domain/types";
import type { Store } from "../store/types";
import { channelOf, isMetaChannel, type Channel } from "./ref";

/** Meta's customer-service window is 24 h; one hour of margin. */
export const PROACTIVE_WINDOW_MS = 23 * 3_600_000;

/** Dispatches by chat_ref prefix; proactive sends on Meta channels go out only inside the window since the owner's last message. Never throws. */
export class ChannelRouter implements Messenger {
  private warned = new Set<Channel>();
  constructor(private o: { store: Store; now: () => Date; adapters: Partial<Record<Channel, Messenger>> }) {}
  private pick(chatRef: string): Messenger | null {
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
    return a ?? null;
  }
  private async allowed(chatRef: string, opts?: SendOpts): Promise<boolean> {
    if (!opts?.proactive || !isMetaChannel(channelOf(chatRef))) return true;
    const m = await this.o.store.findMember(chatRef);
    const seen = m?.last_seen_at ? Date.parse(m.last_seen_at) : Number.NEGATIVE_INFINITY;
    if (this.o.now().getTime() - seen <= PROACTIVE_WINDOW_MS) return true;
    console.log(`[router] skipped proactive ${chatRef}: outside 24h window`);
    return false;
  }
  async send(chatRef: string, text: string, opts?: SendOpts) {
    const a = this.pick(chatRef);
    if (!a || !(await this.allowed(chatRef, opts))) return null;
    return a.send(chatRef, text, opts);
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang) {
    return (await this.pick(chatRef)?.sendProposal(chatRef, text, setId, lang)) ?? null;
  }
  async conclude(chatRef: string, messageRef: string | null, full: string, short: string, opts?: SendOpts) {
    const a = this.pick(chatRef);
    if (a && (await this.allowed(chatRef, opts))) await a.conclude(chatRef, messageRef, full, short, opts);
  }
  async typing(chatRef: string, inReplyTo?: string) {
    await this.pick(chatRef)?.typing(chatRef, inReplyTo);
  }
}
