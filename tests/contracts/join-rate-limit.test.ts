import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeJoinAttempt,
  joinRateLimitResponse,
  resetJoinRateLimitForTests,
} from "@/app/api/_shared/join-rate-limit";

function request(ip = "203.0.113.10") {
  return new Request("https://app.example/api/join-requests/passcode", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("join credential abuse mitigation", () => {
  beforeEach(() => resetJoinRateLimitForTests());

  it("throttles repeated attempts by authenticated session, IP, and target", () => {
    for (let index = 0; index < 8; index += 1) {
      expect(consumeJoinAttempt({
        request: request(),
        actorUserId: "auth-user-1",
        target: "passcode:room-a",
        now: 1_000,
      })).toBeNull();
    }
    expect(consumeJoinAttempt({
      request: request(),
      actorUserId: "auth-user-1",
      target: "passcode:room-a",
      now: 1_000,
    })).toBe(60);
  });

  it("allows a fresh window without retaining credential material", () => {
    for (let index = 0; index < 8; index += 1) {
      consumeJoinAttempt({
        request: request(), actorUserId: "auth-user-1", target: "invite:raw-secret", now: 1_000,
      });
    }
    expect(consumeJoinAttempt({
      request: request(), actorUserId: "auth-user-1", target: "invite:raw-secret", now: 61_001,
    })).toBeNull();
  });

  it("returns a generic ActionResult with Retry-After", async () => {
    const response = joinRateLimitResponse(17);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "RATE_LIMITED" },
      roomVersion: 0,
    });
  });
});
