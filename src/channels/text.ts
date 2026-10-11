export function splitText(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}
/** A proposal is "<preview>\n\n<question>"; when it does not fit, the preview goes first as plain text and only the question carries the buttons. */
export function proposalParts(text: string, max: number): { lead: string | null; ask: string } {
  if (text.length <= max) return { lead: null, ask: text };
  const i = text.lastIndexOf("\n\n");
  if (i <= 0) return { lead: text.slice(0, -max).trim() || null, ask: text.slice(-max).trim() };
  return { lead: text.slice(0, i).trim(), ask: text.slice(i + 2).trim() };
}
