import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One anonymous auth session per browser storage context. Every client-side
 * caller sends the resulting access token as a bearer token; actor authority is
 * always derived from it server-side.
 */
export async function ensureAnonymousAccessToken(
  supabase: SupabaseClient,
): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;
  const { data: signInData, error } = await supabase.auth.signInAnonymously();
  if (error || !signInData.session) {
    throw new Error(error?.message ?? "Anonymous sign-in failed.");
  }
  return signInData.session.access_token;
}
