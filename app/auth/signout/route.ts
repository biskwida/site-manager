// app/auth/signout/route.ts — POST signs the account out (clears the Supabase cookies) and goes to the home page.
import { createSessionClient } from "@/src/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = await createSessionClient();
    await supabase?.auth.signOut({ scope: "local" }); // this browser only: the owner's other devices stay signed in
  } catch {
    // Signing out never fails the visitor: they land on / either way.
  }
  return new Response(null, { status: 303, headers: { Location: new URL("/", req.url).toString() } });
}
