import type { Media } from "@/src/domain/types";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";

export interface StepProps {
  id: string;
  draft: WizardDraft;
  /** Media rows; freshly uploaded ones carry a blob: public_url so they render before the CDN has them. */
  media: Media[];
  update: (patch: Partial<WizardDraft>) => void;
  addMedia: (m: Media, file: File) => void;
  /** PUBLIC_BASE_URL, for the "your site will be at" hint. */
  baseUrl: string;
  /** false without ANTHROPIC_API_KEY: AI controls render an explanation instead. */
  aiAvailable: boolean;
  /**
   * Errors to show next to their fields: the server's rejections from autosave (e.g. slug taken) plus, after a blocked
   * Next, this step's validation errors. Paths are validateForPublish paths (`name`, `categories.0.items.1.price_eur`).
   */
  fieldErrors: PublishError[];
}
