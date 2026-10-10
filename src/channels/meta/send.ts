import { proposalButtons, type Messenger } from "../../bot/messenger";
import type { Lang } from "../../domain/types";
import { parseRef } from "../ref";
import { splitText, proposalParts } from "../text";
import { graphPost } from "./graph";

const TEXT_MAX = 2000;   // Messenger limit; Instagram allows 1000, so Instagram refs use 1000
const BUTTON_TEXT_MAX = 640;

export class MetaMessenger implements Messenger {
  private fetchFn: typeof fetch;
  constructor(private o: { pageToken: string; fetch?: typeof fetch }) { this.fetchFn = o.fetch ?? fetch; }
  private post(body: unknown, what: string) { return graphPost(this.fetchFn, "me/messages", this.o.pageToken, body, what); }
  private max(chatRef: string) { return parseRef(chatRef).channel === "ig" ? 1000 : TEXT_MAX; }

  async send(chatRef: string, text: string): Promise<string | null> {
    const id = parseRef(chatRef).id;
    let last: string | null = null;
    for (const chunk of splitText(text, this.max(chatRef))) {
      const r = await this.post({ recipient: { id }, messaging_type: "RESPONSE", message: { text: chunk } }, "send");
      if (!r) return null;
      last = typeof r.message_id === "string" ? r.message_id : last;
    }
    return last;
  }
  async sendProposal(chatRef: string, text: string, setId: string, lang: Lang): Promise<string | null> {
    const id = parseRef(chatRef).id;
    const { lead, ask } = proposalParts(text, BUTTON_TEXT_MAX);
    if (lead && (await this.send(chatRef, lead)) === null) return null;
    const buttons = proposalButtons(lang).map((b) => ({ type: "postback", title: b.label, payload: `cs:${b.id}:${setId}` }));
    const r = await this.post({ recipient: { id }, messaging_type: "RESPONSE", message: { attachment: { type: "template", payload: { template_type: "button", text: ask, buttons } } } }, "sendProposal");
    return r && typeof r.message_id === "string" ? r.message_id : null;
  }
  async conclude(chatRef: string, _messageRef: string | null, _full: string, short: string): Promise<void> {
    await this.send(chatRef, short);
  }
  async typing(chatRef: string): Promise<void> {
    await this.post({ recipient: { id: parseRef(chatRef).id }, sender_action: "typing_on" }, "typing");
  }
}
