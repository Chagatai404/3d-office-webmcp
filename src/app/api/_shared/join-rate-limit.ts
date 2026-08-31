import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { ActionResult, JoinRequestResult } from "@/contracts/room";

type Bucket = { count: number; resetAt: number };
type Store = Map<string, Bucket>;

const WINDOW_MS = 60_000;
const LIMITS = { target: 8, actor: 20, ip: 40 } as const;
const globalRateLimit = globalThis as typeof globalThis & {
  __joinRateLimitStore?: Store;
};
const store = globalRateLimit.__joinRateLimitStore ??= new Map();

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")?.trim()
    ?? "unknown";
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function consume(key: string, limit: number, now: number): number | null {
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return null;
  }
  if (current.count >= limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  current.count += 1;
  return null;
}

/**
 * Best-effort route-layer throttling. The authenticated-session bucket cannot
 * be spoofed by request input; IP is a second deployment-proxy signal. This is
 * intentionally generic and stores only short hashes, never passcodes/tokens.
 */
export function consumeJoinAttempt(params: {
  request: Request;
  actorUserId: string;
  target: string;
  now?: number;
}): number | null {
  const now = params.now ?? Date.now();
  const actor = fingerprint(params.actorUserId);
  const ip = fingerprint(clientIp(params.request));
  const target = fingerprint(params.target);
  const retries = [
    consume(`actor:${actor}`, LIMITS.actor, now),
    consume(`ip:${ip}`, LIMITS.ip, now),
    consume(`target:${actor}:${ip}:${target}`, LIMITS.target, now),
  ].filter((value): value is number => value !== null);
  return retries.length === 0 ? null : Math.max(...retries);
}

export function joinRateLimitResponse(retryAfterSeconds: number) {
  const result: ActionResult<JoinRequestResult> = {
    ok: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many join attempts. Try again shortly.",
      recovery: `Wait ${retryAfterSeconds} seconds, then retry with the same meeting credentials.`,
    },
    roomVersion: 0,
  };
  return NextResponse.json(result, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfterSeconds) },
  });
}

export function resetJoinRateLimitForTests() {
  store.clear();
}
