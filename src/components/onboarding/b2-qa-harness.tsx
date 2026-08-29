"use client";

import { JoinRoom } from "@/components/onboarding/join-room";
import { OrganizerSetup } from "@/components/onboarding/organizer-setup";
import { stageCreatedRoomForSetup } from "@/components/onboarding/created-room-handoff";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";

const roomId = "rm_join-room";

export function B2QaHarness({ mode }: { mode: string }) {
  if (mode === "setup") {
    stageCreatedRoomForSetup(
      {
        roomId,
        participantInvites: [
          {
            participantId: "participant-engineer",
            role: "Engineer",
            inviteUrl: `/room/${roomId}/join?invite=engineer-qa-token`,
          },
          {
            participantId: "participant-designer",
            role: "Designer",
            inviteUrl: `/room/${roomId}/join?invite=designer-qa-token`,
          },
        ],
      },
      {
        title: "B2 invitation QA room",
        brief: "Verify secure organizer invitations and explicit participant claims.",
        participants: [
          { name: "QA Organizer", role: "Product Manager", requiredForApproval: false },
          { name: "QA Engineer", role: "Engineer", requiredForApproval: true },
          { name: "QA Designer", role: "Designer", requiredForApproval: false },
        ],
      },
    );
    return <OrganizerSetup roomId={roomId} />;
  }

  const alreadyClaimed = mode === "claimed";
  const raceLost = mode === "race";
  const client: RoomOnboardingClient = {
    createRoom: async () => {
      throw new Error("Not used in QA.");
    },
    previewInvitation: async () => ({
      inviteValid: true,
      alreadyClaimed,
      roomId,
      title: "B2 invitation QA room",
      brief: "Verify secure organizer invitations and explicit participant claims.",
      participant: {
        id: "participant-engineer",
        name: "QA Engineer",
        role: "Engineer",
      },
    }),
    claimInvitation: async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return raceLost
        ? {
            ok: false,
            error: {
              code: "NOT_AUTHORIZED",
              message: "Invitation already consumed.",
              recovery: "Request another invitation from the organizer.",
            },
            roomVersion: 0,
          }
        : {
            ok: true,
            data: { roomId, participantId: "participant-engineer" },
            roomVersion: 1,
            message: "Joined.",
          };
    },
  };

  return <JoinRoom roomId={roomId} inviteToken="qa-token" client={client} />;
}
