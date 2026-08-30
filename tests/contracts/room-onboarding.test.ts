import { describe, expect, it } from "vitest";
import {
  claimInvitationInputSchema,
  claimInvitationResultSchema,
  createRoomInputSchema,
  createdRoomSchema,
  manageRoomInvitationInputSchema,
  regeneratedRoomInvitationSchema,
  roomInvitePreviewSchema,
  roomStateSchema,
  type CreateRoomInput,
} from "@/contracts/room";
import { buildInviteUrl } from "@/domain/rooms/invitations";
import { demoRoom } from "@/fixtures/demo-room";

const validInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks?",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

describe("room creation contract", () => {
  it("accepts one creator and no participant array", () => {
    expect(createRoomInputSchema.parse(validInput)).toEqual(validInput);
  });

  it("rejects predetermined participant seats", () => {
    expect(
      createRoomInputSchema.safeParse({
        ...validInput,
        participants: [{ name: "Emre", role: "Engineer" }],
      }).success,
    ).toBe(false);
  });

  it.each([
    "organizerUserId",
    "actorId",
    "participantId",
    "userId",
    "origin",
    "ownerParticipantId",
    "meetingRole",
    "decisionRole",
  ])("rejects browser-supplied %s authority", (field) => {
    expect(
      createRoomInputSchema.safeParse({ ...validInput, [field]: "smuggled" })
        .success,
    ).toBe(false);
  });

  it("accepts only supported decision policies", () => {
    expect(
      createRoomInputSchema.safeParse({
        ...validInput,
        decisionPolicy: "equal_authority_consensus",
      }).success,
    ).toBe(true);
    expect(
      createRoomInputSchema.safeParse({ ...validInput, decisionPolicy: "majority" })
        .success,
    ).toBe(false);
  });
});

describe("created room DTO", () => {
  const createdRoom = {
    roomId: "rm_7P3KQ8M2",
    ownerParticipantId: "participant-owner",
  };

  it("returns only the room and owner participant identities", () => {
    expect(createdRoomSchema.parse(createdRoom)).toEqual(createdRoom);
  });

  it("rejects legacy seat invitations on the creation result", () => {
    expect(
      createdRoomSchema.safeParse({
        ...createdRoom,
        participantInvites: [],
      }).success,
    ).toBe(false);
  });

  it("keeps the deprecated URL helper isolated for legacy invitation routes", () => {
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

describe("invitation preview contract", () => {
  const livePreview = {
    inviteValid: true as const,
    alreadyClaimed: false,
    roomId: "rm_7P3KQ8M2",
    title: "Two-Week Onboarding Launch",
    brief: "Should we ship the onboarding update within two weeks?",
    participant: { id: "participant-engineer", name: "Emre", role: "Engineer" },
  };

  it("carries the room only for a live invitation", () => {
    expect(roomInvitePreviewSchema.parse(livePreview)).toEqual(livePreview);
  });

  it("answers a refused invitation with no room at all", () => {
    const refused = { inviteValid: false as const, alreadyClaimed: true };
    expect(roomInvitePreviewSchema.parse(refused)).toEqual(refused);
  });

  it.each(["roomId", "title", "brief", "participant"])(
    "rejects %s on a refused invitation",
    (field) => {
      expect(
        roomInvitePreviewSchema.safeParse({
          inviteValid: false,
          alreadyClaimed: false,
          [field]: livePreview[field as keyof typeof livePreview],
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    "phase",
    "version",
    "selfParticipantId",
    "participants",
    "positions",
    "constraints",
    "proposals",
    "votes",
    "approvals",
    "activity",
  ])("rejects %s leaking full room state into a preview", (field) => {
    expect(
      roomInvitePreviewSchema.safeParse({ ...livePreview, [field]: [] }).success,
    ).toBe(false);
  });

  it("rejects the capability echoed back on the preview", () => {
    expect(
      roomInvitePreviewSchema.safeParse({ ...livePreview, inviteToken: "raw" })
        .success,
    ).toBe(false);
  });

  it.each(["userId", "kind", "isClaimed", "requiredForApproval"])(
    "rejects %s on the previewed seat",
    (field) => {
      expect(
        roomInvitePreviewSchema.safeParse({
          ...livePreview,
          participant: { ...livePreview.participant, [field]: "smuggled" },
        }).success,
      ).toBe(false);
    },
  );
});

describe("invitation claim contract", () => {
  it("accepts a bare capability", () => {
    expect(claimInvitationInputSchema.parse({ inviteToken: "raw" })).toEqual({
      inviteToken: "raw",
    });
  });

  it("requires a non-empty capability", () => {
    expect(claimInvitationInputSchema.safeParse({ inviteToken: "" }).success).toBe(false);
    expect(claimInvitationInputSchema.safeParse({}).success).toBe(false);
  });

  it.each([
    "seatId",
    "participantId",
    "userId",
    "actorId",
    "roomId",
    "origin",
  ])("rejects browser-supplied %s authority", (field) => {
    expect(
      claimInvitationInputSchema.safeParse({ inviteToken: "raw", [field]: "smuggled" })
        .success,
    ).toBe(false);
  });

  it("names only the seat the capability was minted for", () => {
    const result = { roomId: "rm_7P3KQ8M2", participantId: "participant-engineer" };
    expect(claimInvitationResultSchema.parse(result)).toEqual(result);
    expect(
      claimInvitationResultSchema.safeParse({ ...result, inviteToken: "raw" }).success,
    ).toBe(false);
  });
});

describe("invitation management contract", () => {
  it("accepts only a target participant seat", () => {
    expect(
      manageRoomInvitationInputSchema.parse({ participantId: "participant-engineer" }),
    ).toEqual({ participantId: "participant-engineer" });
  });

  it.each(["actorId", "actorType", "authUserId", "userId", "origin", "role"])(
    "rejects browser-supplied %s authority",
    (field) => {
      expect(
        manageRoomInvitationInputSchema.safeParse({
          participantId: "participant-engineer",
          [field]: "smuggled",
        }).success,
      ).toBe(false);
    },
  );

  it("returns only a shareable URL when an invitation is regenerated", () => {
    const regenerated = {
      participantId: "participant-engineer",
      role: "Engineer",
      inviteUrl:
        "https://app.example/room/rm_7P3KQ8M2/join?invite=fresh-capability",
    };

    expect(regeneratedRoomInvitationSchema.parse(regenerated)).toEqual(regenerated);
    expect(
      regeneratedRoomInvitationSchema.safeParse({
        ...regenerated,
        inviteToken: "fresh-capability",
      }).success,
    ).toBe(false);
  });
});
