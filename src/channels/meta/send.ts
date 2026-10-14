import { proposalButtons, type Messenger } from "../../bot/messenger";
import type { Lang } from "../../domain/types";
import { parseRef, type Channel } from "../ref";
import { splitText, proposalParts } from "../text";
import { graphPost } from "./graph";

const TEXT_MAX = 2000;   // Messenger limit; Instagram allows 1000, so Instagram refs use 1000
const IG_TEXT_MAX = 1000;
const BUTTON_TEXT_MAX = 640;

type Ref = { channel: Channel; id: string };

export class MetaMessenger implements Messenger {
  private fetchFn: typeof fetch;
  constructor(private o: { pageToken: string; fetch?: typeof fetch }) { this.fetchFn = o.fetch ?? fetch; }
  private post(body: unknown, what: string) { return graphPost(this.fetchFn, "me/messages", this.o.pageToken, body, what); }
  /** Parses the chat ref; a malformed one (e.g. a bad database row) is logged and yields null so callers never see a throw. */
  private ref(chatRef: string, what: string): Ref | null {
    try {
      return parseRef(chatRef);
    } catch {
      console.error(`[meta] ${what} failed: malformed chat_ref`);
      return null;
    }
  }
  private async sendText(r: Ref, text: string): Promise<string | null> {
    let last: string | null = null;
    for (const chunk of splitText(text, r.channel === "ig" ? IG_TEXT_MAX : TEXT_MAX)) {
      const res = await this.post({ recipient: { id: r.id }, messaging_type: "RESPONSE", message: { text: chunk } }, "send");
      if (!res) return null;
      last = typeof res.message_id === "string" ? res.message_id : last;
    }
    return last;
  }

  async send(chatRef: string, text: string): Promise<string | null> {
    const r = this.ref(chatRef, "send");
    return r ? this.sendText(r, text) : null;
  }
  /** Messenger and Instagram show an image attachment without a caption, so the caption follows as text. */
  async sendPhoto(chatRef: string, url: string, caption?: string): Promise<string | null> {
    const r = this.ref(chatRef, "sendPhoto");
    if (!r) return null;
    const res = await this.post({ recipient: { id: r.id }, messaging_type: "RESPONSE", message: { attachment: { type: "image", payload: { url, is_reusable: false } } } }, "sendPhoto");
    if (!res) return null;
    if (caption) await this.sendText(r, caption);
    return typeof res.message_id === "string" ? res.message_id : null;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const r = this.ref(chatRef, "sendProposal");
    if (!r) return null;
    const { lead, ask } = proposalParts(text, BUTTON_TEXT_MAX);
    if (lead && (await this.sendText(r, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "postback", title: b.label, payload: `cs:${b.id}:${setId}` }));
    const res = await this.post({ recipient: { id: r.id }, messaging_type: "RESPONSE", message: { attachment: { type: "template", payload: { template_type: "button", text: ask, buttons } } } }, "sendProposal");
    return res && typeof res.message_id === "string" ? res.message_id : null;
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string): Promise<void> {
    const r = this.ref(chatRef, "conclude");
    if (r) await this.sendText(r, short);
  }
  async typing(chatRef: string): Promise<void> {
    const r = this.ref(chatRef, "typing");
    if (r) await this.post({ recipient: { id: r.id }, sender_action: "typing_on" }, "typing");
  }
}
