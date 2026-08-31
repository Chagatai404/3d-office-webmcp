import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  actionResponse,
  invalidVersionResponse,
  mutationContext,
} from "@/app/api/_shared/request";
import type { ActionErrorCode, ActionResult } from "@/contracts/room";

const VERSIONED_ROOM_MUTATION_ROUTES = [
  "alignments",
  "approval",
  "claim-seat",
  "decision-policy",
  "decision-role",
  "join-requests/admit",
  "join-requests/reject",
  "lock",
  "objections",
  "ownership",
  "participants/configure",
  "participants/remove",
  "phase",
  "positions",
  "proposals",
  "ready",
  "resolve-objection",
  "sources",
  "sources/[sourceId]",
  "sources/[sourceId]/fail",
  "sources/[sourceId]/process",
  "sources/[sourceId]/share",
  "tradeoffs",
  "unlock",
] as const;

describe("HTTP mutation boundary", () => {
  it.each([undefined, "", "-1", "1.5", "NaN", "9007199254740992"])(
    "rejects an invalid If-Match value: %s",
    (value) => {
      const request = value === undefined
        ? new Request("https://app.example/api")
        : new Request("https://app.example/api", { headers: { "If-Match": value } });
      expect(mutationContext(request, "user-1"))
        .toBeNull();
    },
  );

  it("accepts a quoted non-negative version and derives actor identity outside the body", () => {
    expect(mutationContext(
      new Request("https://app.example/api", { headers: { "If-Match": '"17"' } }),
      "authenticated-user",
    )).toEqual({
      actor: { authUserId: "authenticated-user", origin: "manual_ui" },
      expectedRoomVersion: 17,
      humanConfirmed: false,
    });
  });

  it("maps the canonical refusal family to stable HTTP statuses", async () => {
    const expected: Record<ActionErrorCode, number> = {
      VALIDATION_ERROR: 400,
      NOT_AUTHORIZED: 403,
      WRONG_PHASE: 409,
      STALE_ROOM_STATE: 409,
      WAITING_FOR_PARTICIPANTS: 400,
      UNRESOLVED_BLOCKING_CONFLICT: 400,
      HUMAN_CONFIRMATION_REQUIRED: 400,
      DECISION_CHANGED: 400,
      ALREADY_FINALIZED: 400,
      INVALID_JOIN_CREDENTIALS: 400,
      ALREADY_PARTICIPANT: 400,
      REQUEST_ALREADY_RESOLVED: 400,
      MEETING_LOCKED: 400,
      RATE_LIMITED: 429,
    };
    for (const [code, status] of Object.entries(expected) as [ActionErrorCode, number][]) {
      const result: ActionResult = {
        ok: false,
        error: { code, message: "Refused." },
        roomVersion: 3,
      };
      const response = actionResponse(result);
      expect(response.status, code).toBe(status);
      expect(response.headers.get("cache-control"), code).toBe("no-store");
    }
    const invalid = invalidVersionResponse();
    expect(invalid.status).toBe(428);
    expect(await invalid.json()).toEqual({
      error: "A non-negative integer If-Match room version is required.",
    });
  });

  it.each(VERSIONED_ROOM_MUTATION_ROUTES)(
    "%s authenticates and requires optimistic concurrency before dispatch",
    (route) => {
      const source = readFileSync(
        resolve(process.cwd(), "src", "app", "api", "rooms", "[roomId]", route, "route.ts"),
        "utf8",
      );
      expect(source).toContain("authenticateRoomRequest(request)");
      expect(source).toMatch(/mutationContext\(\s*request,\s*auth\.userId/);
      expect(source).toContain("invalidVersionResponse()");
    },
  );
});
