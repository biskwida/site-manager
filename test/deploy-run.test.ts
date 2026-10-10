// test/deploy-run.test.ts
import { describe, expect, it } from "vitest";
import { FakeDeployer } from "@/src/deploy/fake";
import { DEPLOY_TIMEOUT_MS, POLL_MAX, pollDeployments, startDeploy } from "@/src/deploy/run";
import type { Deployer, DeployStatusResult } from "@/src/deploy/types";
import { FakeMessenger, makeDemo } from "./helpers";

const T0 = new Date("2026-10-09T09:00:00.000Z");
const feedUrlFor = (slug: string) => `https://sm.example/api/site/${slug}`;

describe("startDeploy", () => {
  it("lets only one of two concurrent starts create the site (the deploy claim)", async () => {
    const { store, venue } = await makeDemo();
    const deployer = new FakeDeployer();
    const logs: string[] = [];
    const d = { store, deployer, feedUrlFor, now: () => T0, log: (s: string) => logs.push(s) };
    // Both read the venue before either writes (as two webhook requests would), so only the claim can decide.
    await Promise.all([startDeploy(d, venue.id), startDeploy(d, venue.id)]);
    expect(deployer.projects.size).toBe(1);
    expect(deployer.deployments.size).toBe(1);
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    expect(logs.filter((l) => l.includes("another request is deploying"))).toHaveLength(1);
  });

  it("creates the site and moves pending → building; no-op for drafts, existing deployments and unknown ids", async () => {
    const { store, venue } = await makeDemo();
    const deployer = new FakeDeployer();
    const logs: string[] = [];
    const d = { store, deployer, feedUrlFor, now: () => T0, log: (s: string) => logs.push(s) };
    await startDeploy(d, venue.id);
    const v = await store.getVenue(venue.id);
    expect(v.deploy).toMatchObject({ provider: "fake", status: "building", template: "classic", url: null, error: null, updated_at: T0.toISOString() });
    expect(v.deploy?.project_id).toMatch(/^fake-prj-/);
    expect(v.deploy?.deployment_id).toMatch(/^fake-dpl-/);
    expect(deployer.projects.get(v.deploy?.project_id ?? "")).toMatchObject({ slug: "agala", templateId: "classic", feedUrl: "https://sm.example/api/site/agala" });
    await startDeploy(d, venue.id);
    expect(deployer.projects.size).toBe(1); // already building: nothing new
    const draft = await store.createVenue({ slug: "mydraft", name: "Draft", status: "draft" });
    await startDeploy(d, draft.id);
    expect((await store.getVenue(draft.id)).deploy).toBeNull();
    expect(deployer.projects.size).toBe(1);
    await expect(startDeploy(d, "00000000-0000-0000-0000-000000000000")).resolves.toBeUndefined(); // never throws
    expect(logs.some((l) => l.includes("not found"))).toBe(true);
  });

  it("stores a provider failure as a short, secret-free error and retries on the same project next time", async () => {
    const { store, venue } = await makeDemo();
    let fail = true;
    const inner = new FakeDeployer();
    const deployer: Deployer = {
      provider: "fake",
      createSite: (i) => inner.createSite(i),
      status: (id) => inner.status(id),
      redeploy: async (p, i) => {
        if (fail) throw new Error("HTTP 500 from Authorization: Bearer tok-SECRET while deploying");
        return inner.redeploy(p, i);
      },
      deleteSite: (p) => inner.deleteSite(p),
    };
    // first attempt: project created, deployment created (createSite does not go through redeploy)
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const first = (await store.getVenue(venue.id)).deploy;
    expect(first?.status).toBe("building");
    // simulate a failed build, then a retry: the project id is kept and redeploy is used
    await store.setDeploy(venue.id, { ...first!, status: "error", error: "Build failed" });
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const errored = (await store.getVenue(venue.id)).deploy;
    expect(errored).toMatchObject({ status: "error", project_id: first?.project_id });
    expect(errored?.error).toBe("HTTP 500 from Authorization: Bearer … while deploying");
    fail = false;
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "building", project_id: first?.project_id });
    expect(inner.projects.size).toBe(1);
  });

  it("stores a createSite failure as error with no project and creates the project on the retry", async () => {
    const { store, venue } = await makeDemo();
    const inner = new FakeDeployer();
    let fail = true;
    const deployer: Deployer = {
      provider: "fake",
      createSite: async (i) => {
        if (fail) throw new Error("x".repeat(500));
        return inner.createSite(i);
      },
      status: (id) => inner.status(id),
      redeploy: (p, i) => inner.redeploy(p, i),
      deleteSite: (p) => inner.deleteSite(p),
    };
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0, log: () => {} }, venue.id);
    const errored = (await store.getVenue(venue.id)).deploy;
    expect(errored).toMatchObject({ status: "error", project_id: "", deployment_id: "" });
    expect(errored?.error?.length).toBe(300);
    fail = false;
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0, log: () => {} }, venue.id);
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "building", project_id: "fake-prj-1" });
  });
});

describe("pollDeployments", () => {
  it("marks the site ready after the fake's second poll and tells every owner in their language", async () => {
    const { store, venue } = await makeDemo(); // owner 1001 (bg), staff 1002 (en)
    await store.upsertMember({ venue_id: venue.id, tg_chat_id: 1003, role: "owner", lang: "en" });
    const deployer = new FakeDeployer();
    const m = new FakeMessenger();
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    const d = { store, deployer, messenger: m, now: () => T0 };
    expect(await pollDeployments(d)).toEqual({ ready: [], failed: [] });
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    expect(m.sent).toEqual([]);
    expect(await pollDeployments(d)).toEqual({ ready: [venue.id], failed: [] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "ready", url: "https://agala.example.test", error: null });
    expect(m.sent.map((s) => [s.chatId, s.text])).toEqual([
      [1001, "🎉 Сайтът на Кафене „Ъгъла“ е готов: https://agala.example.test\n\nОт тук нататък промените от този чат се появяват на него за секунди."],
      [1003, "🎉 Кафене „Ъгъла“'s site is live: https://agala.example.test\n\nFrom now on, changes from this chat show up there within seconds."],
    ]);
    expect(await pollDeployments(d)).toEqual({ ready: [], failed: [] }); // ready venues are not polled again
    expect(m.sent).toHaveLength(2);
  });

  it("stores the provider's error, notifies the owner, and never notifies without a messenger", async () => {
    const { store, venue } = await makeDemo();
    const failing: Deployer = {
      provider: "fake",
      createSite: async () => ({ projectId: "p", deploymentId: "d" }),
      status: async (): Promise<DeployStatusResult> => ({ state: "error", url: null, error: "Build failed\nModule not found: zod" }),
      redeploy: async () => ({ deploymentId: "d2" }),
      deleteSite: async () => {},
    };
    const m = new FakeMessenger();
    await startDeploy({ store, deployer: failing, feedUrlFor, now: () => T0 }, venue.id);
    expect(await pollDeployments({ store, deployer: failing, messenger: m, now: () => T0 })).toEqual({ ready: [], failed: [venue.id] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "error", error: "Build failed\nModule not found: zod", url: null });
    expect(m.sent).toEqual([expect.objectContaining({ chatId: 1001, text: "Публикуването на сайта на Кафене „Ъгъла“ не успя. Ще го погледнем; дотогава сайтът ви остава достъпен на адреса от приветственото съобщение." })]);
    const other = await store.createVenue({ slug: "other", name: "Other" });
    await startDeploy({ store, deployer: failing, feedUrlFor, now: () => T0 }, other.id);
    expect(await pollDeployments({ store, deployer: failing, messenger: null, now: () => T0 })).toEqual({ ready: [], failed: [other.id] });
    expect(m.sent).toHaveLength(1);
  });

  it("times out a deployment that is still building after 20 minutes, and keeps polling a transient failure", async () => {
    const { store, venue } = await makeDemo();
    let polls = 0;
    const slow: Deployer = {
      provider: "fake",
      createSite: async () => ({ projectId: "p", deploymentId: "d" }),
      status: async () => {
        polls++;
        if (polls === 1) throw new Error("network");
        return { state: "building", url: null, error: null };
      },
      redeploy: async () => ({ deploymentId: "d2" }),
      deleteSite: async () => {},
    };
    const m = new FakeMessenger();
    await startDeploy({ store, deployer: slow, feedUrlFor, now: () => T0 }, venue.id);
    expect(await pollDeployments({ store, deployer: slow, messenger: m, now: () => T0 })).toEqual({ ready: [], failed: [] }); // threw: skipped, still building
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    const later = new Date(T0.getTime() + DEPLOY_TIMEOUT_MS + 1);
    expect(await pollDeployments({ store, deployer: slow, messenger: m, now: () => later })).toEqual({ ready: [], failed: [venue.id] });
    expect((await store.getVenue(venue.id)).deploy).toMatchObject({ status: "error", error: "timeout: no result after 20 minutes" });
    expect(m.sent.at(-1)?.text).toMatch(/не успя/);
  });

  it("skips a pending deployment whose id is still empty (create call in flight) until it times out", async () => {
    const { store, venue } = await makeDemo();
    let polls = 0;
    const deployer: Deployer = {
      provider: "fake",
      createSite: async () => ({ projectId: "p", deploymentId: "d" }),
      status: async () => {
        polls++;
        return { state: "ready", url: "https://x.example.test", error: null };
      },
      redeploy: async () => ({ deploymentId: "d2" }),
      deleteSite: async () => {},
    };
    await store.setDeploy(venue.id, { provider: "fake", project_id: "", deployment_id: "", url: null, status: "pending", error: null, template: "classic", updated_at: T0.toISOString() });
    expect(await pollDeployments({ store, deployer, messenger: null, now: () => T0 })).toEqual({ ready: [], failed: [] });
    expect(polls).toBe(0);
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("pending");
    const later = new Date(T0.getTime() + DEPLOY_TIMEOUT_MS + 1);
    expect(await pollDeployments({ store, deployer, messenger: null, now: () => later })).toEqual({ ready: [], failed: [venue.id] });
    expect(polls).toBe(0);
  });

  it("limits itself to one venue when asked, and to POLL_MAX venues per run", async () => {
    const { store, venue } = await makeDemo();
    const other = await store.createVenue({ slug: "other", name: "Other" });
    const deployer = new FakeDeployer();
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, venue.id);
    await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, other.id);
    const d = { store, deployer, messenger: null, now: () => T0, venueId: other.id };
    await pollDeployments(d);
    expect(await pollDeployments(d)).toEqual({ ready: [other.id], failed: [] });
    expect((await store.getVenue(venue.id)).deploy?.status).toBe("building");
    for (let i = 0; i < POLL_MAX + 2; i++) await startDeploy({ store, deployer, feedUrlFor, now: () => T0 }, (await store.createVenue({ slug: `v${i}`, name: `V${i}` })).id);
    const polled = [...deployer.deployments.values()].filter((x) => x.polls > 0).length;
    await pollDeployments({ store, deployer, messenger: null, now: () => T0 });
    expect([...deployer.deployments.values()].filter((x) => x.polls > 0).length - polled).toBe(POLL_MAX);
  });
});
