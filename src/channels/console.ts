import { proposalButtons, type Messenger } from "../bot/messenger";
import { maskRef } from "./ref";
import type { Lang } from "../domain/types";

/** Prints instead of sending: offline e2e, smoke --dry, and the Meta channels in memory mode when no tokens are set. */
export class ConsoleMessenger implements Messenger {
  private n = 0;
  constructor(private log: (line: string) => void = (l) => console.log(l)) {}
  async send(chatRef: string, text: string) {
    this.log(`→ [${maskRef(chatRef)}] ${text}`);
    return `c${++this.n}`;
  }
  async sendProposal(chatRef: string, text: string, _setId: string, lang: Lang) {
    this.log(`→ [${maskRef(chatRef)}] ${text}\n   ${proposalButtons(lang).map((b) => `[${b.label}]`).join(" ")}`);
    return `c${++this.n}`;
  }
  async sendPhoto(chatRef: string, url: string, caption?: string) {
    this.log(`→ [${maskRef(chatRef)}] 🖼 ${url}${caption ? `\n   ${caption}` : ""}`);
    return `c${++this.n}`;
  }
  async conclude(chatRef: string, messageRef: string | null, _full: string, short: string) {
    this.log(`✎ [${maskRef(chatRef)}#${messageRef ?? "-"}] ${short}`);
  }
  async typing() {}
}
