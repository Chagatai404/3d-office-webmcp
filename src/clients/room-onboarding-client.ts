import type {
  ActionResult,
  ClaimInvitationInput,
  ClaimInvitationResult,
  CreateRoomInput,
  CreatedRoom,
  RoomInvitePreview,
} from "@/contracts/room";

/**
 * Pre-membership onboarding surface: room creation and invitation
 * preview/claim. Kept separate from `RoomClient` because these operations
 * happen before a caller has an authenticated seat in a room.
 */
export interface RoomOnboardingClient {
  createRoom(input: CreateRoomInput): Promise<CreatedRoom>;

  previewInvitation(inviteToken: string): Promise<RoomInvitePreview>;

  claimInvitation(
    input: ClaimInvitationInput,
  ): Promise<ActionResult<ClaimInvitationResult>>;
}
