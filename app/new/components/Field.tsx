"use client";
import { useId, useState, type ComponentPropsWithRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { useT } from "./useWizardText";

interface Common {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
}

const SHELL = "rounded-xl bg-panel ring-1 ring-line transition-shadow duration-150 ease-out focus-within:ring-2 focus-within:ring-brand";
const SHELL_ERR = "rounded-xl bg-panel ring-2 ring-danger transition-shadow duration-150 ease-out";

export function TextField({ label, hint, error, value, onChange, prefix, className = "", ...rest }: Common & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "prefix">) {
  const { t } = useT();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
        {rest.required && <span className="sr-only"> ({t("a11y.required")})</span>}
      </label>
      <div className={`flex min-h-11 items-stretch ${error ? SHELL_ERR : SHELL}`}>
        {prefix && <span className="flex shrink-0 items-center pl-3.5 text-sm text-fg-soft" aria-hidden="true">{prefix}</span>}
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}
          className={`sm-field w-full min-w-0 flex-1 bg-transparent py-2 text-base text-fg outline-none placeholder:text-fg-soft/70 ${prefix ? "pl-0.5 pr-3.5" : "px-3.5"}`} {...rest} />
      </div>
      {hint && <p id={hintId} className="text-sm leading-snug text-fg-soft [overflow-wrap:anywhere]">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

export function TextArea({ label, hint, error, value, onChange, className = "", ...rest }: Omit<Common, "prefix"> & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`grid gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">{label}</label>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rest.rows ?? 3} aria-describedby={[hintId, errId].filter(Boolean).join(" ") || undefined} aria-invalid={error ? true : undefined}
        className={`sm-field min-h-11 w-full min-w-0 resize-y px-3.5 py-2.5 text-base leading-relaxed text-fg outline-none placeholder:text-fg-soft/70 ${error ? SHELL_ERR : SHELL} focus:ring-2 focus:ring-brand`} {...rest} />
      {hint && <p id={hintId} className="text-sm leading-snug text-fg-soft">{hint}</p>}
      {error && <p id={errId} role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

/** Price in euro as text with a decimal keyboard: a number input drops "1." mid-typing and refuses "1,80", which is how Bulgarians write it. */
/** Two decimals with the language's separator: 1,80 in Bulgarian, 1.80 in English. */
export function formatPriceInput(value: number, lang: "bg" | "en"): string {
  if (!Number.isFinite(value)) return "";
  const s = value.toFixed(2);
  return lang === "bg" ? s.replace(".", ",") : s;
}

export function PriceField({ label, value, onChange, error, className = "" }: { label: string; value: number; onChange: (v: number) => void; error?: string; className?: string }) {
  const { lang } = useT();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : formatPriceInput(value, lang);
  return (
    <TextField label={label} value={shown} inputMode="decimal" autoComplete="off" className={className} error={error}
      onFocus={() => { setText(formatPriceInput(value, lang)); setFocused(true); }}
      onBlur={() => setFocused(false)}
      onChange={(v) => {
        const clean = v.replace(/[^0-9.,]/g, "");
        setText(clean);
        const n = Number(clean.replace(",", "."));
        if (clean !== "" && Number.isFinite(n)) onChange(Math.round(n * 100) / 100);
      }} />
  );
}

/** Shape rule for the wizard: controls are pills, inputs and panels are 12 px, the preview frame is 16 px. */
export const BUTTON_BASE = "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-[background-color,color,transform,box-shadow] duration-150 ease-out motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
export const BUTTON_STYLES = {
  primary: "bg-brand text-canvas hover:bg-brand-strong",
  secondary: "bg-panel text-fg ring-1 ring-line-strong hover:bg-sunken",
  quiet: "text-fg-soft hover:bg-sunken hover:text-fg",
} as const;

export function Button({ variant = "secondary", className = "", ...rest }: ComponentPropsWithRef<"button"> & { variant?: keyof typeof BUTTON_STYLES }) {
  return <button type="button" className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} ${className}`} {...rest} />;
}

export function Fieldset({ legend, hint, children, className = "" }: { legend: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`grid gap-3 ${className}`}>
      <legend className="text-sm font-semibold text-fg">{legend}</legend>
      {hint && <p className="-mt-1 text-sm leading-snug text-fg-soft">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** Hidden file input behind a visible button. The input is the label's `peer`, so keyboard focus on it rings the button. */
export function FileButton({ label, accept, multiple = false, disabled = false, onFiles, variant = "secondary" }: { label: string; accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: File[]) => void; variant?: keyof typeof BUTTON_STYLES }) {
  const id = useId();
  return (
    <>
      <input id={id} type="file" accept={accept} multiple={multiple} disabled={disabled} className="peer sr-only" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
      <label htmlFor={id} className={`${BUTTON_BASE} ${BUTTON_STYLES[variant]} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas ${disabled ? "pointer-events-none opacity-50" : ""}`}>{label}</label>
    </>
  );
}

/** A quiet explanation in place of a control (AI not configured on this server). */
export function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-sunken px-3.5 py-2.5 text-sm leading-snug text-fg-soft">{children}</p>;
}

/** Announced line for async states; `tone` picks the colour, the min height keeps the layout from jumping. */
export function Status({ children, tone = "soft" }: { children: ReactNode; tone?: "soft" | "danger" }) {
  return <p aria-live="polite" className={`min-h-5 text-sm ${tone === "danger" ? "font-semibold text-danger" : "text-fg-soft"}`}>{children}</p>;
}
