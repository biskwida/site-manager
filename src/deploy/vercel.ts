// src/deploy/vercel.ts
// Server-only. Talks to the Vercel REST API with plain fetch (injectable). The token is only ever put in the Authorization header;
// logs carry method, path and status code, never headers or response bodies.
import type { TemplateId } from "../domain/types";
import type { Deployer, DeployInput, DeployStatusResult, DomainInstructions, InlinedFile } from "./types";

const API = "https://api.vercel.com";
const ERROR_MAX = 2000;
const MESSAGE_MAX = 200;
const STDERR_LINES = 20;

export interface VercelDeployerOptions {
  token: string;
  teamId?: string | null;
  fetch?: typeof fetch;
  files: (id: TemplateId) => Promise<InlinedFile[]>;
  log?: (s: string) => void;
}

export class VercelError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "VercelError";
  }
}

interface VercelDeployment {
  id: string;
  readyState?: string;
  url?: string;
  alias?: string[];
  aliasAssigned?: boolean | number | null;
  errorMessage?: string | null;
}
interface VercelEvent {
  type?: string;
  text?: string;
  payload?: { text?: string };
}
interface VercelDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: { type: string; domain: string; value: string }[];
}

const retryableName = (e: unknown) => e instanceof VercelError && (e.status === 409 || e.code === "invalid_name" || /conflict|already_exists/.test(e.code ?? ""));
const hex4 = () => crypto.randomUUID().replaceAll("-", "").slice(0, 4);

export class VercelDeployer implements Deployer {
  readonly provider = "vercel" as const;
  private readonly token: string;
  private readonly teamId: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly files: (id: TemplateId) => Promise<InlinedFile[]>;
  private readonly log: (s: string) => void;

  constructor(opts: VercelDeployerOptions) {
    this.token = opts.token;
    this.teamId = opts.teamId ?? null;
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.files = opts.files;
    this.log = opts.log ?? ((s) => console.log(s));
  }

  private url(path: string, query: Record<string, string> = {}): string {
    const u = new URL(API + path);
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    if (this.teamId) u.searchParams.set("teamId", this.teamId);
    return u.toString();
  }

  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, query?: Record<string, string>): Promise<T> {
    const res = await this.fetchFn(this.url(path, query), {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const code = err?.code ?? null;
      this.log(`[vercel] ${method} ${path} → ${res.status}${code ? ` ${code}` : ""}`);
      throw new VercelError((err?.message ?? `HTTP ${res.status}`).slice(0, MESSAGE_MAX), res.status, code);
    }
    return json as T;
  }

  async createSite(i: DeployInput) {
    const projectId = await this.createProject(i);
    const { deploymentId } = await this.deploy(projectId, i);
    return { projectId, deploymentId };
  }

  /** POST /v11/projects; on a name conflict or an invalid name, `<slug>-site`, then `<slug>-<4 hex>`. */
  private async createProject(i: DeployInput): Promise<string> {
    const siteManagerUrl = i.feedUrl.replace(/\/api\/site\/.*$/, "");
    const environmentVariables = [
      { key: "SITE_MANAGER_URL", value: siteManagerUrl, target: ["production", "preview"], type: "plain" },
      { key: "SITE_MANAGER_SLUG", value: i.slug, target: ["production", "preview"], type: "plain" },
    ];
    let last: unknown = null;
    for (const name of [i.slug, `${i.slug}-site`, `${i.slug}-${hex4()}`]) {
      try {
        const p = await this.call<{ id: string }>("POST", "/v11/projects", { name, framework: "nextjs", environmentVariables, ssoProtection: null });
        this.log(`[vercel] project ${name} created`);
        return p.id;
      } catch (e) {
        if (!retryableName(e)) throw e;
        last = e;
      }
    }
    throw last;
  }

  /** POST /v13/deployments with the template's files inlined. */
  private async deploy(projectId: string, i: DeployInput): Promise<{ deploymentId: string }> {
    const files = await this.files(i.templateId);
    const d = await this.call<{ id: string }>("POST", "/v13/deployments", { name: i.slug, project: projectId, target: "production", files, projectSettings: { framework: "nextjs", nodeVersion: "22.x" } }, { skipAutoDetectionConfirmation: "1" });
    this.log(`[vercel] deployment ${d.id} for ${i.slug} (${files.length} files)`);
    return { deploymentId: d.id };
  }

  /**
   * GET /v13/deployments/{id}. READY counts only once the production alias is assigned; the URL is the first alias
   * (never guessed from the slug). ERROR/CANCELED/BLOCKED → error with the build's stderr tail; anything else → building.
   */
  async status(deploymentId: string): Promise<DeployStatusResult> {
    const d = await this.call<VercelDeployment>("GET", `/v13/deployments/${encodeURIComponent(deploymentId)}`);
    switch (d.readyState) {
      case "READY": {
        if (!d.aliasAssigned) return { state: "building", url: null, error: null };
        const host = d.alias?.[0] ?? d.url ?? null;
        return { state: "ready", url: host ? `https://${host}` : null, error: null };
      }
      case "ERROR":
      case "CANCELED":
      case "BLOCKED": {
        const stderr = await this.stderrTail(deploymentId);
        const error = [d.errorMessage?.trim(), stderr].filter(Boolean).join("\n").slice(0, ERROR_MAX) || d.readyState;
        return { state: "error", url: null, error };
      }
      default:
        // QUEUED, INITIALIZING, BUILDING (and anything new): keep polling.
        return { state: "building", url: null, error: null };
    }
  }

  /** GET /v3/deployments/{id}/events?limit=-1 → the last 20 stderr texts; "" when the endpoint fails. */
  private async stderrTail(deploymentId: string): Promise<string> {
    try {
      const events = await this.call<VercelEvent[] | null>("GET", `/v3/deployments/${encodeURIComponent(deploymentId)}/events`, undefined, { limit: "-1" });
      const lines = (Array.isArray(events) ? events : [])
        .filter((e) => e?.type === "stderr")
        .map((e) => String(e.payload?.text ?? e.text ?? "").trimEnd())
        .filter(Boolean);
      return lines.slice(-STDERR_LINES).join("\n");
    } catch {
      return "";
    }
  }

  async redeploy(projectId: string, i: DeployInput) {
    return this.deploy(projectId, i);
  }

  async deleteSite(projectId: string) {
    await this.call<unknown>("DELETE", `/v9/projects/${encodeURIComponent(projectId)}`);
    this.log(`[vercel] project ${projectId} deleted`);
  }

  /**
   * POST /v10/projects/{id}/domains then GET /v6/domains/{domain}/config → DNS records the owner must set. When the add is
   * refused with a 4xx other than 429 (typically: already attached to this project), the domain is read back with
   * GET /v9/projects/{id}/domains/{domain}; if that fails too, the original add error is thrown. No read-back on 429 or 5xx.
   */
  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    const base = `/v10/projects/${encodeURIComponent(projectId)}/domains`;
    let added: VercelDomain;
    try {
      added = await this.call<VercelDomain>("POST", base, { name: domain });
    } catch (e) {
      if (!(e instanceof VercelError) || e.status < 400 || e.status > 499 || e.status === 429) throw e;
      try {
        added = await this.call<VercelDomain>("GET", `/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(domain)}`);
      } catch {
        throw e;
      }
      if (!added || typeof added.name !== "string" || typeof added.apexName !== "string") throw e;
    }
    const cfg = await this.call<{ misconfigured?: boolean }>("GET", `/v6/domains/${encodeURIComponent(domain)}/config`);
    const records: DomainInstructions["records"] = [];
    if (added.apexName === added.name) records.push({ type: "A", name: "@", value: "76.76.21.21" });
    else records.push({ type: "CNAME", name: added.name.slice(0, added.name.length - added.apexName.length - 1), value: "cname.vercel-dns.com" });
    for (const v of added.verification ?? []) if (v.type === "TXT") records.push({ type: "TXT", name: v.domain, value: v.value });
    return { verified: Boolean(added.verified) && !cfg.misconfigured, records };
  }
}
