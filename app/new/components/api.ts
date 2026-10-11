"use client";
import type { Media } from "@/src/domain/types";
import type { ExtractFile, ExtractResult } from "@/src/wizard/extract";
import type { PublishError, WizardDraft } from "@/src/wizard/schema";
import type { DraftTexts } from "@/src/wizard/texts";

/** Server limits (R25): per-image upload ceiling after client downscaling, and total decoded bytes per extraction request. */
export { EXTRACT_MAX_TOTAL_BYTES, WIZARD_MAX_IMAGE_BYTES } from "@/src/wizard/schema";

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

/** One Instagram photo the owner can pick (GET /api/new/[id]/instagram). */
export interface IgItem { id: string; thumb: string; caption: string; permalink: string; taken_at: string }
/** Where a picked photo goes: the cover, the logo, the gallery, or a dish ("<categoryKey>/<itemKey>"). */
export type IgTarget = "cover" | "logo" | "gallery" | { item: string };

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
  /** A full-page navigation (Instagram's sign-in), not a fetch. */
  igStartUrl: (id: string, from: "photos" | "look") => `/api/new/${id}/instagram/start${from === "look" ? "?from=look" : ""}`,
  igList: (id: string) => call<{ items: IgItem[]; username?: string; expired?: boolean }>(`/api/new/${id}/instagram`),
  igImport: (id: string, picks: { id: string; target: IgTarget }[]) =>
    call<{ draft: WizardDraft; media: Media[]; failed: { id: string; code: string }[] }>(`/api/new/${id}/instagram/import`, json("POST", { picks })),
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
