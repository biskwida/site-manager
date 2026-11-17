// src/server/google-connect.ts
// Server-only. Connects a venue's Google Business Profile (opening hours, holidays, review replies; src/destinations/google.ts).
// Started from the dashboard (admin key or owner session), finished by Google's OAuth redirect:
// - consent for the one scope business.manage with offline access → authorization code → refresh token → the accounts' verified
//   locations; one is stored, several → a BG/EN chooser whose forms carry a signed, short-lived state with the encrypted refresh
//   token; choosing lists the locations again and stores the pick (it must be one of them).
// Shares the state, nonce cookie and pages of src/server/social-connect.ts; the state key is derived from the Google client secret,
// and each state is good for one step only ("google" for the callback, "google_select" for the chooser).
// redirect_uri is built from the request's own origin when its host is a known one (PUBLIC_BASE_URL, APP_HOST, LEGACY_HOSTS,
// localhost), so the nonce cookie and the session of that host come back with the callback; any other host gets PUBLIC_BASE_URL.
// The refresh token is stored only encrypted in the destination's secrets; it is never logged, rendered or put in a URL, and it
// rides in the chooser's state only encrypted. Access tokens live in memory for one request.
import { randomBytes } from "node:crypto";
import type { Config } from "../config";
import type { Venue } from "../domain/types";
import { exchangeGoogleCode, getLocation, GOOGLE_AUTH_URL, GOOGLE_SCOPE, GoogleApiError, googleAccessToken, GoogleClient, listLocations, type GoogleLocation, type GooglePeriod } from "../destinations/google-api";
import { decryptSecrets, encryptSecrets } from "../destinations/secrets";
import type { Destination } from "../store/types";
import { parseLegacyHosts } from "./host";
import {
  backToDashboard, checkState, esc, genericPage, htmlPage, NO_STORE, nonceCookie, type ReturnTarget, type SocialAuth, type SocialConnectDeps, type SocialResult,
  SOCIAL_STATE_TTL_MS, signSocialState, stateKey,
} from "./social-connect";

export const GOOGLE_CALLBACK_PATH = "/api/social/google/callback";
export const GOOGLE_SELECT_PATH = "/api/social/google/select";
/** What Claudia reads of the location right after connecting (Task 5 compares the hours). */
const CONNECTED_READ_MASK = "regularHours,metadata";

/** Destination config of kind "google" (not secret). Secrets: `{ refresh_token }`, encrypted. */
export interface GoogleConfig {
  account_name: string;
  location_name: string;
  location_v4: string;
  title: string;
  address: string;
  connected_at: string;
  /** Display name of the Google account that connected (the accounts list's accountName). */
  google_account_name: string;
  last_review_poll_at?: string;
  last_hours_push_at?: string;
  hours_pushed?: boolean;
  hours_conflict?: boolean;
  google_hours?: GooglePeriod[];
  special_dates_pushed?: string[];
  revoked_notified_at?: string;
}

export interface GoogleConnectDeps extends SocialConnectDeps {
  /** Called after a location is stored (Task 5 wires the chat message); failures are caught and logged by class only. */
  onConnected?: (venue: Venue, destination: Destination, current: GoogleLocation) => Promise<void>;
}

type LocationRow = Awaited<ReturnType<typeof listLocations>>[number];

/** The Connect Google button needs the OAuth client id + secret and the destination key. */
export function googleAvailability(c: Pick<Config, "googleClientId" | "googleClientSecret">, secretKey: Buffer | null): boolean {
  return Boolean(secretKey && c.googleClientId && c.googleClientSecret);
}

const hostnameOf = (u: string): string | null => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};

/** The origin to build redirect_uri and the way back from: the request's own origin when its host is the host of PUBLIC_BASE_URL, config.appHost, a host in LEGACY_HOSTS, localhost or 127.0.0.1; otherwise PUBLIC_BASE_URL. */
export function connectOrigin(req: Request, c: Pick<Config, "publicBaseUrl" | "appHost">, env: Record<string, string | undefined> = process.env): string {
  const url = new URL(req.url);
  if (url.protocol !== "https:" && url.protocol !== "http:") return c.publicBaseUrl;
  const known = new Set<string>(["localhost", "127.0.0.1", ...parseLegacyHosts(env), c.appHost.toLowerCase().replace(/:.*$/, "")]);
  const base = hostnameOf(c.publicBaseUrl);
  if (base) known.add(base);
  return known.has(url.hostname.toLowerCase()) ? url.origin : c.publicBaseUrl;
}

/** Google resource names this module builds URLs from; anything else is left out rather than trusted. */
const ACCOUNT_NAME = /^accounts\/[A-Za-z0-9_-]{1,64}$/;
const LOCATION_NAME = /^locations\/[A-Za-z0-9_-]{1,64}$/;

/** Verified (metadata.hasVoiceOfMerchant === true) and with a storefrontAddress or a serviceArea. */
export function eligibleLocations(rows: Awaited<ReturnType<typeof listLocations>>): typeof rows {
  return rows.filter(
    (r) => ACCOUNT_NAME.test(r.account_name) && LOCATION_NAME.test(r.location.name) && r.location.metadata?.hasVoiceOfMerchant === true && Boolean(r.location.storefrontAddress || r.location.serviceArea),
  );
}

/** addressLines + locality joined with ", "; "" when there is no storefront address. */
export function oneLineAddress(l: GoogleLocation): string {
  const a = l.storefrontAddress;
  if (!a) return "";
  return [...(a.addressLines ?? []), a.locality ?? ""].map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean).join(", ");
}

const titleOf = (l: GoogleLocation) => (typeof l.title === "string" && l.title.trim() ? l.title.trim().slice(0, 200) : l.name);

/** Class and code of an error, never its message (a Google message could echo request data). */
const errorTag = (e: unknown) => (e instanceof GoogleApiError ? `${e.name} ${e.code}` : e instanceof Error ? e.name : "error");

// ---------------------------------------------------------------------------------------------------------------------
// Start

const UNAVAILABLE = () =>
  Response.json(
    { error: { code: "social_unavailable", bg: "Свързването с Google не е включено на този сървър.", en: "Connecting Google is not enabled on this server." } },
    { status: 503, headers: NO_STORE },
  );

/** GET /api/admin/[slug]/social/google/start → 302 to Google's consent screen with a signed state and a nonce cookie. */
export async function handleGoogleStart(req: Request, d: GoogleConnectDeps, venue: Venue, auth: SocialAuth, opts: { ret?: ReturnTarget } = {}): Promise<Response> {
  if (!googleAvailability(d.config, d.secretKey) || !d.secretKey) return UNAVAILABLE();
  const nonce = randomBytes(16).toString("hex");
  const who = typeof auth === "string" ? { r: encryptSecrets({ key: auth }, d.secretKey) } : { r: "", a: "session" as const, ...(opts.ret ? { ret: opts.ret } : {}) };
  const state = signSocialState({ k: "google", v: venue.id, n: nonce, exp: d.now().getTime() + SOCIAL_STATE_TTL_MS, ...who }, stateKey(d.config.googleClientSecret!));
  const origin = connectOrigin(req, d.config);
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", d.config.googleClientId!);
  url.searchParams.set("redirect_uri", `${origin}${GOOGLE_CALLBACK_PATH}`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: url.toString(), "set-cookie": nonceCookie(nonce, SOCIAL_STATE_TTL_MS / 1000, origin.startsWith("https://")), "referrer-policy": "no-referrer" } });
}

// ---------------------------------------------------------------------------------------------------------------------
// Storing

async function storeGoogle(d: GoogleConnectDeps, venue: Venue, row: LocationRow, refreshToken: string, client: GoogleClient): Promise<void> {
  const old = await d.store.getDestination(venue.id, "google");
  // A reconnect starts over (hours_pushed, hours_conflict, revoked_notified_at are dropped); the special dates Claudia wrote stay
  // hers only when it is the same location.
  const carried = old && old.config.location_name === row.location.name && Array.isArray(old.config.special_dates_pushed)
    ? { special_dates_pushed: old.config.special_dates_pushed.filter((x): x is string => typeof x === "string") }
    : {};
  const config: GoogleConfig = {
    account_name: row.account_name,
    location_name: row.location.name,
    location_v4: `${row.account_name}/${row.location.name}`,
    title: titleOf(row.location),
    address: oneLineAddress(row.location).slice(0, 300),
    connected_at: d.now().toISOString(),
    google_account_name: (row.account_label || "").slice(0, 200),
    ...carried,
  };
  const destination = await d.store.upsertDestination({ venue_id: venue.id, kind: "google", status: "connected", config: { ...config }, secrets: encryptSecrets({ refresh_token: refreshToken }, d.secretKey!) });
  if (!d.onConnected) return;
  try {
    await d.onConnected(venue, destination, await getLocation(client, row.location.name, CONNECTED_READ_MASK));
  } catch (e) {
    console.error(`[google] after-connect step failed for venue ${venue.id}: ${errorTag(e)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Callback and chooser

function chooserPage(rows: LocationRow[], selectState: string): Response {
  const forms = rows
    .map((r) => {
      const address = oneLineAddress(r.location);
      return `<form method="post" action="${GOOGLE_SELECT_PATH}"><input type="hidden" name="state" value="${esc(selectState)}"><input type="hidden" name="location" value="${esc(r.location.name)}"><button type="submit">${esc(titleOf(r.location))}${address ? `<br><span class="en">${esc(address)}</span>` : ""}</button></form>`;
    })
    .join("");
  return htmlPage(
    "Изберете профила · Choose the profile",
    `<h1>Изберете профила</h1><p>Този Google акаунт управлява няколко профила. Изберете този на бизнеса.</p><p class="en">${esc("Choose the profile: this Google account manages several business profiles. Pick this business's.")}</p>${forms}`,
  );
}

/** GET /api/social/google/callback?code&state (or ?error=access_denied). */
export async function handleGoogleCallback(req: Request, d: GoogleConnectDeps): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const checked = await checkState(d, params.get("state"), "google", req.headers.get("cookie"));
  if (!checked || !checked.sameBrowser || params.get("error")) return genericPage();
  const { venue, adminKey, state } = checked;
  const origin = connectOrigin(req, d.config);
  const back = (r: SocialResult) => backToDashboard(d, venue.slug, adminKey, r, state.ret, { base: origin, anchor: "google" });
  const code = params.get("code") ?? "";
  if (!code || code.length > 2048) return back("google_error");
  try {
    const creds = { clientId: d.config.googleClientId!, clientSecret: d.config.googleClientSecret! };
    // The same redirect_uri as the start: this request arrived on it.
    const tokens = await exchangeGoogleCode(d.fetch, creds, code, `${origin}${GOOGLE_CALLBACK_PATH}`);
    const client = new GoogleClient(tokens.access_token, d.fetch);
    const rows = eligibleLocations(await listLocations(client));
    if (rows.length === 0) return back("google_no_locations");
    if (rows.length === 1) {
      await storeGoogle(d, venue, rows[0], tokens.refresh_token, client);
      return back("google_connected");
    }
    const selectState = signSocialState(
      { k: "google_select", v: venue.id, n: state.n, exp: d.now().getTime() + SOCIAL_STATE_TTL_MS, r: state.r, ...(state.a ? { a: state.a } : {}), ...(state.ret ? { ret: state.ret } : {}), t: encryptSecrets({ refresh_token: tokens.refresh_token }, d.secretKey!) },
      stateKey(d.config.googleClientSecret!),
    );
    return chooserPage(rows, selectState);
  } catch (e) {
    console.error(`[google] callback failed for venue ${venue.id}: ${errorTag(e)}`);
    return back("google_error");
  }
}

/** POST /api/social/google/select (form: state, location) from the chooser. */
export async function handleGoogleSelect(req: Request, d: GoogleConnectDeps): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const raw = form?.get("state");
  const locationName = form?.get("location");
  const checked = await checkState(d, typeof raw === "string" ? raw : null, "google_select", req.headers.get("cookie"));
  if (!checked || !checked.sameBrowser) return genericPage();
  const { venue, adminKey, state } = checked;
  const back = (r: SocialResult) => backToDashboard(d, venue.slug, adminKey, r, state.ret, { base: connectOrigin(req, d.config), anchor: "google" });
  if (typeof locationName !== "string" || !state.t) return back("google_error");
  try {
    const refreshToken = decryptSecrets(state.t, d.secretKey!).refresh_token ?? "";
    if (!refreshToken) return back("google_error");
    const creds = { clientId: d.config.googleClientId!, clientSecret: d.config.googleClientSecret! };
    const client = new GoogleClient(await googleAccessToken(d.fetch, creds, refreshToken), d.fetch);
    const row = eligibleLocations(await listLocations(client)).find((r) => r.location.name === locationName);
    if (!row) return back("google_error");
    await storeGoogle(d, venue, row, refreshToken, client);
    return back("google_connected");
  } catch (e) {
    console.error(`[google] select failed for venue ${venue.id}: ${errorTag(e)}`);
    return back("google_error");
  }
}
