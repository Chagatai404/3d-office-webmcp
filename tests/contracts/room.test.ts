import { describe, expect, it } from "vitest";
import {
  castVoteInputSchema,
  decisionPolicySchema,
  participantSchema,
  removeParticipantInputSchema,
  roomStateSchema,
  startDemoScenarioInputSchema,
  transferOwnershipInputSchema,
} from "@/contracts/room";
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
      castVoteInputSchema.safeParse({
        participantId: "participant-engineering",
        proposalId: "proposal-1",
        choice: "support",
        comment: null,
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
});
