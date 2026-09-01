import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getSupabaseConfig();
  browserClient = createClient(url, publishableKey, {
    // `sessionStorage`, not the default `localStorage`, on purpose: this app's
    // participant identity is one anonymous session per browser *tab*, not per
    // browser. `getSession()` re-reads its configured storage on every call
    // (see @supabase/auth-js's `__loadSession`), so with the shared,
    // origin-wide `localStorage` a fresh anonymous sign-in in any tab -- a
    // second room, a second agent -- silently became what every other open
    // tab's next authenticated request used, with no visible warning short of
    // a later 403. `sessionStorage` is scoped to this tab alone, so one tab's
    // sign-in can never leak into another's, while a same-tab reload still
    // keeps the same identity (mirrors the invite-link stash in
    // `room/invite-stash.ts` for the same reason).
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof window === "undefined" ? undefined : window.sessionStorage,
    },
  });
  return browserClient;
}
