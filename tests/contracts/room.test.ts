import { describe, expect, it } from "vitest";
import {
  actionErrorCodeSchema,
  actionResultSchema,
  alignmentChoiceSchema,
  alignmentSchema,
  decisionPolicySchema,
  expressAlignmentInputSchema,
  participantSchema,
  removeParticipantInputSchema,
  roomStateSchema,
  setDecisionPolicyInputSchema,
  setParticipantDecisionRoleInputSchema,
  startDemoScenarioInputSchema,
  transferOwnershipInputSchema,
} from "@/contracts/room";
import { z } from "zod";
import { demoRoom } from "@/fixtures/demo-room";
import { createRoomVisualizationState } from "@/visualization/room-view-model";

describe("canonical room contract", () => {
  it("accepts the seeded JSON-safe room snapshot", () => {
    expect(roomStateSchema.parse(JSON.parse(JSON.stringify(demoRoom)))).toEqual(
      demoRoom,
    );
  });

  it("does not expose authentication identifiers", () => {
    const unsafeRoom = structuredClone(demoRoom) as unknown as {
      participants: Array<Record<string, unknown>>;
    };
    unsafeRoom.participants[0]!.userId = "auth-user-id";

    expect(roomStateSchema.safeParse(unsafeRoom).success).toBe(false);
  });

  it("models participant authority explicitly without requiredForApproval", () => {
    const participant = demoRoom.participants[0]!;
    expect(participantSchema.parse(participant)).toMatchObject({
      meetingRole: "owner",
      decisionRole: "decision_maker",
    });
    expect("requiredForApproval" in participant).toBe(false);
  });

  it("requires an owner pointer and explicit decision policy", () => {
    expect(demoRoom.ownerParticipantId).toBe("participant-product");
    expect(decisionPolicySchema.parse(demoRoom.decisionPolicy)).toBe(
      "equal_authority_consensus",
    );
    expect(decisionPolicySchema.safeParse("majority").success).toBe(false);

    const withoutOwner = structuredClone(demoRoom) as Partial<typeof demoRoom>;
    delete withoutOwner.ownerParticipantId;
    expect(roomStateSchema.safeParse(withoutOwner).success).toBe(false);
  });

  it("rejects browser-supplied participant authority", () => {
    expect(
      expressAlignmentInputSchema.safeParse({
        participantId: "participant-engineering",
        proposalId: "proposal-1",
        choice: "support",
        comment: null,
      }).success,
    ).toBe(false);
  });

  it("models AlignmentChoice, Alignment, and ExpressAlignmentInput strictly, replacing Vote", () => {
    expect(alignmentChoiceSchema.options).toEqual([
      "support",
      "concern",
      "strong_objection",
      "needs_clarification",
    ]);
    expect(alignmentChoiceSchema.safeParse("oppose").success).toBe(false);

    const alignment = {
      proposalId: "proposal-1",
      participantId: "participant-engineering",
      choice: "concern" as const,
      comment: "Capacity is tight.",
      updatedAt: "2026-08-30T00:00:00.000Z",
    };
    expect(alignmentSchema.parse(alignment)).toEqual(alignment);
    expect(alignmentSchema.safeParse({ ...alignment, choice: "oppose" }).success).toBe(false);

    expect(
      expressAlignmentInputSchema.parse({
        proposalId: "proposal-1",
        choice: "strong_objection",
        comment: null,
      }),
    ).toEqual({ proposalId: "proposal-1", choice: "strong_objection", comment: null });
    expect(
      expressAlignmentInputSchema.safeParse({
        proposalId: "proposal-1",
        choice: "strong_objection",
        comment: null,
        actorId: "someone-else",
      }).success,
    ).toBe(false);
  });

  it("carries alignments (not votes) on canonical RoomState", () => {
    expect("alignments" in demoRoom).toBe(true);
    expect("votes" in (demoRoom as unknown as Record<string, unknown>)).toBe(false);
    expect(roomStateSchema.safeParse({ ...demoRoom, votes: [] }).success).toBe(false);
  });

  it("keeps decision-policy and decision-role mutation input strict, rejecting spoofed authority fields", () => {
    expect(setDecisionPolicyInputSchema.parse({ decisionPolicy: "owner_decides" })).toEqual({
      decisionPolicy: "owner_decides",
    });
    expect(
      setDecisionPolicyInputSchema.safeParse({
        decisionPolicy: "owner_decides",
        actorId: "participant-product",
      }).success,
    ).toBe(false);
    expect(setDecisionPolicyInputSchema.safeParse({ decisionPolicy: "majority" }).success).toBe(false);

    expect(
      setParticipantDecisionRoleInputSchema.parse({
        participantId: "participant-engineering",
        decisionRole: "decision_maker",
      }),
    ).toEqual({ participantId: "participant-engineering", decisionRole: "decision_maker" });
    expect(
      setParticipantDecisionRoleInputSchema.safeParse({
        participantId: "participant-engineering",
        decisionRole: "advisor",
      }).success,
    ).toBe(false);
    expect(
      setParticipantDecisionRoleInputSchema.safeParse({
        participantId: "participant-engineering",
        decisionRole: "decision_maker",
        ownerParticipantId: "participant-product",
      }).success,
    ).toBe(false);
  });

  it("keeps demo selection role-based without participant authority", () => {
    expect(startDemoScenarioInputSchema.parse({
      mode: "solo_judge",
      humanRole: "product",
    })).toEqual({ mode: "solo_judge", humanRole: "product" });
    expect(startDemoScenarioInputSchema.safeParse({
      mode: "solo_judge",
      humanRole: "product",
      participantId: "demo-product",
    }).success).toBe(false);
  });

  it("carries an explicit meeting lock flag and participant membership status", () => {
    expect(demoRoom.isLocked).toBe(false);
    for (const participant of demoRoom.participants) {
      expect(participant.status).toBe("active");
      expect(participant.removedAt).toBeNull();
    }

    const removed = { ...demoRoom.participants[0]!, status: "removed" as const, removedAt: "2026-08-30T00:00:00.000Z" };
    expect(participantSchema.parse(removed)).toMatchObject({ status: "removed" });
    expect(participantSchema.safeParse({ ...demoRoom.participants[0]!, status: "banned" }).success).toBe(false);
  });

  it("keeps remove/transfer input strict to the target id, rejecting spoofed authority fields", () => {
    expect(removeParticipantInputSchema.parse({ participantId: "participant-engineering" })).toEqual({
      participantId: "participant-engineering",
    });
    expect(removeParticipantInputSchema.safeParse({
      participantId: "participant-engineering",
      actorId: "participant-product",
    }).success).toBe(false);
    expect(removeParticipantInputSchema.safeParse({}).success).toBe(false);

    expect(transferOwnershipInputSchema.parse({ participantId: "participant-engineering" })).toEqual({
      participantId: "participant-engineering",
    });
    expect(transferOwnershipInputSchema.safeParse({
      participantId: "participant-engineering",
      meetingRole: "owner",
    }).success).toBe(false);
  });

  it("projects canonical state into a presentation-only 3D view model", () => {
    const view = createRoomVisualizationState(demoRoom);

    expect(view.roomId).toBe("demo");
    expect(view.phase).toBe("input");
    expect(view.participants).toHaveLength(4);
    expect(view.participants[0]?.isClaimed).toBe(false);
    expect(view.recentActivity[0]?.action).toBe("room.created");
    expect(view.constraints).toHaveLength(6);
  });

  describe("A5: ActionResult.error.details", () => {
    const resultSchema = actionResultSchema(z.null());

    it("includes WAITING_FOR_PARTICIPANTS in the canonical error codes", () => {
      expect(actionErrorCodeSchema.options).toContain("WAITING_FOR_PARTICIPANTS");
    });

    it("accepts a JSON-safe details payload alongside code/message/recovery", () => {
      const parsed = resultSchema.parse({
        ok: false,
        error: {
          code: "WAITING_FOR_PARTICIPANTS",
          message: "Every required participant must mark their input ready before proposals begin.",
          recovery: "Ask the remaining participants to confirm their input is complete.",
          details: { waitingParticipantIds: ["participant-engineering"] },
        },
        roomVersion: 4,
      });
      expect(parsed).toMatchObject({
        ok: false,
        error: { details: { waitingParticipantIds: ["participant-engineering"] } },
      });
    });

    it("still accepts a failure with no details at all, unchanged from before", () => {
      const parsed = resultSchema.parse({
        ok: false,
        error: { code: "NOT_AUTHORIZED", message: "Not authorized." },
        roomVersion: 4,
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.details).toBeUndefined();
    });

    it("rejects a details payload that is not JSON-safe", () => {
      expect(
        resultSchema.safeParse({
          ok: false,
          error: { code: "NOT_AUTHORIZED", message: "x", details: { fn: () => {} } },
          roomVersion: 4,
        }).success,
      ).toBe(false);
    });
  });
});
