"use client";
import { useLang } from "@/src/i18n";
import { wizardText, type WizardKey } from "@/src/i18n/wizard";

export function useT() {
  const { lang } = useLang();
  return { lang, t: (key: WizardKey, vars?: Record<string, string | number>) => wizardText(lang, key, vars) };
}
