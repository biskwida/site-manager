// test/deploy-vercel-domains.test.ts
// Custom domain (Task 11): hostname normalisation and VercelDeployer.addDomain (Task 6) through an injected fetch.
import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/src/deploy/vercel-domains";
import { VercelDeployer, VercelError } from "@/src/deploy/vercel";

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

const files = async () => [];
const deployer = (fetchFn: typeof fetch, teamId: string | null = null) => new VercelDeployer({ token: "tok_secret", teamId, files, fetch: fetchFn, log: () => {} });

describe("normalizeDomain", () => {
  it("lowercases and strips scheme, path, query, port, whitespace and the trailing dot", () => {
    expect(normalizeDomain(" https://Cafe.Example.COM/menu?x=1 ")).toBe("cafe.example.com");
    expect(normalizeDomain("http://cafe.example.com:443/")).toBe("cafe.example.com");
    expect(normalizeDomain("example.bg.")).toBe("example.bg");
    expect(normalizeDomain("Кафе.бг")).toBe("xn--80akn5b.xn--90ae"); // a typed IDN becomes its punycode form
    expect(normalizeDomain("xn--80aa0bf.bg")).toBe("xn--80aa0bf.bg");
    expect(normalizeDomain("cafe.xn--90ae")).toBe("cafe.xn--90ae");
  });
  it("rejects anything that is not a plain public hostname", () => {
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("-bad.example.com")).toBeNull();
    expect(normalizeDomain("bad-.example.com")).toBeNull();
    expect(normalizeDomain("a_b.example.com")).toBeNull();
    expect(normalizeDomain("192.168.0.1")).toBeNull();
    expect(normalizeDomain("example")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain(`${"a".repeat(64)}.example.com`)).toBeNull();
    expect(normalizeDomain(`${`${"a".repeat(60)}.`.repeat(4)}example.com`)).toBeNull(); // 255 chars
    expect(normalizeDomain(42)).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

describe("VercelDeployer.addDomain", () => {
  it("attaches the domain to the project, reads the DNS config and maps a subdomain to CNAME + TXT", async () => {
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1") return { json: { name: "cafe.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v6/domains/cafe.example.com/config?teamId=team_1") return { json: { misconfigured: true } };
      return undefined;
    });
    const r = await deployer(fetchFn, "team_1").addDomain("prj_1", "cafe.example.com");
    expect(r).toEqual({ verified: false, records: [{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,abc" }] });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1",
      "GET https://api.vercel.com/v6/domains/cafe.example.com/config?teamId=team_1",
    ]);
    expect(calls[0].body).toEqual({ name: "cafe.example.com" });
    for (const c of calls) expect(c.headers.authorization).toBe("Bearer tok_secret");
  });

  it("maps an apex domain to an A record and reports verified only when Vercel says configured", async () => {
    const { fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v10/projects/prj_1/domains") return { json: { name: "example.com", apexName: "example.com", verified: true } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v6/domains/example.com/config") return { json: { misconfigured: false } };
      return undefined;
    });
    expect(await deployer(fetchFn).addDomain("prj_1", "example.com")).toEqual({ verified: true, records: [{ type: "A", name: "@", value: "76.76.21.21" }] });
  });

  it("stays unverified while DNS is misconfigured even if the ownership check passed", async () => {
    const { fetchFn } = fakeFetch((c) => {
      if (c.method === "POST") return { json: { name: "cafe.example.com", apexName: "example.com", verified: true } };
      if (c.method === "GET") return { json: { misconfigured: true } };
      return undefined;
    });
    const r = await deployer(fetchFn).addDomain("prj_1", "cafe.example.com");
    expect(r.verified).toBe(false);
    expect(r.records).toEqual([{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }]);
  });

  it("reads an already attached domain back when the add is refused, then continues to the config", async () => {
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.method === "POST" && c.url === "https://api.vercel.com/v10/projects/prj_1/domains?teamId=team_1") return { status: 409, json: { error: { code: "domain_already_in_use", message: "SECRET" } } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v9/projects/prj_1/domains/cafe.example.com?teamId=team_1") return { json: { name: "cafe.example.com", apexName: "example.com", verified: false, verification: [{ type: "TXT", domain: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,read" }] } };
      if (c.method === "GET" && c.url === "https://api.vercel.com/v6/domains/cafe.example.com/config?teamId=team_1") return { json: { misconfigured: true } };
      return undefined;
    });
    const lines: string[] = [];
    const r = await new VercelDeployer({ token: "tok_secret", teamId: "team_1", files, fetch: fetchFn, log: (s) => lines.push(s) }).addDomain("prj_1", "cafe.example.com");
    expect(r).toEqual({ verified: false, records: [{ type: "CNAME", name: "cafe", value: "cname.vercel-dns.com" }, { type: "TXT", name: "_vercel.example.com", value: "vc-domain-verify=cafe.example.com,read" }] });
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v10/projects/prj_1/domains", "GET /v9/projects/prj_1/domains/cafe.example.com", "GET /v6/domains/cafe.example.com/config"]);
    for (const c of calls) expect(c.headers.authorization).toBe("Bearer tok_secret");
    expect(lines).toEqual(["[vercel] POST /v10/projects/prj_1/domains → 409 domain_already_in_use"]);
    expect(lines.join("\n")).not.toContain("SECRET");
  });

  it("throws the original add error when the read-back fails, and does not read back on 429 or 5xx", async () => {
    const { calls, fetchFn } = fakeFetch((c) => {
      if (c.method === "POST") return { status: 409, json: { error: { code: "domain_already_in_use", message: "taken" } } };
      if (c.method === "GET" && c.url.includes("/v9/projects/")) return { status: 404, json: { error: { code: "not_found", message: "no" } } };
      return undefined;
    });
    const err = await deployer(fetchFn).addDomain("prj_1", "cafe.example.com").catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "VercelError", status: 409, code: "domain_already_in_use" });
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    for (const status of [429, 500]) {
      const { calls: c2, fetchFn: f2 } = fakeFetch(() => ({ status, json: { error: { code: "x", message: "y" } } }));
      await expect(deployer(f2).addDomain("prj_1", "cafe.example.com")).rejects.toMatchObject({ status });
      expect(c2.map((c) => c.method)).toEqual(["POST"]);
    }
  });

  it("throws a VercelError with the status and code, with the provider message capped and nothing logged from the body", async () => {
    const lines: string[] = [];
    const { fetchFn } = fakeFetch((c) => (c.method === "POST" ? { status: 403, json: { error: { code: "forbidden", message: `nope ${"x".repeat(500)} SECRET` } } } : undefined));
    const dep = new VercelDeployer({ token: "tok_secret", files, fetch: fetchFn, log: (s) => lines.push(s) });
    const err = await dep.addDomain("prj_1", "cafe.example.com").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VercelError);
    expect(err).toMatchObject({ status: 403, code: "forbidden" });
    expect((err as Error).message.length).toBeLessThanOrEqual(200);
    expect((err as Error).message).not.toContain("SECRET");
    expect(lines).toEqual(["[vercel] POST /v10/projects/prj_1/domains → 403 forbidden", "[vercel] GET /v9/projects/prj_1/domains/cafe.example.com → 404 not_found"]);
    expect(lines.join("\n")).not.toContain("tok_secret");
  });
});
