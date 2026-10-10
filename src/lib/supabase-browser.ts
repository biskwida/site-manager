"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Only NEXT_PUBLIC_* here: this file ships to the browser.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const realtimeConfigured = !!url && !!anon;
let client: SupabaseClient | null = null;
export function supabaseBrowser(): SupabaseClient | null {
  if (!realtimeConfigured) return null;
  client ??= createClient(url as string, anon as string, { auth: { persistSession: false } });
  return client;
}
