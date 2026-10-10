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
  /** Field errors from the last failed autosave (e.g. slug taken). */
  serverErrors: PublishError[];
}
