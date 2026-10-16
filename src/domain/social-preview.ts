// src/domain/social-preview.ts
// Preview lines for social_post rows (a photo published to Facebook and/or Instagram) and the pictures shown with them: the
// exact file each place will publish. Pure; both languages; undo-safe (the inverted row has after = null and reads as a removal).
import { quote, tr } from "./format";
import { NETWORK_NAMES, type Change, type Lang, type Row, type SocialPostRow, type SocialTarget } from "./types";

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
  // Stories carry no text: when a captioned post goes out together with a story, say so (last line). `caption` is already empty for a story-only row.
  if (caption && targets.some((t) => t.endsWith("_story"))) lines.push(`  (${tr(lang, "историите се публикуват без текст", "stories are published without text")})`);
  return lines;
}

/** The file one place publishes: the Instagram post its padded copy, the Facebook post the original, a story its 9:16 copy; the original when there is no copy. */
function publishedUrl(row: SocialPostRow, network: "facebook" | "instagram", format: "post" | "story"): string {
  if (format === "story") return row.story_image_url ?? row.image_url;
  return network === "instagram" ? (row.ig_feed_image_url ?? row.image_url) : row.image_url;
}

/**
 * The pictures the owner approves, labelled "Instagram + Facebook post": one per file, so places that publish the same file
 * share one picture and name both networks. Posts come before stories, Instagram before Facebook. Pure; the caller sends them.
 */
export function previewPictures(row: SocialPostRow, lang: Lang): { url: string; label: string }[] {
  const pictures: { url: string; label: string }[] = [];
  for (const format of ["post", "story"] as const) {
    const networksByUrl = new Map<string, string[]>();
    for (const network of ["instagram", "facebook"] as const) {
      if (!row.targets.includes(`${network}_${format}` as SocialTarget)) continue;
      const url = publishedUrl(row, network, format);
      networksByUrl.set(url, [...(networksByUrl.get(url) ?? []), NETWORK_NAMES[network]]);
    }
    for (const [url, names] of networksByUrl) pictures.push({ url, label: `${names.join(" + ")} ${FORMAT[format][lang]}` });
  }
  return pictures;
}
