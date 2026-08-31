import { describe, expect, it } from "vitest";
import type { JsonValue } from "@/contracts/room";
import { computeRoomUpdates } from "@/domain/rooms/room-updates";
import { deriveRoomCapabilityContext, getAvailableWebMcpToolNames } from "@/webmcp/capability-context";
import { createRoomWebMcpTools } from "@/webmcp/room-tools";
import { buildRoomStateFixture, executeTool, fakeRoomWebMcpContext } from "./fake-context";

const owner = { id: "participant-owner", name: "Ata", role: "Founder", kind: "human" as const, meetingRole: "owner" as const, decisionRole: "decision_maker" as const, isClaimed: true, isReady: true, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:00.000Z" };
const engineer = { id: "participant-engineer", name: "Maya", role: "Engineer", kind: "human" as const, meetingRole: "participant" as const, decisionRole: "contributor" as const, isClaimed: true, isReady: false, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:01.000Z" };

function event(overrides: {
  id: string;
  action: string;
  previousRoomVersion: number;
  resultingRoomVersion: number;
  actorId?: string | null;
  actorType?: "participant" | "expert" | "system";
  entityType?: string | null;
  entityId?: string | null;
  result?: unknown;
  sanitizedInput?: unknown;
  createdAt?: string;
}) {
  return {
    id: overrides.id,
    actorType: overrides.actorType ?? "participant",
    actorId: overrides.actorId ?? "participant-engineer",
    origin: "webmcp" as const,
    action: overrides.action,
    entityType: overrides.entityType ?? null,
    entityId: overrides.entityId ?? null,
    sanitizedInput: (overrides.sanitizedInput ?? {}) as JsonValue,
    result: (overrides.result ?? { ok: true }) as JsonValue,
    previousRoomVersion: overrides.previousRoomVersion,
    resultingRoomVersion: overrides.resultingRoomVersion,
    confirmationRequired: false,
    createdAt: overrides.createdAt ?? "2026-08-30T00:00:00.000Z",
  };
}

describe("computeRoomUpdates", () => {
  it("returns nothing at or below the observed version", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({ id: "e1", action: "position.added", previousRoomVersion: 5, resultingRoomVersion: 6 })],
    });
    expect(computeRoomUpdates(room, 6)).toEqual([]);
    expect(computeRoomUpdates(room, 10)).toEqual([]);
  });

  it("maps every required-coverage action to a distinct, correctly attributed update type", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [
        event({ id: "e-removed", action: "participant.removed", previousRoomVersion: 0, resultingRoomVersion: 1, actorId: "participant-owner" }),
        event({ id: "e-role", action: "participant.decision_role_changed", previousRoomVersion: 1, resultingRoomVersion: 2, actorId: "participant-owner" }),
        event({
          id: "e-configured",
          action: "participant.configured",
          previousRoomVersion: 2,
          resultingRoomVersion: 3,
          actorId: "participant-owner",
          sanitizedInput: {
            participantId: "participant-engineer",
            role: { from: "Engineer", to: "CTO" },
            decisionRole: { from: "contributor", to: "decision_maker" },
          },
        }),
        event({ id: "e-input", action: "position.added", previousRoomVersion: 3, resultingRoomVersion: 4 }),
        event({ id: "e-ready", action: "participant.input_ready", previousRoomVersion: 3, resultingRoomVersion: 4 }),
        event({ id: "e-proposal", action: "proposal.submitted", previousRoomVersion: 4, resultingRoomVersion: 5 }),
        event({ id: "e-concern", action: "objection.raised", previousRoomVersion: 5, resultingRoomVersion: 6 }),
        event({ id: "e-resolved", action: "conflict.resolved", previousRoomVersion: 6, resultingRoomVersion: 7 }),
        event({ id: "e-tradeoff", action: "tradeoff.proposed", previousRoomVersion: 7, resultingRoomVersion: 8 }),
        event({ id: "e-alignment", action: "alignment.expressed", previousRoomVersion: 8, resultingRoomVersion: 9 }),
        event({ id: "e-approval-frozen", action: "room.phase_advanced", previousRoomVersion: 9, resultingRoomVersion: 10, actorId: "participant-owner", result: { ok: true, decisionHash: "hash-1" } }),
        event({ id: "e-approved", action: "approval.recorded", previousRoomVersion: 10, resultingRoomVersion: 11 }),
        event({ id: "e-finalized", action: "decision.finalized", previousRoomVersion: 11, resultingRoomVersion: 12 }),
        event({ id: "e-expert-raised", action: "expert_finding.raised", previousRoomVersion: 12, resultingRoomVersion: 13, actorType: "expert", actorId: null }),
        event({ id: "e-expert-resolved", action: "expert_finding.resolved", previousRoomVersion: 13, resultingRoomVersion: 14, actorType: "expert", actorId: null }),
        event({ id: "e-expert-disposed", action: "expert_finding.disposition_recorded", previousRoomVersion: 14, resultingRoomVersion: 15, actorId: "participant-owner" }),
      ],
    });
    const updates = computeRoomUpdates(room, 0);
    const typeById = new Map(updates.map((u) => [u.id, u.type]));
    expect(typeById.get("e-removed")).toBe("participant_removed");
    expect(typeById.get("e-role")).toBe("decision_role_changed");
    expect(typeById.get("e-configured")).toBe("participant_configured");
    expect(updates.find((update) => update.id === "e-configured")?.changedFields).toEqual([
      "role",
      "decisionRole",
    ]);
    expect(typeById.get("e-input")).toBe("input_shared");
    expect(typeById.get("e-ready")).toBe("readiness_changed");
    expect(typeById.get("e-proposal")).toBe("proposal_submitted");
    expect(typeById.get("e-concern")).toBe("concern_raised");
    expect(typeById.get("e-resolved")).toBe("concern_resolved");
    expect(typeById.get("e-tradeoff")).toBe("tradeoff_proposed");
    expect(typeById.get("e-alignment")).toBe("alignment_changed");
    expect(typeById.get("e-approval-frozen")).toBe("phase_changed");
    expect(typeById.get("e-approved")).toBe("approval_recorded");
    expect(typeById.get("e-finalized")).toBe("meeting_finalized");
    expect(typeById.get("e-expert-raised")).toBe("expert_finding_raised");
    expect(typeById.get("e-expert-resolved")).toBe("expert_finding_resolved");
    expect(typeById.get("e-expert-disposed")).toBe("expert_finding_dispositioned");
    expect(updates).toHaveLength(16);
  });

  it("labels a child proposal as a revision and carries its superseded parent id", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({
        id: "revision",
        action: "proposal.submitted",
        previousRoomVersion: 4,
        resultingRoomVersion: 5,
        sanitizedInput: { parentProposalId: "proposal-original" },
      })],
    });
    expect(computeRoomUpdates(room, 0)[0]).toMatchObject({
      type: "proposal_revised",
      parentProposalId: "proposal-original",
    });
  });

  it("surfaces the frozen decision hash on the phase-change event that entered approval", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({
        id: "e1", action: "room.phase_advanced", previousRoomVersion: 4, resultingRoomVersion: 5,
        actorId: "participant-owner", result: { ok: true, decisionHash: "hash-abc" },
      })],
    });
    const [update] = computeRoomUpdates(room, 0);
    expect(update!.decisionHash).toBe("hash-abc");
  });

  it("resolves the actor's name from the current participant roster", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({ id: "e1", action: "position.added", previousRoomVersion: 0, resultingRoomVersion: 1, actorId: "participant-engineer" })],
    });
    expect(computeRoomUpdates(room, 0)[0]!.actorName).toBe("Maya");
  });

  it("drops approval.requested -- it never bumps the room version and is not a real change", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({ id: "e1", action: "approval.requested", previousRoomVersion: 5, resultingRoomVersion: 5 })],
    });
    expect(computeRoomUpdates(room, 4)).toEqual([]);
  });

  it("falls back to type 'other' for an unrecognized action instead of dropping it", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [event({ id: "e1", action: "something.new", previousRoomVersion: 0, resultingRoomVersion: 1 })],
    });
    expect(computeRoomUpdates(room, 0)[0]!.type).toBe("other");
  });

  it("orders results by room version, oldest first", () => {
    const room = buildRoomStateFixture({
      participants: [owner, engineer],
      activity: [
        event({ id: "later", action: "position.added", previousRoomVersion: 2, resultingRoomVersion: 3, createdAt: "2026-08-30T00:00:02.000Z" }),
        event({ id: "earlier", action: "participant.input_ready", previousRoomVersion: 1, resultingRoomVersion: 2, createdAt: "2026-08-30T00:00:01.000Z" }),
      ],
    });
    expect(computeRoomUpdates(room, 0).map((u) => u.id)).toEqual(["earlier", "later"]);
  });
});

describe("get_room_updates WebMCP tool", () => {
  it("is available in every phase, including before a seat is claimed", () => {
    for (const phase of ["input", "proposals", "deliberation", "voting", "approval", "finalized"] as const) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: null });
      const names = getAvailableWebMcpToolNames(deriveRoomCapabilityContext(room));
      expect(names, phase).toContain("get_room_updates");
    }
  });

  it("clearly indicates when there are no new updates", async () => {
    const room = buildRoomStateFixture({ version: 9, activity: [] });
    const context = fakeRoomWebMcpContext({ room, roomVersion: 9 });
    const result = await executeTool(createRoomWebMcpTools(context).get_room_updates!, { sinceVersion: 9 }) as {
      ok: boolean;
      message: string;
      data: { updateCount: number; updates: unknown[]; currentRoomVersion: number };
    };
    expect(result.ok).toBe(true);
    expect(result.data.updateCount).toBe(0);
    expect(result.data.updates).toEqual([]);
    expect(result.data.currentRoomVersion).toBe(9);
    expect(result.message).toMatch(/no new updates/i);
  });

  it("returns Agent B's relevant change to Agent A without either inspecting the DOM", async () => {
    const roomAfterB = buildRoomStateFixture({
      version: 6,
      participants: [owner, engineer],
      activity: [event({ id: "b-action", action: "proposal.submitted", previousRoomVersion: 5, resultingRoomVersion: 6, actorId: "participant-engineer" })],
    });
    const context = fakeRoomWebMcpContext({ room: roomAfterB, roomVersion: 6 });
    const result = await executeTool(createRoomWebMcpTools(context).get_room_updates!, { sinceVersion: 5 }) as {
      data: { updates: Array<{ type: string; actorName: string | null }> };
    };
    expect(result.data.updates).toHaveLength(1);
    expect(result.data.updates[0]!.type).toBe("proposal_submitted");
    expect(result.data.updates[0]!.actorName).toBe("Maya");
  });

  it("rejects a non-numeric sinceVersion before reaching the domain", async () => {
    const result = await executeTool(createRoomWebMcpTools(fakeRoomWebMcpContext()).get_room_updates!, { sinceVersion: "not-a-number" }) as {
      ok: boolean; error: { code: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("bounds large update responses and returns a continuation version", async () => {
    const activity = Array.from({ length: 105 }, (_, index) => event({
      id: `event-${index}`,
      action: "position.added",
      previousRoomVersion: index,
      resultingRoomVersion: index + 1,
    }));
    const room = buildRoomStateFixture({ version: 105, participants: [owner, engineer], activity });
    const result = await executeTool(
      createRoomWebMcpTools(fakeRoomWebMcpContext({ room, roomVersion: 105 })).get_room_updates!,
      { sinceVersion: 0 },
    ) as { data: { updates: unknown[]; totalUpdateCount: number; hasMore: boolean; nextSinceVersion: number } };
    expect(result.data.updates).toHaveLength(100);
    expect(result.data.totalUpdateCount).toBe(105);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextSinceVersion).toBe(100);
  });
});
