import type { Media } from "@/src/domain/types";
import type { AppChannel } from "@/src/server/connect-apps";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";

/** How the Instagram sign-in came back (`?ig=` on /new/<id>), for the step the flow started from. */
export interface IgReturn {
  status: "ok" | "cancelled" | "error";
  /** The callback's error reason (`state`, `session`, `token`, `media`) when status is error. */
  reason?: string;
  step: "photos" | "look";
}

export interface StepProps {
  id: string;
  draft: WizardDraft;
  /** Media rows; freshly uploaded ones carry a blob: public_url so they render before the CDN has them. */
  media: Media[];
  update: (patch: Partial<WizardDraft>) => void;
  /** A new media row; `file` (a fresh upload) gives it a local preview until the CDN has it. */
  addMedia: (m: Media, file?: File) => void;
  /** PUBLIC_BASE_URL, for the "your site will be at" hint. */
  baseUrl: string;
  /** false without ANTHROPIC_API_KEY: AI controls render an explanation instead. */
  aiAvailable: boolean;
  /**
   * Errors to show next to their fields: the server's rejections from autosave (e.g. slug taken) plus, after a blocked
   * Next, this step's validation errors. Paths are validateForPublish paths (`name`, `categories.0.items.1.price_eur`).
   */
  fieldErrors: PublishError[];
  /** The messaging apps this server answers (enabledApps); the Review lead names Telegram only when it is the one app. Default: Telegram only. */
  apps?: AppChannel[];
  /** false without INSTAGRAM_APP_ID/SECRET: the Instagram import is not shown. */
  instagramAvailable?: boolean;
  igReturn?: IgReturn | null;
  /** Called once the step has read `igReturn`; the wizard then drops it, so revisiting the step does not show it again. */
  onIgConsumed?: () => void;
  /** Sends pending autosave edits now (before leaving for Instagram, before an import patches the draft on the server). */
  flush?: () => Promise<boolean>;
  /** A website add-on on an existing business: its address is fixed, so the address field is read-only. */
  slugLocked?: boolean;
}
