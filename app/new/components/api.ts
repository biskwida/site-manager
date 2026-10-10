"use client";
import type { Media } from "@/src/domain/types";
import type { ExtractFile, ExtractResult } from "@/src/wizard/extract";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";
import type { DraftTexts } from "@/src/wizard/texts";

// TODO(merge): switch to `WIZARD_MAX_IMAGE_BYTES` from src/wizard/schema.ts once Task 7's export lands (same value).
/** Upload ceiling per image after client-side downscaling (Vercel's request body limit is 4.5 MB). */
export const WIZARD_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
// TODO(merge): switch to `EXTRACT_MAX_TOTAL_BYTES` from src/wizard/schema.ts once Task 8b's export lands (same value).
/** Total decoded bytes of all files in one extraction request. */
export const EXTRACT_MAX_TOTAL_BYTES = 3 * 1024 * 1024;

export interface ApiError {
  code: string;
  bg: string;
  en: string;
  details?: PublishError[];
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

const NETWORK: ApiError = { code: "network", bg: "Няма връзка. Проверете интернета и опитайте пак.", en: "No connection. Check your internet and try again." };
const GENERIC: ApiError = { code: "error", bg: "Възникна грешка. Опитайте отново.", en: "Something went wrong. Please try again." };

async function call<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: ApiError }) | null;
  if (!res.ok) return { ok: false, status: res.status, error: body?.error ?? GENERIC };
  return { ok: true, data: body as T };
}
const json = (method: string, body: unknown, extra: RequestInit = {}): RequestInit => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json" }, ...extra });

/** The AI routes (Task 8b) answer 503 `ai_unavailable` without a key; a 404 means the route is not deployed at all. Both mean "no AI help here". */
export function aiUnavailable(r: { ok: false; status: number }): boolean {
  return r.status === 503 || r.status === 404;
}

export interface PublishResponse { slug: string; invite_code: string; start_url: string | null; admin_url: string; site_url: string }

export const api = {
  create: (template: string) => call<{ id: string }>("/api/new", json("POST", { template })),
  get: (id: string) => call<{ draft: WizardDraft; media: Media[]; status: string }>(`/api/new/${id}`),
  put: (id: string, patch: Partial<WizardDraft>, keepalive = false) => call<{ draft: WizardDraft }>(`/api/new/${id}`, json("PUT", patch, { keepalive })),
  upload: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ media: Media }>(`/api/new/${id}/media`, { method: "POST", body: form });
  },
  extract: (id: string, files: ExtractFile[]) => call<ExtractResult>(`/api/new/${id}/extract`, json("POST", { files })),
  texts: (id: string, facts: string) => call<DraftTexts>(`/api/new/${id}/texts`, json("POST", { facts })),
  publish: (id: string) => call<PublishResponse>(`/api/new/${id}/publish`, { method: "POST" }),
};

/** base64 payload only (no data: prefix), as the extract route expects. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.readAsDataURL(file);
  });
}
