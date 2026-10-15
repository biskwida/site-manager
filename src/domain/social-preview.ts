// src/domain/social-preview.ts
// Preview lines for social_post rows (a photo published to Facebook and/or Instagram). Pure; both languages; undo-safe
// (the inverted row has after = null and reads as a removal).
import { quote, tr } from "./format";
import { NETWORK_NAMES, type Change, type Lang, type Row, type SocialTarget } from "./types";

const FORMAT: Record<"post" | "story", { bg: string; en: string }> = {
  post: { bg: "пост", en: "post" },
  story: { bg: "история", en: "story" },
};

/** "Facebook (пост, история), Instagram (пост)" from the row's targets, Facebook first, post before story. */
export function socialTargetsText(targets: readonly SocialTarget[], lang: Lang): string {
  const parts: string[] = [];
  for (const network of ["facebook", "instagram"] as const) {
    const name = NETWORK_NAMES[network];
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
  // A story-only row must not read as a post: a neutral label, and no caption (stories show none).
  const targets = targetsOf(c.after);
  const storyOnly = targets.length > 0 && targets.every((t) => t.endsWith("_story"));
  const lines = [`• ${storyOnly ? tr(lang, "Публикуване", "Publish") : tr(lang, "Публикация", "Post")}: ${socialTargetsText(targets, lang)}`];
  const caption = typeof c.after.caption === "string" && !storyOnly ? c.after.caption.trim() : "";
  if (caption) lines.push(...quote(caption, lang).split("\n").map((l) => `  ${l}`));
  const ratio = c.after.ig_feed_ratio;
  if (ratio === "4:5" || ratio === "1.91:1") lines.push(`  (${tr(lang, `за Instagram снимката е допълнена до формат ${ratio}`, `for Instagram the photo is padded to ${ratio}`)})`);
  return lines;
}
