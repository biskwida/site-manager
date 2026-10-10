// What a click on a link inside the live preview should do. The preview is a picture of the site, not a way to leave
// the wizard: the template's Home/Menu links switch the preview page, in-page anchors scroll the frame, the rest is inert.
import { pageHref } from "@/src/templates/shared/links";

export type PreviewLinkAction = { kind: "page"; page: "home" | "menu" } | { kind: "hash"; id: string } | { kind: "ignore" };

export function previewLinkAction(href: string | null, slug: string): PreviewLinkAction {
  if (!href) return { kind: "ignore" };
  if (href.startsWith("#")) return href.length > 1 ? { kind: "hash", id: decodeURIComponent(href.slice(1)) } : { kind: "ignore" };
  const path = href.split(/[?#]/)[0];
  if (path === pageHref(slug, "home")) return { kind: "page", page: "home" };
  if (path === pageHref(slug, "menu")) return { kind: "page", page: "menu" };
  return { kind: "ignore" };
}
