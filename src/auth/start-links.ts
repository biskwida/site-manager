// src/auth/start-links.ts
// Client-safe and pure: the plan and language that /start remembers across the sign-in round trip and every step after it.
import type { PageLang } from "./page-lang";

export type StartPlan = "admin" | "social" | "both";
export const START_PLANS: readonly StartPlan[] = ["admin", "social", "both"];

/** `?plan=` when it names one of the three plans; null for anything else (a missing or unknown plan is simply no plan). */
export function parsePlan(v: unknown): StartPlan | null {
  return typeof v === "string" && (START_PLANS as readonly string[]).includes(v) ? (v as StartPlan) : null;
}

/** "?plan=social&lang=bg", with only the parts that are set; "" when none is. */
export function startQuery(o: { plan?: StartPlan | null; lang?: PageLang | null }): string {
  const q = new URLSearchParams();
  if (o.plan) q.set("plan", o.plan);
  if (o.lang) q.set("lang", o.lang);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** A /start page address that keeps the plan and language: `startPath("/start/choose", { plan: "both", lang: "en" })`. */
export function startPath(path: string, o: { plan?: StartPlan | null; lang?: PageLang | null }): string {
  return `${path}${startQuery(o)}`;
}
