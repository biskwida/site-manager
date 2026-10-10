// src/server/wizard-ai.ts
// Claude-backed wizard steps: menu extraction from photos/PDF and "Write for me" texts. The app/api/new/[id]/{extract,texts}
// routes run requireDraft (src/server/wizard.ts) and call these; the client is injected (ServerDeps.anthropic) so tests use a fake.
// Nothing is stored here: PDFs and photos are read in memory and sent to Claude only. Never log file contents, facts or model
// output; the helpers log only errorSummary / issue counts, and this module logs nothing.
import type Anthropic from "@anthropic-ai/sdk";
import type { Venue } from "../domain/types";
import { base64Bytes, checkExtractFiles, EXTRACT_MAX_FILES, ExtractFilesSchema, extractMenu, type ExtractFile } from "../wizard/extract";
import { draftTexts, TEXTS_MAX_FACTS } from "../wizard/texts";
import { ALREADY_PUBLISHED, WizardError, wizardErrorResponse, type WizardDeps } from "./wizard";

export interface WizardAiDeps extends Pick<WizardDeps, "store"> {
  /** null when ANTHROPIC_API_KEY is not set (offline mode): the routes answer 503 and the UI hides the buttons. */
  anthropic: Anthropic | null;
  model: string;
}

/**
 * R25: the wizard's upload limit is 4 MB server-side (Vercel's request body limit is 4.5 MB; the client downscales).
 * For extraction it applies to the decoded bytes of all files in one request together, on top of the helper's per-file limits.
 */
export const EXTRACT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
/** Largest body worth reading: 4 MB as base64 plus JSON framing. A larger declared content-length is refused unread. */
const EXTRACT_MAX_BODY = Math.ceil(EXTRACT_MAX_TOTAL_BYTES / 3) * 4 + 64 * 1024;

const NO_STORE = { "cache-control": "no-store" };

const UNAVAILABLE = () => new WizardError("ai_unavailable", 503, "Помощта с изкуствен интелект не е включена на този сървър.", "AI help is not enabled on this server.");
const TOTAL_TOO_LARGE = () =>
  new WizardError("too_large", 400, "Файловете са общо над 4 MB. Изберете по-малки снимки или по-малко наведнъж.", "The files are over 4 MB in total. Choose smaller photos or fewer at a time.");
const BAD_FILES = () => new WizardError("bad_request", 400, "Качете снимки (JPEG, PNG, WebP, GIF) или PDF.", "Upload images (JPEG, PNG, WebP, GIF) or a PDF.");

/** POST /api/new/[id]/extract `{ files: [{ media_type, data }] }` → `ExtractResult` for the owner to review (never inserted here). */
export async function handleExtract(req: Request, d: WizardAiDeps, venue: Venue): Promise<Response> {
  try {
    if (venue.status !== "draft") throw ALREADY_PUBLISHED(venue.slug);
    if (!d.anthropic) throw UNAVAILABLE();
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > EXTRACT_MAX_BODY) throw TOTAL_TOO_LARGE();
    const body = (await req.json().catch(() => null)) as { files?: unknown } | null;
    // A wrong file count gets its own message; checkExtractFiles answers on the count before it looks at any file.
    if (Array.isArray(body?.files) && (body.files.length === 0 || body.files.length > EXTRACT_MAX_FILES)) {
      const why = checkExtractFiles(body.files as ExtractFile[]);
      if (why) throw new WizardError(why.code, 400, why.bg, why.en);
    }
    const parsed = ExtractFilesSchema.safeParse(body);
    if (!parsed.success) throw BAD_FILES();
    const files = parsed.data.files;
    const limit = checkExtractFiles(files);
    if (limit) throw new WizardError(limit.code, 400, limit.bg, limit.en);
    if (files.reduce((sum, f) => sum + base64Bytes(f.data), 0) > EXTRACT_MAX_TOTAL_BYTES) throw TOTAL_TOO_LARGE();
    const r = await extractMenu(d.anthropic, { model: d.model }, files);
    if (r === "refused") throw new WizardError("refused", 422, "Не мога да обработя тези файлове. Опитайте с други снимки.", "I can't work with these files. Try different photos.");
    if (r === "error") throw new WizardError("ai_error", 502, "Не успях да прочета менюто. Опитайте отново след малко.", "I couldn't read the menu. Please try again in a moment.");
    return Response.json(r, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}

/** POST /api/new/[id]/texts `{ facts }` → `DraftTexts`, written for the draft's default language first. */
export async function handleTexts(req: Request, d: WizardAiDeps, venue: Venue): Promise<Response> {
  try {
    if (venue.status !== "draft") throw ALREADY_PUBLISHED(venue.slug);
    if (!d.anthropic) throw UNAVAILABLE();
    const body = (await req.json().catch(() => null)) as { facts?: unknown } | null;
    const facts = typeof body?.facts === "string" ? body.facts.trim() : "";
    if (!facts) throw new WizardError("bad_request", 400, "Напишете няколко факта за заведението.", "Write a few facts about the venue.");
    if (facts.length > TEXTS_MAX_FACTS) throw new WizardError("bad_request", 400, `Фактите са до ${TEXTS_MAX_FACTS} знака.`, `Facts are limited to ${TEXTS_MAX_FACTS} characters.`);
    const lang = venue.wizard_draft?.default_lang ?? venue.default_lang;
    const r = await draftTexts(d.anthropic, { model: d.model }, facts, lang);
    if (r === "refused") throw new WizardError("refused", 422, "Не мога да напиша текст по тези факти. Опитайте с други.", "I can't write from these facts. Try different ones.");
    if (r === "error") throw new WizardError("ai_error", 502, "Не успях да напиша текстовете. Опитайте отново след малко.", "I couldn't write the texts. Please try again in a moment.");
    return Response.json(r, { headers: NO_STORE });
  } catch (e) {
    return wizardErrorResponse(e);
  }
}
