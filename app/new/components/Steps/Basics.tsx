"use client";
import { useState } from "react";
import { BUSINESS_TYPES } from "@/src/domain/types";
import { slugify } from "@/src/wizard/edit";
import { Fieldset, TextField } from "../Field";
import type { StepProps } from "../types";
import { useT } from "../useWizardText";

const CHIP = "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-panel px-4 text-sm font-semibold text-fg ring-1 ring-line-strong transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-sunken has-[:checked]:bg-fg has-[:checked]:text-canvas has-[:checked]:ring-fg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas";

export function Basics({ draft, update, baseUrl, serverErrors }: StepProps) {
  const { t, lang } = useT();
  const [slugTouched, setSlugTouched] = useState(draft.slug !== "");
  const host = baseUrl.replace(/^https?:\/\//, "");
  const slugErr = serverErrors.find((e) => e.path === "slug");
  return (
    <div className="grid gap-6">
      <TextField label={t("basics.name")} value={draft.name} required maxLength={80} autoComplete="organization" onChange={(name) => update(slugTouched ? { name } : { name, slug: slugify(name) })} />
      <TextField label={t("basics.slug")} value={draft.slug} required prefix={`${host}/`} inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={39}
        hint={t("basics.slugHint", { url: `${baseUrl}/${draft.slug || "…"}` })} error={slugErr ? (lang === "bg" ? slugErr.bg : slugErr.en) : undefined}
        onChange={(v) => { setSlugTouched(true); update({ slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "") }); }} />
      <Fieldset legend={t("basics.lang")}>
        <div className="grid gap-1">
          {(["bg", "en"] as const).map((l) => (
            <label key={l} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-1 text-base">
              <input type="radio" name="default_lang" value={l} checked={draft.default_lang === l} onChange={() => update({ default_lang: l })} className="size-5 accent-brand" />
              <span>{t(l === "bg" ? "basics.lang.bg" : "basics.lang.en")}</span>
            </label>
          ))}
        </div>
      </Fieldset>
      <Fieldset legend={t("basics.type")}>
        <div className="flex flex-wrap gap-2">
          {BUSINESS_TYPES.map((b) => (
            <label key={b} className={CHIP}>
              <input type="radio" name="business_type" value={b} checked={draft.business_type === b} onChange={() => update({ business_type: b })} className="sr-only" />
              {t(`basics.type.${b}` as "basics.type.cafe")}
            </label>
          ))}
        </div>
      </Fieldset>
      <div className="grid gap-6 border-t border-line pt-6">
        <TextField label={t("basics.address")} value={draft.address} maxLength={200} autoComplete="street-address" onChange={(address) => update({ address })} />
        <TextField label={t("basics.phone")} value={draft.phone} maxLength={40} type="tel" autoComplete="tel" onChange={(phone) => update({ phone })} />
        <TextField label={t("basics.instagram")} value={draft.instagram} maxLength={60} prefix="@" autoCapitalize="none" onChange={(v) => update({ instagram: v.replace(/^@/, "") })} />
        <TextField label={t("basics.mapsUrl")} value={draft.maps_url} maxLength={500} type="url" inputMode="url" hint={t("basics.mapsHint")} onChange={(maps_url) => update({ maps_url })} />
      </div>
    </div>
  );
}
