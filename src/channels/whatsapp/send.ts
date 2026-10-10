import { proposalButtons, type Messenger } from "../../bot/messenger";
import type { Lang } from "../../domain/types";
import { graphPost } from "../meta/graph";
import { parseRef } from "../ref";
import { proposalParts, splitText } from "../text";

const TEXT_MAX = 4096;
const BODY_MAX = 1024;

export class WhatsAppMessenger implements Messenger {
  private fetchFn: typeof fetch;
  constructor(private o: { token: string; phoneNumberId: string; fetch?: typeof fetch }) { this.fetchFn = o.fetch ?? fetch; }
  private post(body: Record<string, unknown>, what: string) {
    return graphPost(this.fetchFn, `${this.o.phoneNumberId}/messages`, this.o.token, { messaging_product: "whatsapp", ...body }, what);
  }
  private static id(r: Record<string, unknown> | null): string | null {
    const first = r && Array.isArray(r.messages) ? (r.messages[0] as Record<string, unknown> | undefined) : undefined;
    return first && typeof first.id === "string" ? first.id : null;
  }
  /** The recipient phone digits; a malformed ref (e.g. a bad database row) is logged and yields null so callers never see a throw. */
  private to(chatRef: string, what: string): string | null {
    try {
      return parseRef(chatRef).id;
    } catch {
      console.error(`[meta] ${what} failed: malformed chat_ref`);
      return null;
    }
  }
  private async sendText(to: string, text: string): Promise<string | null> {
    let last: string | null = null;
    for (const chunk of splitText(text, TEXT_MAX)) {
      const r = await this.post({ recipient_type: "individual", to, type: "text", text: { body: chunk, preview_url: false } }, "send");
      if (!r) return null;
      last = WhatsAppMessenger.id(r) ?? last;
    }
    return last;
  }

  async send(chatRef: string, text: string): Promise<string | null> {
    const to = this.to(chatRef, "send");
    return to ? this.sendText(to, text) : null;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const to = this.to(chatRef, "sendProposal");
    if (!to) return null;
    const { lead, ask } = proposalParts(text, BODY_MAX);
    if (lead && (await this.sendText(to, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "reply", reply: { id: `cs:${b.id}:${setId}`, title: b.label.slice(0, 20) } }));
    return WhatsAppMessenger.id(await this.post({ recipient_type: "individual", to, type: "interactive", interactive: { type: "button", body: { text: ask }, action: { buttons } } }, "sendProposal"));
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string): Promise<void> {
    const to = this.to(chatRef, "conclude");
    if (to) await this.sendText(to, short);
  }
  /** WhatsApp's typing indicator is tied to an inbound message id (it also marks it read); without one there is nothing to send. */
  async typing(_chatRef: string, inReplyTo?: string): Promise<void> {
    if (!inReplyTo) return;
    await this.post({ status: "read", message_id: inReplyTo, typing_indicator: { type: "text" } }, "typing");
  }
}
