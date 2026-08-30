import { describe, expect, it } from "vitest";
import {
  createRoomInputSchema,
  createdRoomSchema,
  joinRequestResultSchema,
  joinRequestSchema,
  joinRequestStatusSchema,
  manageJoinRequestInputSchema,
  requestJoinByInviteInputSchema,
  requestJoinByPasscodeInputSchema,
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
    inviteUrl: "https://app.example/room/rm_7P3KQ8M2/join?invite=raw-capability",
    passcode: "AB12CD34",
  };

  it("returns the room, owner participant identity, invite URL, and plaintext passcode", () => {
    expect(createdRoomSchema.parse(createdRoom)).toEqual(createdRoom);
  });

  it("requires a passcode with meaningful entropy", () => {
    expect(createdRoomSchema.safeParse({ ...createdRoom, passcode: "abc" }).success).toBe(false);
  });

  it("rejects legacy seat invitations on the creation result", () => {
    expect(
      createdRoomSchema.safeParse({
        ...createdRoom,
        participantInvites: [],
      }).success,
    ).toBe(false);
  });

  it("keeps the invite URL helper isolated to the generic invite route", () => {
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

  it("rejects a passcode hash smuggled onto the room snapshot", () => {
    const room = structuredClone(demoRoom) as unknown as Record<string, unknown>;
    room.passcodeHash = "bf-hash";

    expect(roomStateSchema.safeParse(room).success).toBe(false);
  });

  it("keeps the canonical snapshot free of any invite or passcode field", () => {
    expect(JSON.stringify(demoRoom)).not.toMatch(/invite|passcode/i);
  });
});

describe("invitation preview contract", () => {
  const livePreview = {
    inviteValid: true as const,
    roomId: "rm_7P3KQ8M2",
    title: "Two-Week Onboarding Launch",
    brief: "Should we ship the onboarding update within two weeks?",
    ownerDisplayName: "Maya",
  };

  it("carries only the narrow pre-membership fields for a live invitation", () => {
    expect(roomInvitePreviewSchema.parse(livePreview)).toEqual(livePreview);
  });

  it("answers a refused invitation with no room details at all", () => {
    const refused = { inviteValid: false as const };
    expect(roomInvitePreviewSchema.parse(refused)).toEqual(refused);
  });

  it.each(["roomId", "title", "brief", "ownerDisplayName"])(
    "rejects %s on a refused invitation",
    (field) => {
      expect(
        roomInvitePreviewSchema.safeParse({
          inviteValid: false,
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
});

describe("join request status and DTO", () => {
  it("supports exactly the four canonical states", () => {
    for (const status of ["waiting", "admitted", "rejected", "cancelled"]) {
      expect(joinRequestStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(joinRequestStatusSchema.safeParse("pending").success).toBe(false);
  });

  const request = {
    id: "join-request-1",
    roomId: "rm_7P3KQ8M2",
    displayName: "Emre",
    role: "Engineer",
    status: "waiting" as const,
    createdAt: "2026-08-30T00:00:00.000Z",
    resolvedAt: null,
  };

  it("parses a waiting request", () => {
    expect(joinRequestSchema.parse(request)).toEqual(request);
  });

  it("never exposes the requester's raw auth user id", () => {
    expect(
      joinRequestSchema.safeParse({ ...request, authUserId: "auth-user-id" }).success,
    ).toBe(false);
    expect(
      joinRequestSchema.safeParse({ ...request, userId: "auth-user-id" }).success,
    ).toBe(false);
  });

  it("wraps a join request result with only the room id", () => {
    expect(
      joinRequestResultSchema.parse({ roomId: request.roomId, joinRequest: request }),
    ).toEqual({ roomId: request.roomId, joinRequest: request });
  });
});

describe("join input contracts reject caller-supplied authority", () => {
  const spoofableFields = [
    "participantId",
    "ownerParticipantId",
    "authUserId",
    "userId",
    "meetingRole",
    "decisionRole",
    "actorId",
    "origin",
  ];

  const validPasscodeInput = {
    roomId: "rm_7P3KQ8M2",
    passcode: "AB12CD34",
    displayName: "Emre",
    role: "Engineer",
  };

  it("accepts a well-formed passcode join request", () => {
    expect(requestJoinByPasscodeInputSchema.parse(validPasscodeInput)).toEqual(
      validPasscodeInput,
    );
  });

  it.each(spoofableFields)("rejects browser-supplied %s on a passcode join", (field) => {
    expect(
      requestJoinByPasscodeInputSchema.safeParse({ ...validPasscodeInput, [field]: "smuggled" })
        .success,
    ).toBe(false);
  });

  const validInviteInput = {
    inviteToken: "raw-capability",
    displayName: "Emre",
    role: "Engineer",
  };

  it("accepts a well-formed invite join request", () => {
    expect(requestJoinByInviteInputSchema.parse(validInviteInput)).toEqual(validInviteInput);
  });

  it.each(spoofableFields)("rejects browser-supplied %s on an invite join", (field) => {
    expect(
      requestJoinByInviteInputSchema.safeParse({ ...validInviteInput, [field]: "smuggled" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty passcode or invite token", () => {
    expect(
      requestJoinByPasscodeInputSchema.safeParse({ ...validPasscodeInput, passcode: "" }).success,
    ).toBe(false);
    expect(
      requestJoinByInviteInputSchema.safeParse({ ...validInviteInput, inviteToken: "" }).success,
    ).toBe(false);
  });

  it("names only the target join request as an object reference", () => {
    expect(manageJoinRequestInputSchema.parse({ joinRequestId: "join-request-1" })).toEqual({
      joinRequestId: "join-request-1",
    });
  });

  it.each(spoofableFields)("rejects browser-supplied %s on admit/reject", (field) => {
    expect(
      manageJoinRequestInputSchema.safeParse({
        joinRequestId: "join-request-1",
        [field]: "smuggled",
      }).success,
    ).toBe(false);
  });
});
