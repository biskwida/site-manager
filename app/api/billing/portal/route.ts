// app/api/billing/portal/route.ts — opens the Stripe Customer Portal for the venue named in the body `{ slug, lang? }` (owner session only). 404 while BILLING_ENABLED is off.
import { after } from "next/server";
import { bodySlug, handlePortal, stripeClient } from "@/src/server/billing";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handlePortal(req, await bodySlug(req), { store: deps.store, config: deps.config, stripe: stripeClient(deps.config), now: () => new Date() });
}
