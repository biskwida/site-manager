// scripts/account-invite.mts
// npm run account:invite -- --slug coffique --email owner@example.com
// Promises the venue to that email (the first sign-in with it links the account as owner) and emails a sign-in link through Resend.
// Without RESEND_API_KEY it only stores the invite: the owner signs in at /login with that email. Never prints the link or a key.
import { createClient } from "@supabase/supabase-js";
import { accountInviteLines, inviteAccount } from "../src/server/account-invite";
import { makeServerDeps } from "../src/server/deps";
import { sendEmail } from "../src/server/email";
import { parseArgs } from "./invite-lines.mts";

const USAGE = `Usage: npm run account:invite -- --slug my-cafe --email owner@example.com`;

const args = parseArgs(process.argv);
const slug = args.get("slug")?.trim();
const email = args.get("email")?.trim();
if (!slug || !email) {
  console.error(USAGE);
  process.exit(1);
}

const deps = await makeServerDeps({ defer: (fn) => void fn() });
const { config } = deps;
if (deps.isMemory) console.log("note: MEMORY store, the invite is lost on exit.");
const appUrl = `https://${config.appHost}`;
const admin = deps.isMemory ? null : createClient(config.supabaseUrl, config.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const outcome = await inviteAccount(
  {
    store: deps.store,
    appUrl,
    emailEnabled: Boolean(config.resendApiKey) && admin !== null,
    generateLink: async (to, redirectTo) => {
      if (!admin) throw new Error("no Supabase admin client in memory mode");
      const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: to, options: { redirectTo } });
      if (error) throw new Error(`Supabase generateLink: ${error.message}`);
      return { hashedToken: data.properties?.hashed_token ?? null, actionLink: data.properties?.action_link ?? null };
    },
    send: (msg) => sendEmail(msg, { apiKey: config.resendApiKey, from: config.emailFrom }),
  },
  { slug, email },
);
for (const line of accountInviteLines(outcome, appUrl)) console.log(line);
if (outcome.status === "unknown_venue" || outcome.status === "bad_email") process.exit(1);
