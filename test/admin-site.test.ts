// test/admin-site.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import type { Deployer } from "@/src/deploy/types";
import type { DeployInfo } from "@/src/domain/types";
import { adminOverview, setTemplate } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-10T10:00:00.000Z");
const ready: DeployInfo = { provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };

function deps(store: Awaited<ReturnType<typeof makeDemo>>["store"], deployer: Deployer = new FakeDeployer()) {
  return { store, deployer, feedUrlFor: (slug: string) => `https://site.example/api/site/${slug}`, now: () => T0 };
}

/** A FakeDeployer that already knows project prj_1 (the demo venue's deploy record points at it). */
function withProject(): FakeDeployer {
  const d = new FakeDeployer();
  d.projects.set("prj_1", { slug: "agala", templateId: "classic", feedUrl: "https://site.example/api/site/agala", deleted: false });
  return d;
}

describe("set_template", () => {
  it("changes the template and redeploys when the site is deployed", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const r = await setTemplate(deps(store, deployer), await store.getVenue(venue.id), "nocturne");
    expect(r).toMatchObject({ ok: true, template: "nocturne" });
    const after = await store.getVenue(venue.id);
    expect(after.template).toBe("nocturne");
    expect(after.deploy).toMatchObject({ status: "building", template: "nocturne", project_id: "prj_1", url: "https://agala.example.test", error: null, updated_at: T0.toISOString() });
    expect(after.deploy?.deployment_id).toMatch(/^fake-dpl-/);
    expect(deployer.projects.get("prj_1")?.templateId).toBe("nocturne");
    const o = await adminOverview(store, after, T0, "https://site.example");
    expect(o).toMatchObject({ template: "nocturne", status: "live", site_url: "https://site.example/agala" });
    expect(o.deploy?.status).toBe("building");
  });

  it("only updates the venue when there is no deploy; the overview shows the provider URL once ready", async () => {
    const { store, venue } = await makeDemo();
    expect(await setTemplate(deps(store), venue, "lumen")).toEqual({ ok: true, template: "lumen", deploy: null });
    expect((await store.getVenue(venue.id)).template).toBe("lumen");
    await store.setDeploy(venue.id, ready);
    const o = await adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example");
    expect(o.site_url).toBe("https://agala.example.test");
    expect(o.deploy).toEqual(ready);
  });

  it("rejects unknown templates and refuses while a deploy is in flight", async () => {
    const { store, venue } = await makeDemo();
    expect(await setTemplate(deps(store), venue, "neon")).toMatchObject({ ok: false, error: "Unknown template." });
    expect(await setTemplate(deps(store), venue, 42)).toMatchObject({ ok: false, error: "Unknown template." });
    for (const status of ["pending", "building"] as const) {
      await store.setDeploy(venue.id, { ...ready, status });
      const r = await setTemplate(deps(store), await store.getVenue(venue.id), "nocturne");
      expect(r).toEqual({ ok: false, code: "busy", error: "The site is publishing right now.", bg: "Сайтът се публикува в момента. Опитайте след минута.", en: "The site is publishing right now. Try again in a minute." });
    }
    expect((await store.getVenue(venue.id)).template).toBe("classic");
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
  });

  it("retries from an errored deploy: redeploys into the kept project, or creates the site when none exists", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, { ...ready, status: "error", error: "Build failed" });
    const deployer = withProject();
    expect(await setTemplate(deps(store, deployer), await store.getVenue(venue.id), "lumen")).toMatchObject({ ok: true, template: "lumen", deploy: { status: "building", project_id: "prj_1", error: null } });
    // createSite failed earlier: no project yet, so the switch creates one
    await store.setDeploy(venue.id, { ...ready, project_id: "", deployment_id: "", url: null, status: "error", error: "boom" });
    const fresh = new FakeDeployer();
    const r = await setTemplate(deps(store, fresh), await store.getVenue(venue.id), "nocturne");
    expect(r).toMatchObject({ ok: true, deploy: { status: "building", project_id: "fake-prj-1" } });
    expect(fresh.projects.size).toBe(1);
  });

  it("stores a short error when the provider refuses the redeploy, without the provider's message", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const failing: Deployer = { provider: "fake", createSite: async () => { throw new Error("x"); }, status: async () => ({ state: "building", url: null, error: null }), redeploy: async () => { throw new Error("HTTP 500 Bearer tok-SECRET"); }, deleteSite: async () => {} };
    const r = await setTemplate(deps(store, failing), await store.getVenue(venue.id), "nocturne");
    expect(r).toMatchObject({ ok: true, template: "nocturne", deploy: { status: "error", error: "Redeploy could not start.", template: "nocturne" } });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect((await store.getVenue(venue.id)).template).toBe("nocturne");
  });

  it("lets only one of two concurrent switches start a redeploy", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const v = await store.getVenue(venue.id);
    const [a, b] = await Promise.all([setTemplate(deps(store, deployer), v, "nocturne"), setTemplate(deps(store, deployer), v, "lumen")]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, error: "The site is publishing right now." });
    expect(deployer.deployments.size).toBe(1);
    const after = await store.getVenue(venue.id);
    expect(after.deploy?.status).toBe("building");
    expect(after.template).toBe(after.deploy?.template);
  });
});
