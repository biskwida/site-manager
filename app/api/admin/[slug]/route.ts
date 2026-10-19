import { after } from "next/server";
import { adminCommentAction, parseAdminCommentAction } from "@/src/server/admin-comments";
import { adminAction, adminOverview, checkDomain, connectDomain, setTemplate, type AdminActionName } from "@/src/server/admin";
import { newOwnerCode } from "@/src/server/connect-apps";
import { getServerDeps } from "@/src/server/deps";
import { socialAvailability } from "@/src/server/social-connect";

export const dynamic = "force-dynamic";
// A template switch keeps watching the redeploy in after() for up to 240 s.
export const maxDuration = 300;

async function auth(req: Request, slug: string) {
  const deps = await getServerDeps((fn) => after(fn));
  const key = new URL(req.url).searchParams.get("key");
  const venue = key ? await deps.store.findVenueByAdminToken(key) : null;
  if (!venue || venue.slug !== slug) return { deps, venue: null };
  return { deps, venue };
}

export async function GET(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await adminOverview(deps.store, venue, new Date(), deps.config.publicBaseUrl, { hosted: deps.deployer === null, social: socialAvailability(deps.config, deps.destinationSecretKey) }), { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/[slug]">) {
  const { slug } = await ctx.params;
  const { deps, venue } = await auth(req, slug);
  if (!venue) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; change_set_id?: string; template?: unknown; domain?: unknown };
  const siteDeps = { store: deps.store, deployer: deps.deployer, feedUrlFor: (s: string) => `${deps.config.publicBaseUrl}/api/site/${encodeURIComponent(s)}`, now: () => new Date() };
  if (body.action === "set_template") {
    const r = await setTemplate(siteDeps, venue, body.template);
    // Finish the redeploy (and send the owner's "new design is live") without depending on an open dashboard.
    if (r.ok && (r.deploy?.status === "pending" || r.deploy?.status === "building")) deps.watchDeploy(venue.id);
    // 409 while a deploy is in flight or for an own-site venue (the card shows the localized message); 400 for a template id we do not have; 500 when the store refused the write.
    return Response.json(r, { status: r.ok ? 200 : r.code === "busy" || r.code === "own_site" || r.code === "no_site" ? 409 : r.code === "failed" ? 500 : 400 });
  }
  if (body.action === "add_domain" || body.action === "check_domain") {
    const r = body.action === "add_domain" ? await connectDomain(siteDeps, venue, body.domain) : await checkDomain(siteDeps, venue);
    // 400 for a hostname we cannot use; 409 when there is no ready site, no stored domain, a redeploy in flight, the provider refused, or this server has no deployer.
    return Response.json(r, { status: r.ok ? 200 : r.code === "invalid_domain" ? 400 : 409 });
  }
  if (body.action === "new_owner_code") {
    // "Connect another app": a fresh single-use owner code with one link per enabled app (rate limit shared with the wizard).
    const r = await newOwnerCode(deps.store, deps.config, venue, new Date());
    return Response.json(r, { status: r.ok ? 200 : r.error === "rate_limited" ? 429 : 409, headers: { "cache-control": "no-store" } });
  }
  if (body.action === "reply_comment" || body.action === "ignore_comment" || body.action === "set_comment_mode") {
    // The Comments card (owner's key): reply posts at once, ignore, notification mode. 400 for a malformed body; 409 when refused.
    const a = parseAdminCommentAction(body);
    if (!a) return Response.json({ error: "bad request" }, { status: 400 });
    const r = await adminCommentAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, a);
    return Response.json(r, { status: r.ok ? 200 : 409 });
  }
  const actions: AdminActionName[] = ["apply", "reject", "cancel", "undo"];
  if (!actions.includes(body.action as AdminActionName) || typeof body.change_set_id !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  const r = await adminAction({ store: deps.store, messenger: deps.messenger, now: () => new Date(), baseUrl: deps.config.publicBaseUrl }, venue, body.action as AdminActionName, body.change_set_id);
  return Response.json(r, { status: r.ok ? 200 : 409 });
}
