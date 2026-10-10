// src/deploy/fake.ts
// Offline deployer: READY after two status() calls, url https://<slug>.example.test. Used when VERCEL_TOKEN is missing or SITE_MANAGER_STORE=memory.
import type { TemplateId } from "../domain/types";
import type { Deployer, DeployInput, DeployStatusResult, DomainInstructions } from "./types";

export class FakeDeployer implements Deployer {
  readonly provider = "fake" as const;
  projects = new Map<string, { slug: string; templateId: TemplateId; feedUrl: string; deleted: boolean }>();
  deployments = new Map<string, { projectId: string; polls: number }>();
  domains: { projectId: string; domain: string }[] = [];
  private n = 0;

  async createSite(i: DeployInput) {
    const projectId = `fake-prj-${++this.n}`;
    this.projects.set(projectId, { slug: i.slug, templateId: i.templateId, feedUrl: i.feedUrl, deleted: false });
    return { projectId, ...(await this.redeploy(projectId, i)) };
  }
  async status(deploymentId: string): Promise<DeployStatusResult> {
    const d = this.deployments.get(deploymentId);
    if (!d) return { state: "error", url: null, error: "unknown deployment" };
    d.polls++;
    const p = this.projects.get(d.projectId);
    if (!p || p.deleted) return { state: "error", url: null, error: "project deleted" };
    return d.polls >= 2 ? { state: "ready", url: `https://${p.slug}.example.test`, error: null } : { state: "building", url: null, error: null };
  }
  async redeploy(projectId: string, i: DeployInput) {
    const p = this.projects.get(projectId);
    if (!p || p.deleted) throw new Error(`fake deployer: unknown project ${projectId}`);
    p.templateId = i.templateId;
    p.feedUrl = i.feedUrl;
    const deploymentId = `fake-dpl-${++this.n}`;
    this.deployments.set(deploymentId, { projectId, polls: 0 });
    return { deploymentId };
  }
  async deleteSite(projectId: string) {
    const p = this.projects.get(projectId);
    if (p) p.deleted = true;
  }
  /** Fixed records like Vercel's (CNAME for a subdomain, A for an apex, plus the TXT ownership record); verified from the second call for the same project + domain, so "Connect → Check again" reaches the verified state offline. */
  async addDomain(projectId: string, domain: string): Promise<DomainInstructions> {
    this.domains.push({ projectId, domain });
    const calls = this.domains.filter((d) => d.projectId === projectId && d.domain === domain).length;
    const apex = domain.split(".").slice(-2).join(".");
    const main = domain === apex
      ? { type: "A" as const, name: "@", value: "76.76.21.21" }
      : { type: "CNAME" as const, name: domain.slice(0, domain.length - apex.length - 1), value: "cname.vercel-dns.com" };
    return { verified: calls >= 2, records: [main, { type: "TXT", name: `_vercel.${apex}`, value: `vc-domain-verify=${domain},fake` }] };
  }
}
