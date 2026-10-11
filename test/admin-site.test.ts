// test/admin-site.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import type { Deployer } from "@/src/deploy/types";
import type { DeployInfo } from "@/src/domain/types";
import { adminOverview, checkDomain, connectDomain, setTemplate } from "@/src/server/admin";
import { makeDemo } from "./helpers";

const T0 = new Date("2026-10-10T10:00:00.000Z");
const ready: DeployInfo = { provider: "fake", project_id: "prj_1", deployment_id: "dpl_1", url: "https://agala.example.test", status: "ready", error: null, template: "classic", updated_at: "2026-10-10T09:00:00.000Z" };

function deps(store: Awaited<ReturnType<typeof makeDemo>>["store"], deployer: Deployer = new FakeDeployer()) {
  return { store, deployer, feedUrlFor: (slug: string) => `https://site.example/api/site/${slug}`, now: () => T0 };
}

/** A deployer whose addDomain throws `err` (createSite/redeploy are never reached by the domain actions). */
function throwing(err: unknown): Deployer {
  return { provider: "fake", createSite: async () => { throw new Error("x"); }, status: async () => ({ state: "building", url: null, error: null }), redeploy: async () => ({ deploymentId: "d" }), deleteSite: async () => {}, addDomain: async () => { throw err; } };
}

/** The store with some methods replaced (everything else goes to the real store, bound to it). */
function patched<S extends object>(store: S, over: Record<string, unknown>): S {
  return new Proxy(store, { get: (t, k, r) => (typeof k === "string" && k in over ? over[k] : (Reflect.get(t, k, r) as unknown)) }) as S;
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

  it("saves the template before claiming the redeploy: a store that rejects the template leaves the deploy untouched", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const rejecting = patched(store, { updateVenue: async () => { throw new Error('new row violates check constraint "venues_template_check"'); } });
    const r = await setTemplate(deps(rejecting, deployer), await store.getVenue(venue.id), "kvartal");
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(JSON.stringify(r)).not.toContain("constraint");
    const after = await store.getVenue(venue.id);
    expect(after.template).toBe("classic");
    expect(after.deploy).toEqual(ready);
    expect(deployer.deployments.size).toBe(0);
  });

  it("marks the claimed deploy as error when a step after the claim throws, so the owner can retry at once", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const failing: Deployer = { ...withProject(), provider: "fake", createSite: async () => { throw new Error("x"); }, status: async () => ({ state: "building", url: null, error: null }), redeploy: async () => { throw new Error("HTTP 500"); }, deleteSite: async () => {} };
    expect(await setTemplate(deps(store, failing), await store.getVenue(venue.id), "nocturne")).toMatchObject({ ok: true, deploy: { status: "error" } });
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("error");
    // Retry straight away with a working provider.
    const deployer = withProject();
    expect(await setTemplate(deps(store, deployer), await store.getVenue(venue.id), "nocturne")).toMatchObject({ ok: true, deploy: { status: "building", error: null } });
    expect(deployer.deployments.size).toBe(1);
    // Saving the started deploy fails: the record still ends in error rather than stuck in building.
    await store.setDeploy(venue.id, ready);
    let writes = 0;
    const flaky = patched(store, { setDeploy: async (id: string, info: DeployInfo) => { if (writes++ === 0) throw new Error("db down"); return store.setDeploy(id, info); } });
    const r = await setTemplate(deps(flaky, withProject()), await store.getVenue(venue.id), "lumen");
    expect(r).toMatchObject({ ok: true, deploy: { status: "error", error: "Redeploy could not start." } });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "error", template: "lumen" });
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

describe("custom domain", () => {
  it("normalises the input, attaches it through the deployer, stores it on the deploy record and returns the DNS records", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const d = deps(store, deployer);
    const r = await connectDomain(d, await store.getVenue(venue.id), " https://Cafe.Example.COM/ ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.domain).toBe("cafe.example.com");
    expect(r.instructions.verified).toBe(false);
    expect(r.instructions.records).toContainEqual({ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" });
    expect(r.instructions.records.some((x) => x.type === "TXT" && x.name === "_vercel.example.com")).toBe(true);
    expect(deployer.domains).toEqual([{ projectId: "prj_1", domain: "cafe.example.com" }]);
    const v = await store.getVenue(venue.id);
    expect(v.deploy).toMatchObject({ ...ready, custom_domain: "cafe.example.com", domain_verified: false, updated_at: T0.toISOString() });
    const o = await adminOverview(store, v, T0, "https://site.example");
    expect(o).toMatchObject({ custom_domain: "cafe.example.com", domain_verified: false });
  });

  it("check again re-attaches (idempotent) and flips to verified when the provider confirms the records", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const d = deps(store, deployer);
    const first = await connectDomain(d, await store.getVenue(venue.id), "cafe.example.com");
    expect(first).toMatchObject({ ok: true, instructions: { verified: false } });
    const again = await checkDomain(d, await store.getVenue(venue.id));
    expect(again).toMatchObject({ ok: true, domain: "cafe.example.com", instructions: { verified: true } });
    if (!again.ok) return;
    expect(again.instructions.records).toContainEqual({ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" });
    expect(deployer.domains).toHaveLength(2);
    const v = await store.getVenue(venue.id);
    expect(v.deploy).toMatchObject({ custom_domain: "cafe.example.com", domain_verified: true });
    expect((await adminOverview(store, v, T0)).domain_verified).toBe(true);
  });

  it("gives an apex domain an A record", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const r = await connectDomain(deps(store, withProject()), await store.getVenue(venue.id), "example.bg");
    expect(r).toMatchObject({ ok: true, domain: "example.bg" });
    if (!r.ok) return;
    expect(r.instructions.records).toContainEqual({ type: "A", name: "@", value: "76.76.21.21" });
  });

  it("rejects an invalid hostname without touching the deployer or the store", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const deployer = withProject();
    const v = await store.getVenue(venue.id);
    for (const bad of ["nope", "not a domain", "localhost", "-x.example.com", 42, null, undefined, "https://"]) {
      expect(await connectDomain(deps(store, deployer), v, bad)).toEqual({ ok: false, code: "invalid_domain", error: "Invalid domain.", bg: "Това не прилича на домейн.", en: "That does not look like a domain name." });
    }
    expect(deployer.domains).toEqual([]);
    expect((await store.getVenue(venue.id)).deploy).toEqual(ready);
  });

  it("needs a published site: no_site without a deploy or after a failed publish, busy while publishing", async () => {
    const { store, venue } = await makeDemo();
    const deployer = withProject();
    const noSite = { ok: false, code: "no_site", error: "Publish the site first.", bg: "Първо публикувайте сайта.", en: "Publish the site first." };
    const busy = { ok: false, code: "busy", error: "The site is publishing right now.", bg: "Сайтът се публикува в момента. Опитайте след минута.", en: "The site is publishing right now. Try again in a minute." };
    expect(await connectDomain(deps(store, deployer), venue, "cafe.example.com")).toEqual(noSite);
    expect(await checkDomain(deps(store, deployer), venue)).toEqual(noSite);
    for (const [status, expected] of [["error", noSite], ["pending", busy], ["building", busy]] as const) {
      await store.setDeploy(venue.id, { ...ready, status, custom_domain: "cafe.example.com" });
      expect(await connectDomain(deps(store, deployer), await store.getVenue(venue.id), "cafe.example.com")).toEqual(expected);
      expect(await checkDomain(deps(store, deployer), await store.getVenue(venue.id))).toEqual(expected);
    }
    expect(deployer.domains).toEqual([]);
  });

  it("check again needs a connected domain", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    expect(await checkDomain(deps(store, withProject()), await store.getVenue(venue.id))).toEqual({ ok: false, code: "no_domain", error: "No domain connected.", bg: "Няма свързан домейн.", en: "No domain connected." });
  });

  it("reports a short provider failure without the provider's message and stores nothing", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const r = await connectDomain(deps(store, throwing(new Error("HTTP 503 Bearer tok-SECRET"))), await store.getVenue(venue.id), "cafe.example.com");
    expect(r).toMatchObject({ ok: false, code: "provider", error: "The domain could not be added." });
    expect(JSON.stringify(r)).not.toContain("SECRET");
    expect((await store.getVenue(venue.id)).deploy).toEqual(ready);
  });

  it("tells the owner when the provider refused the domain (4xx other than 429), with the generic copy for everything else", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const v = await store.getVenue(venue.id);
    const refused = { ok: false, code: "refused", error: "The provider refused this domain.", bg: "Доставчикът отказа този домейн. Проверете дали не се използва от друг сайт.", en: "The provider refused this domain. Check that it is not used by another site." };
    for (const status of [400, 403, 409]) {
      expect(await connectDomain(deps(store, throwing(Object.assign(new Error("SECRET body"), { status }))), v, "cafe.example.com")).toEqual(refused);
    }
    for (const err of [Object.assign(new Error("slow down"), { status: 429 }), Object.assign(new Error("boom"), { status: 500 }), Object.assign(new Error("odd"), { status: "403" }), new Error("network")]) {
      expect(await connectDomain(deps(store, throwing(err)), v, "cafe.example.com")).toMatchObject({ code: "provider", en: "The domain could not be added. Try again in a minute." });
    }
    expect((await store.getVenue(venue.id)).deploy).toEqual(ready);
  });

  it("does not overwrite a deploy that started publishing while the provider call was in flight", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready);
    const building: DeployInfo = { ...ready, deployment_id: "dpl_2", status: "building" };
    const racing: Deployer = { provider: "fake", createSite: async () => { throw new Error("x"); }, status: async () => ({ state: "building", url: null, error: null }), redeploy: async () => ({ deploymentId: "d" }), deleteSite: async () => {}, addDomain: async (projectId, domain) => { await store.setDeploy(venue.id, building); return { verified: false, records: [{ type: "CNAME", name: domain, value: projectId }] }; } };
    const r = await connectDomain(deps(store, racing), await store.getVenue(venue.id), "cafe.example.com");
    expect(r).toMatchObject({ ok: false, code: "busy" });
    expect((await store.getVenue(venue.id)).deploy).toEqual(building);
  });
});

describe("without a deployer (production without VERCEL_TOKEN)", () => {
  const hostedDeps = (store: Awaited<ReturnType<typeof makeDemo>>["store"]) => ({ store, deployer: null, feedUrlFor: (slug: string) => `https://site.example/api/site/${slug}`, now: () => T0 });
  const unavailable = { ok: false, code: "unavailable", error: "Not available on this server.", bg: "Това не е налично на този сървър.", en: "This is not available on this server." };

  it("set_template only updates the venue (the hosted /<slug> shows the new template at once)", async () => {
    const { store, venue } = await makeDemo();
    expect(await setTemplate(hostedDeps(store), venue, "nocturne")).toEqual({ ok: true, template: "nocturne", deploy: null });
    const after = await store.getVenue(venue.id);
    expect(after.template).toBe("nocturne");
    expect(after.deploy).toBeNull();
    expect(await setTemplate(hostedDeps(store), after, "neon")).toMatchObject({ ok: false, code: "unknown_template" });
  });

  it("refuses custom domains with a bilingual 'not available on this server'", async () => {
    const { store, venue } = await makeDemo();
    expect(await connectDomain(hostedDeps(store), venue, "cafe.example.com")).toEqual(unavailable);
    expect(await checkDomain(hostedDeps(store), venue)).toEqual(unavailable);
  });

  it("the overview reports hosted mode: no deploy record and the hosted URL", async () => {
    const { store, venue } = await makeDemo();
    await store.setDeploy(venue.id, ready); // a stale record from an earlier setup must not leak through
    const o = await adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example", { hosted: true });
    expect(o).toMatchObject({ hosted: true, deploy: null, site_url: "https://site.example/agala", custom_domain: null, domain_verified: null });
    expect((await adminOverview(store, await store.getVenue(venue.id), T0, "https://site.example")).hosted).toBe(false);
  });
});
