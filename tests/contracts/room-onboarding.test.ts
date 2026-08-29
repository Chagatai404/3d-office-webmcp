import { describe, expect, it } from "vitest";
import {
  createRoomInputSchema,
  createdRoomSchema,
  roomStateSchema,
  type CreateRoomInput,
} from "@/contracts/room";
import { buildInviteUrl } from "@/domain/rooms/invitations";
import { demoRoom } from "@/fixtures/demo-room";

const validInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks?",
  participants: [
    { name: "Maya", role: "Product Manager", requiredForApproval: false },
    { name: "Emre", role: "Engineer", requiredForApproval: true },
  ],
};

describe("room creation contract", () => {
  it("accepts a minimal two-participant room", () => {
    expect(createRoomInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("requires at least two participants", () => {
    expect(
      createRoomInputSchema.safeParse({
        ...validInput,
        participants: [validInput.participants[0]],
      }).success,
    ).toBe(false);
  });

  it.each([
    "organizerUserId",
    "actorId",
    "participantId",
    "userId",
    "origin",
  ])("rejects browser-supplied %s authority", (field) => {
    expect(
      createRoomInputSchema.safeParse({ ...validInput, [field]: "smuggled" })
        .success,
    ).toBe(false);
  });

  it.each(["id", "userId", "kind", "isClaimed"])(
    "rejects %s on a requested participant seat",
    (field) => {
      expect(
        createRoomInputSchema.safeParse({
          ...validInput,
          participants: [
            { ...validInput.participants[0], [field]: "smuggled" },
            validInput.participants[1],
          ],
        }).success,
      ).toBe(false);
    },
  );

  it("requires an explicit approval requirement per participant", () => {
    expect(
      createRoomInputSchema.safeParse({
        ...validInput,
        participants: [
          { name: "Maya", role: "Product Manager" },
          validInput.participants[1],
        ],
      }).success,
    ).toBe(false);
  });
});

describe("created room DTO", () => {
  const createdRoom = {
    roomId: "rm_7P3KQ8M2",
    participantInvites: [
      {
        participantId: "participant-engineer",
        role: "Engineer",
        inviteUrl:
          "https://app.example/room/rm_7P3KQ8M2/join?invite=raw-capability",
      },
    ],
  };

  it("carries only the shareable invite URL", () => {
    expect(createdRoomSchema.parse(createdRoom)).toEqual(createdRoom);
  });

  it("rejects a raw invite token on the DTO", () => {
    expect(
      createdRoomSchema.safeParse({
        ...createdRoom,
        participantInvites: [
          { ...createdRoom.participantInvites[0], inviteToken: "raw" },
        ],
      }).success,
    ).toBe(false);
  });

  it("builds one invite URL per predetermined seat", () => {
    expect(buildInviteUrl("https://app.example/", "rm_7P3KQ8M2", "raw token")).toBe(
      "https://app.example/room/rm_7P3KQ8M2/join?invite=raw%20token",
    );
  });
});

describe("room snapshot secrecy", () => {
  it("rejects an invite secret smuggled onto the room snapshot", () => {
    const room = structuredClone(demoRoom) as unknown as Record<string, unknown>;
    room.inviteToken = "raw-capability";

    expect(roomStateSchema.safeParse(room).success).toBe(false);
  });

  it("rejects an invite secret smuggled onto a participant", () => {
    const room = structuredClone(demoRoom) as unknown as {
      participants: Array<Record<string, unknown>>;
    };
    room.participants[0]!.inviteUrl =
      "https://app.example/room/demo/join?invite=raw-capability";

    expect(roomStateSchema.safeParse(room).success).toBe(false);
  });

  it("keeps the canonical snapshot free of any invite field", () => {
    expect(JSON.stringify(demoRoom)).not.toMatch(/invite/i);
  });
});
