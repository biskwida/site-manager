// test/store-supabase.test.ts
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
  });
} else {
  describe("supabase store", () => {
    it.skip("live contract (set SUPABASE_CONTRACT=1 with Supabase keys in the env)", () => {});
  });
}
