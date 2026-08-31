import type {
  ActionResult,
  CreateRoomInput,
  CreatedRoom,
  JoinRequest,
  JoinRequestResult,
  RequestJoinByInviteInput,
  RequestJoinByPasscodeInput,
  RoomInvitePreview,
} from "@/contracts/room";

/**
 * Narrow pre-membership surface. None of these calls returns RoomState.
 */
export interface RoomOnboardingClient {
  createRoom(input: CreateRoomInput): Promise<CreatedRoom>;

  previewInvite(inviteToken: string): Promise<RoomInvitePreview>;
  requestJoinByPasscode(input: RequestJoinByPasscodeInput): Promise<ActionResult<JoinRequestResult>>;
  requestJoinByInvite(input: RequestJoinByInviteInput): Promise<ActionResult<JoinRequestResult>>;
  getMyJoinRequest(joinRequestId: string): Promise<ActionResult<JoinRequest>>;
}
