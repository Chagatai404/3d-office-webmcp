/**
 * `supabase db reset` returns while the stack is still restarting, so a suite
 * started immediately after it can fail with "Database client error" from
 * PostgREST, or subscribe to a realtime channel that never delivers changes.
 * Poll REST, Auth and a real `postgres_changes` subscription until all answer.
 */
import { createClient } from "@supabase/supabase-js";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const timeoutMs = Number(process.env.SUPABASE_READY_TIMEOUT_MS ?? 90_000);
const settleMs = Number(process.env.SUPABASE_READY_SETTLE_MS ?? 1_500);
const deadline = Date.now() + timeoutMs;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpReady() {
  const responses = await Promise.all(
    [`${baseUrl}/rest/v1/`, `${baseUrl}/auth/v1/health`].map((url) =>
      fetch(url, { cache: "no-store" }).then(
        (response) => response.ok,
        () => false,
      ),
    ),
  );
  return responses.every(Boolean);
}

/** Registers the same kind of subscription the app uses, as an authenticated user. */
async function realtimeReady() {
  const client = createClient(baseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.session) return false;
  await client.realtime.setAuth(data.session.access_token);

  return new Promise((resolve) => {
    const channel = client.channel("supabase-readiness-probe").on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "rooms" },
      () => {},
    );
    const settle = (ready) => {
      clearTimeout(timer);
      void client.removeChannel(channel).finally(() => resolve(ready));
    };
    const timer = setTimeout(() => settle(false), 10_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") settle(true);
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") settle(false);
    });
  });
}

while (!((await httpReady()) && (await realtimeReady()))) {
  if (Date.now() > deadline) {
    console.error(`Supabase at ${baseUrl} was not ready within ${timeoutMs}ms.`);
    process.exit(1);
  }
  await sleep(500);
}

// The subscription pipeline needs a moment after the first successful attach.
await sleep(settleMs);
