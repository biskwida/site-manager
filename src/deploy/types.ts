// src/deploy/types.ts
import type { DeployStatus, TemplateId } from "../domain/types";

/** One file of a site deployment, inlined into the provider's create-deployment call. Also produced by src/deploy/manifest.ts (buildFiles). */
export interface InlinedFile {
  file: string;
  data: string;
  encoding: "utf-8" | "base64";
}

export interface DeployInput {
  slug: string;
  templateId: TemplateId;
  /** Absolute URL of the public feed, e.g. https://site-manager.example/api/site/agala */
  feedUrl: string;
}
export interface DeployStatusResult {
  state: DeployStatus;
  url: string | null;
  error: string | null;
}
export interface DomainInstructions {
  verified: boolean;
  records: { type: "A" | "CNAME" | "TXT"; name: string; value: string }[];
}
export interface Deployer {
  readonly provider: "vercel" | "fake";
  createSite(i: DeployInput): Promise<{ projectId: string; deploymentId: string }>;
  status(deploymentId: string): Promise<DeployStatusResult>;
  redeploy(projectId: string, i: DeployInput): Promise<{ deploymentId: string }>;
  deleteSite(projectId: string): Promise<void>;
  addDomain?(projectId: string, domain: string): Promise<DomainInstructions>;
}
