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
  async send(chatRef: string, text: string): Promise<string | null> {
    const to = parseRef(chatRef).id;
    let last: string | null = null;
    for (const chunk of splitText(text, TEXT_MAX)) {
      const r = await this.post({ recipient_type: "individual", to, type: "text", text: { body: chunk, preview_url: false } }, "send");
      if (!r) return null;
      last = WhatsAppMessenger.id(r) ?? last;
    }
    return last;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const to = parseRef(chatRef).id;
    const { lead, ask } = proposalParts(text, BODY_MAX);
    if (lead && (await this.send(chatRef, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "reply", reply: { id: `cs:${b.id}:${setId}`, title: b.label.slice(0, 20) } }));
    return WhatsAppMessenger.id(await this.post({ recipient_type: "individual", to, type: "interactive", interactive: { type: "button", body: { text: ask }, action: { buttons } } }, "sendProposal"));
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string): Promise<void> {
    await this.send(chatRef, short);
  }
  async typing(_chatRef: string, inReplyTo?: string): Promise<void> {
    if (!inReplyTo) return;
    await this.post({ status: "read", message_id: inReplyTo, typing_indicator: { type: "text" } }, "typing");
  }
}
