import type { DraftInfo, SiteState } from "@/src/domain/types";
import { publicSiteState } from "@/src/server/site";
import type { TemplateProps } from "@/src/templates";

/**
 * Props for the client template on the hosted /[slug] and /[slug]/menu pages. The state is the public feed's (no deploy
 * record, wizard draft or Instagram import), since everything passed to a client component lands in the page payload.
 * Templates never read those owner-only fields; a deployed site hands them the same public shape (templates/shell/app/feed.ts).
 */
export function templatePageProps(site: { state: SiteState; draft: DraftInfo | null }, slug: string, page: TemplateProps["page"], now: number): TemplateProps {
  return {
    state: publicSiteState(site.state) as unknown as SiteState,
    now,
    slug,
    page,
    draft: site.draft,
    live: site.draft === null,
    feedUrl: `/api/site/${encodeURIComponent(slug)}`,
  };
}
