// src/domain/social-preview.ts
// Preview lines for social_post rows (a photo published to Facebook and/or Instagram). Pure; both languages; undo-safe
// (the inverted row has after = null and reads as a removal).
import { quote, tr } from "./format";
import type { Change, Lang, Row, SocialTarget } from "./types";

const FORMAT: Record<"post" | "story", { bg: string; en: string }> = {
  post: { bg: "пост", en: "post" },
  story: { bg: "история", en: "story" },
};

/** "Facebook (пост, история), Instagram (пост)" from the row's targets, Facebook first, post before story. */
export function socialTargetsText(targets: readonly SocialTarget[], lang: Lang): string {
  const parts: string[] = [];
  for (const [network, name] of [["facebook", "Facebook"], ["instagram", "Instagram"]] as const) {
    const formats = (["post", "story"] as const).filter((f) => targets.includes(`${network}_${f}` as SocialTarget));
    if (formats.length) parts.push(`${name} (${formats.map((f) => FORMAT[f][lang]).join(", ")})`);
  }
  return parts.join(", ");
}

function targetsOf(row: Row): SocialTarget[] {
  return Array.isArray(row.targets) ? (row.targets as SocialTarget[]) : [];
}

export function socialPreviewLines(c: Change, lang: Lang): string[] {
  if (c.after === null) {
    return [`• ${tr(lang, "Премахва публикацията", "Removes the post")}: ${socialTargetsText(targetsOf(c.before ?? {}), lang)}`];
  }
  const lines = [`• ${tr(lang, "Публикация", "Post")}: ${socialTargetsText(targetsOf(c.after), lang)}`];
  const caption = typeof c.after.caption === "string" ? c.after.caption.trim() : "";
  if (caption) lines.push(...quote(caption, lang).split("\n").map((l) => `  ${l}`));
  return lines;
}
