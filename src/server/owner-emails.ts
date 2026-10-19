// src/server/owner-emails.ts
// Server-only (service-role key). The sign-in emails of a venue's account owners, for the trial reminders. Accounts live in Supabase
// Auth (auth.users); venue_users links them to venues. The tick takes this as an injectable function (TrialBilling.ownerEmails), so
// tests fake it. Memory mode has no accounts: it returns none. A failed lookup returns none for that account, never a thrown error.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type OwnerEmails = (venueId: string) => Promise<string[]>;

/** Memory mode: there are no accounts. */
export const memoryOwnerEmails: OwnerEmails = async () => [];

/** The lookup against a Supabase client that holds the service-role key (venue_users, then auth.admin.getUserById). Emails are lower-cased and listed once. */
export function ownerEmailsFrom(db: Pick<SupabaseClient, "from" | "auth">): OwnerEmails {
  return async (venueId) => {
    const { data, error } = await db.from("venue_users").select("user_id").eq("venue_id", venueId).eq("role", "owner");
    if (error) throw new Error(`ownerEmails: ${error.message}`);
    const emails = new Set<string>();
    for (const row of data ?? []) {
      const { data: got, error: userError } = await db.auth.admin.getUserById(String(row.user_id));
      const email = userError ? null : got.user?.email;
      if (email) emails.add(email.trim().toLowerCase());
    }
    return [...emails];
  };
}

export function supabaseOwnerEmails(url: string, serviceRoleKey: string): OwnerEmails {
  return ownerEmailsFrom(createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }));
}
