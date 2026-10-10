// src/deploy/manifest.ts
// PLACEHOLDER (Task 6 branch): Task 5 delivers the real module, which reads the shell + template sources from disk.
// The controller replaces this file at merge. It exists so that src/server/deps.ts can wire VercelDeployer.files statically.
import type { TemplateId } from "../domain/types";
import type { InlinedFile } from "./types";

export type { InlinedFile };

export async function buildFiles(templateId: TemplateId): Promise<InlinedFile[]> {
  throw new Error(`manifest not available (template ${templateId})`);
}
