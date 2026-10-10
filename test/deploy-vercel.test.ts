// test/deploy-vercel.test.ts
import { describe, expect, it } from "vitest";
import type { InlinedFile } from "@/src/deploy/types";
import { VercelDeployer } from "@/src/deploy/vercel";

interface Call { method: string; url: string; body: Record<string, unknown> | null; headers: Record<string, string> }
type Reply = { status?: number; json?: unknown } | undefined;

/** Records every request and answers from `handler`; unknown requests get a 404 with a Vercel-shaped error body. */
function fakeFetch(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const call: Call = { method: init?.method ?? "GET", url: String(input), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, headers };
    calls.push(call);
    const r = handler(call) ?? { status: 404, json: { error: { code: "not_found", message: "no such route" } } };
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const FILES: InlinedFile[] = [{ file: "package.json", data: "{}", encoding: "utf-8" }, { file: "app/icon.png", data: "AAAA", encoding: "base64" }];
const files = async () => FILES;
const INPUT = { slug: "agala", templateId: "classic" as const, feedUrl: "https://sm.example/api/site/agala" };
const ENV = [
  { key: "SITE_MANAGER_URL", value: "https://sm.example", target: ["production", "preview"], type: "plain" },
  { key: "SITE_MANAGER_SLUG", value: "agala", target: ["production", "preview"], type: "plain" },
];

describe("VercelDeployer", () => {
  it("creates the project and the deployment, then maps building → ready with the real alias", async () => {
    let polls = 0;
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v11/projects") return { json: { id: "prj_1", name: c.body?.name } };
      if (c.method === "POST" && c.url === "https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1") return { json: { id: "dpl_1", readyState: "QUEUED", url: "agala-abc123.vercel.app" } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v13/deployments/dpl_1") {
        polls++;
        return { json: polls === 1 ? { id: "dpl_1", readyState: "BUILDING", url: "agala-abc123.vercel.app" } : { id: "dpl_1", readyState: "READY", url: "agala-abc123.vercel.app", alias: ["agala.vercel.app", "agala-team.vercel.app"], aliasAssigned: true } };
      }
      return undefined;
    });
    const logs: string[] = [];
    const dep = new VercelDeployer({ token: "tok-SECRET", files, fetch: fetchFn, log: (s) => logs.push(s) });
    expect(dep.provider).toBe("vercel");
    expect(await dep.createSite(INPUT)).toEqual({ projectId: "prj_1", deploymentId: "dpl_1" });
    expect(calls[0].headers.authorization).toBe("Bearer tok-SECRET");
    expect(calls[0].body).toEqual({ name: "agala", framework: "nextjs", environmentVariables: ENV, ssoProtection: null });
    expect(calls[1].body).toEqual({ name: "agala", project: "prj_1", target: "production", files: FILES, projectSettings: { framework: "nextjs", nodeVersion: "22.x" } });
    expect(await dep.status("dpl_1")).toEqual({ state: "building", url: null, error: null });
    expect(await dep.status("dpl_1")).toEqual({ state: "ready", url: "https://agala.vercel.app", error: null });
    expect(logs.join("\n")).not.toContain("SECRET");
    expect(logs.join("\n")).not.toContain("agala-abc123"); // no response bodies in logs
  });

  it("stays building while READY has no alias assigned, maps QUEUED/INITIALIZING to building, and takes the url from alias[] only", async () => {
    const states = [
      { readyState: "QUEUED", url: "agala-xyz.vercel.app" },
      { readyState: "INITIALIZING", url: "agala-xyz.vercel.app" },
      { readyState: "READY", url: "agala-xyz.vercel.app", alias: [], aliasAssigned: false },
      { readyState: "READY", url: "agala-xyz.vercel.app", alias: ["agala-site.vercel.app"], aliasAssigned: true },
    ];
    const { fetchFn } = fakeFetch((c) => (c.url.startsWith("https://api.vercel.com/v13/deployments/dpl_9") ? { json: { id: "dpl_9", ...states.shift() } } : undefined));
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    expect(await dep.status("dpl_9")).toEqual({ state: "building", url: null, error: null });
    expect(await dep.status("dpl_9")).toEqual({ state: "building", url: null, error: null });
    expect(await dep.status("dpl_9")).toEqual({ state: "building", url: null, error: null }); // READY but alias not yet assigned
    expect(await dep.status("dpl_9")).toEqual({ state: "ready", url: "https://agala-site.vercel.app", error: null }); // alias, not the slug
  });

  it("on ERROR reads the last 20 stderr lines from the events endpoint", async () => {
    const events = [
      ...Array.from({ length: 25 }, (_, i) => ({ type: "stderr", created: i, payload: { text: `line ${i + 1}` } })),
      { type: "stdout", created: 99, payload: { text: "not an error" } },
    ];
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.url === "https://api.vercel.com/v13/deployments/dpl_2") return { json: { id: "dpl_2", readyState: "ERROR", errorMessage: "Build failed" } };
      if (c.url === "https://api.vercel.com/v3/deployments/dpl_2/events?limit=-1") return { json: events };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    const r = await dep.status("dpl_2");
    expect(r.state).toBe("error");
    expect(r.url).toBeNull();
    expect(r.error).toContain("Build failed");
    expect(r.error).toContain("line 25");
    expect(r.error).toContain("line 6");
    expect(r.error).not.toContain("line 5\n");
    expect(r.error).not.toContain("not an error");
    expect(calls.map((c) => c.url)).toEqual(["https://api.vercel.com/v13/deployments/dpl_2", "https://api.vercel.com/v3/deployments/dpl_2/events?limit=-1"]);
    const { fetchFn: f2 } = fakeFetch((c) => (c.url.includes("/v13/deployments/dpl_3") ? { json: { id: "dpl_3", readyState: "CANCELED" } } : undefined));
    const r2 = await new VercelDeployer({ token: "t", files, fetch: f2, log: () => {} }).status("dpl_3");
    expect(r2).toEqual({ state: "error", url: null, error: "CANCELED" }); // events 404 → no stderr, state name as the message
  });

  it("caps the error text at 2000 chars", async () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ type: "stderr", payload: { text: `${i}:${"x".repeat(500)}` } }));
    const { fetchFn } = fakeFetch((c) => {
      if (c.url === "https://api.vercel.com/v13/deployments/dpl_4") return { json: { id: "dpl_4", readyState: "ERROR", errorMessage: "Build failed" } };
      if (c.url.startsWith("https://api.vercel.com/v3/deployments/dpl_4/events")) return { json: events };
      return undefined;
    });
    const r = await new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} }).status("dpl_4");
    expect(r.state).toBe("error");
    expect(r.error?.length).toBe(2000);
    expect(r.error?.startsWith("Build failed\n")).toBe(true);
  });

  it("retries the project name with -site, then -<4 hex> on conflicts and invalid names", async () => {
    const names: string[] = [];
    const { fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v11/projects") {
        names.push(String(c.body?.name));
        if (names.length === 1) return { status: 409, json: { error: { code: "conflict", message: "Project already exists" } } };
        if (names.length === 2) return { status: 400, json: { error: { code: "invalid_name", message: "bad" } } };
        return { json: { id: "prj_7" } };
      }
      if (c.method === "POST" && c.url.startsWith("https://api.vercel.com/v13/deployments")) return { json: { id: "dpl_7" } };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} });
    expect(await dep.createSite(INPUT)).toEqual({ projectId: "prj_7", deploymentId: "dpl_7" });
    expect(names[0]).toBe("agala");
    expect(names[1]).toBe("agala-site");
    expect(names[2]).toMatch(/^agala-[0-9a-f]{4}$/);
    const { fetchFn: always409 } = fakeFetch(() => ({ status: 409, json: { error: { code: "conflict", message: "taken" } } }));
    await expect(new VercelDeployer({ token: "t", files, fetch: always409, log: () => {} }).createSite(INPUT)).rejects.toThrow(/taken/);
    const { calls: forbiddenCalls, fetchFn: forbidden } = fakeFetch(() => ({ status: 403, json: { error: { code: "forbidden", message: "Not authorized" } } }));
    await expect(new VercelDeployer({ token: "t", files, fetch: forbidden, log: () => {} }).createSite(INPUT)).rejects.toThrow(/Not authorized/); // no retry on other errors
    expect(forbiddenCalls).toHaveLength(1);
  });

  it("truncates provider error messages to 200 chars and logs only method, path and status", async () => {
    const logs: string[] = [];
    const { fetchFn } = fakeFetch(() => ({ status: 500, json: { error: { code: "internal_error", message: "x".repeat(400) + " token=tok-SECRET" } } }));
    const dep = new VercelDeployer({ token: "tok-SECRET", files, fetch: fetchFn, log: (s) => logs.push(s) });
    const err = await dep.status("dpl_x").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toHaveLength(200);
    expect(logs).toEqual(["[vercel] GET /v13/deployments/dpl_x → 500 internal_error"]);
  });

  it("adds teamId to every call, redeploys into an existing project, deletes projects and adds domains", async () => {
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.url.startsWith("https://api.vercel.com/v13/deployments?")) return { json: { id: "dpl_5" } };
      if (c.method === "DELETE") return { status: 204 };
      if (c.method === "POST" && c.url.startsWith("https://api.vercel.com/v10/projects/prj_5/domains")) return { json: { name: "cafe.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] } };
      if (c.method === "GET" && c.url.startsWith("https://api.vercel.com/v6/domains/cafe.example.com/config")) return { json: { misconfigured: true } };
      return undefined;
    });
    const dep = new VercelDeployer({ token: "t", teamId: "team_1", files, fetch: fetchFn, log: () => {} });
    expect(await dep.redeploy("prj_5", { ...INPUT, templateId: "lumen" })).toEqual({ deploymentId: "dpl_5" });
    expect(calls[0].url).toBe("https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1&teamId=team_1");
    expect(calls[0].body).toMatchObject({ project: "prj_5", target: "production" });
    await dep.deleteSite("prj_5");
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "https://api.vercel.com/v9/projects/prj_5?teamId=team_1" });
    const dns = await dep.addDomain("prj_5", "cafe.example.com");
    expect(calls[2]).toMatchObject({ method: "POST", url: "https://api.vercel.com/v10/projects/prj_5/domains?teamId=team_1", body: { name: "cafe.example.com" } });
    expect(calls[3].url).toBe("https://api.vercel.com/v6/domains/cafe.example.com/config?teamId=team_1");
    expect(dns).toEqual({ verified: false, records: [{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] });
    for (const c of calls) expect(new URL(c.url).searchParams.get("teamId")).toBe("team_1");
  });

  it("gives an apex domain an A record and reports verified only when Vercel says configured", async () => {
    const { fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url.startsWith("https://api.vercel.com/v10/projects/prj_6/domains")) return { json: { name: "example.com", apexName: "example.com", verified: true } };
      if (c.method === "GET" && c.url.startsWith("https://api.vercel.com/v6/domains/example.com/config")) return { json: { misconfigured: false } };
      return undefined;
    });
    const dns = await new VercelDeployer({ token: "t", files, fetch: fetchFn, log: () => {} }).addDomain("prj_6", "example.com");
    expect(dns).toEqual({ verified: true, records: [{ type: "A", name: "@", value: "76.76.21.21" }] });
  });
});
