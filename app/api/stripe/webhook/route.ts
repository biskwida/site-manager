// app/api/stripe/webhook/route.ts — Stripe's events (signature verified on the raw body, each event applied once). Works whatever BILLING_ENABLED says.
import { after } from "next/server";
import { handleStripeWebhook, stripeClient } from "@/src/server/billing";
import { getServerDeps } from "@/src/server/deps";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const deps = await getServerDeps((fn) => after(fn));
  return handleStripeWebhook(req, { store: deps.store, config: deps.config, stripe: stripeClient(deps.config), now: () => new Date() });
}
