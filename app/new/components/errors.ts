import type { Lang } from "@/src/domain/types";
import type { PublishError } from "@/src/wizard/schema";

/** The message for one field (exact validation path), in the wizard's language; undefined when the field is fine. */
export function fieldError(errors: readonly PublishError[], path: string, lang: Lang): string | undefined {
  const e = errors.find((x) => x.path === path);
  return e ? (lang === "bg" ? e.bg : e.en) : undefined;
}
