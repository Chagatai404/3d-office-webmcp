import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

export function createAuthenticatedServerClient(accessToken: string): SupabaseClient {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
