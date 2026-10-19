// test/store-supabase.test.ts
import { createClient } from "@supabase/supabase-js";
import { describe, it } from "vitest";
import { SupabaseStore } from "@/src/store/supabase";
import { storeContract } from "./store-contract";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key && process.env.SUPABASE_CONTRACT === "1") {
  // Live run: SUPABASE_CONTRACT=1 npx tsx --env-file=.env.local node_modules/vitest/vitest.mjs run test/store-supabase.test.ts
  storeContract("supabase", async () => {
    const s = new SupabaseStore(url, key);
    s.slugPrefix = `test-${Date.now().toString(36)}-`;
    return s;
  }, async (_s, path) => {
    // Probe the media bucket directly: list the object's folder and look for its name.
    const db = createClient(url, key, { auth: { persistSession: false } });
    const slash = path.lastIndexOf("/");
    const { data, error } = await db.storage.from("media").list(path.slice(0, slash), { limit: 1000, search: path.slice(slash + 1) });
    if (error) throw new Error(`storage list: ${error.message}`);
    return (data ?? []).some((o) => o.name === path.slice(slash + 1));
  }, async () => {
    // venue_users.user_id references auth.users: make a real (throwaway) user per call.
    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.auth.admin.createUser({ email: `contract-${crypto.randomUUID()}@example.com`, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    return data.user.id;
  });
} else {
  describe("supabase store", () => {
    it.skip("live contract (set SUPABASE_CONTRACT=1 with Supabase keys in the env)", () => {});
  });
}
