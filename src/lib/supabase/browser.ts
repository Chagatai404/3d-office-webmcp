import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getSupabaseConfig();
  browserClient = createClient(url, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}
