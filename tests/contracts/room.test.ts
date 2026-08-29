import { describe, expect, it } from "vitest";
import {
  castVoteInputSchema,
  roomStateSchema,
  startDemoScenarioInputSchema,
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
