// app/api/billing/checkout/route.ts — opens Stripe Checkout for the venue named in the body `{ slug, plan, website?, lang? }` (owner session only). 404 while BILLING_ENABLED is off.
import { after } from "next/server";
import { bodySlug, handleCheckout, stripeClient } from "@/src/server/billing";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleCheckout(req, await bodySlug(req), { store: deps.store, config: deps.config, stripe: stripeClient(deps.config), now: () => new Date() });
}
