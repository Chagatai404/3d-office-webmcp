import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./config";

let browserClient: SupabaseClient | null = null;

/** The anonymous JWT's `sub` claim, or null if `raw` isn't a readable session. */
function sessionSubject(raw: string | null): string | null {
  try {
    const token = (JSON.parse(raw!) as { access_token: string }).access_token;
    const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(payload)) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Plain `localStorage`, guarded against another tab's sign-in retroactively
 * changing who *this* tab is.
 *
 * `getSession()` re-reads its configured storage on every call (see
 * @supabase/auth-js's `__loadSession`), not just once at startup, and
 * `localStorage` shares one key across every tab of the origin. Without a
 * guard, a fresh anonymous sign-in in any tab -- a second room, a second
 * agent -- silently became what every other already-open tab's next
 * authenticated request used, with no visible warning short of a later 403.
 *
 * A tab's very first read simply adopts whatever is already in
 * `localStorage`, including nothing at all (inheriting an existing identity
 * is exactly what a second tab or a middle-clicked link should do), and
 * remembers that session's `sub`. Every later read compares the current
 * `sub` in storage against the remembered one: unchanged (including an
 * ordinary token refresh, which keeps the same `sub`) passes straight
 * through, so refresh-token rotation still has the single shared copy it
 * needs to stay valid. Anything else -- a *different* `sub`, or the entry
 * now missing entirely -- means some other tab signed in as someone else,
 * or cleared storage, in the meantime; this tab ignores that and keeps
 * answering from its own last confirmed session instead of silently
 * becoming signed out or someone else. Writes always land in `localStorage`
 * (so a brand-new tab opened afterward still inherits whichever identity
 * most recently signed in), and this tab's own refresh or sign-out updates
 * its remembered session the same way a first read would.
 */
let rememberedSession: string | null = null;
let hasRemembered = false;
let rememberedSubject: string | null = null;

const guardedStorage = {
  getItem(key: string): string | null {
    const current = localStorage.getItem(key);
    if (!hasRemembered) {
      rememberedSession = current;
      hasRemembered = true;
      rememberedSubject = sessionSubject(current);
      return current;
    }
    const currentSubject = sessionSubject(current);
    if (currentSubject !== null && currentSubject === rememberedSubject) {
      rememberedSession = current;
      return current;
    }
    return rememberedSession;
  },
  setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
    rememberedSession = value;
    hasRemembered = true;
    rememberedSubject = sessionSubject(value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    rememberedSession = null;
    hasRemembered = true;
    rememberedSubject = null;
  },
};

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getSupabaseConfig();
  browserClient = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: typeof window === "undefined" ? undefined : guardedStorage,
    },
  });
  return browserClient;
}
