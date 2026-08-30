import type {
  ActionOrigin,
  ActionResult,
  AddPositionInput,
  ApproveFinalDecisionInput,
  CastVoteInput,
  ClaimInvitationInput,
  ClaimInvitationResult,
  ClaimSeatInput,
  CreateRoomInput,
  DecisionRecord,
  FinalDecisionPreview,
  ManageRoomInvitationInput,
  RaiseObjectionInput,
  ResolveObjectionInput,
  ProposeTradeoffInput,
  RoomInvitePreview,
  RoomPhase,
  RoomState,
  StartDemoScenarioInput,
  SubmitProposalInput,
} from "@/contracts/room";

export interface DomainActor {
  authUserId: string;
  origin: ActionOrigin;
}

export interface MutationContext {
  actor: DomainActor;
  expectedRoomVersion: number;
  humanConfirmed?: boolean;
}

/** Internal creation record returned by the atomic database operation. */
export interface CreatedRoomRecord {
  roomId: string;
  ownerParticipantId: string;
}

/** @deprecated Slice 2 replaces predetermined-seat invitation management. */
export interface RegeneratedRoomInvitationRecord {
  participantId: string;
  role: string;
  inviteToken: string;
}

export interface RoomRepository {
  getRoom(roomId: string, authUserId: string): Promise<RoomState | null>;
  createRoom(
    input: CreateRoomInput,
    actor: DomainActor,
  ): Promise<ActionResult<CreatedRoomRecord>>;
  previewInvitation(
    inviteToken: string,
    actor: DomainActor,
  ): Promise<ActionResult<RoomInvitePreview>>;
  claimInvitation(
    input: ClaimInvitationInput,
    actor: DomainActor,
  ): Promise<ActionResult<ClaimInvitationResult>>;
  claimSeat(
    roomId: string,
    input: ClaimSeatInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  addPosition(
    roomId: string,
    input: AddPositionInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  submitProposal(
    roomId: string,
    input: SubmitProposalInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  raiseObjection(
    roomId: string,
    input: RaiseObjectionInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  resolveObjection(
    roomId: string,
    input: ResolveObjectionInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  proposeTradeoff(
    roomId: string,
    input: ProposeTradeoffInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  castVote(
    roomId: string,
    input: CastVoteInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  previewFinalDecision(
    roomId: string,
    authUserId: string,
  ): Promise<ActionResult<FinalDecisionPreview>>;
  approveFinalDecision(
    roomId: string,
    input: ApproveFinalDecisionInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  getDecisionRecord(
    roomId: string,
    authUserId: string,
  ): Promise<ActionResult<DecisionRecord>>;
  markMyInputReady(
    roomId: string,
    context: MutationContext,
  ): Promise<ActionResult>;
  advanceRoomPhase(
    roomId: string,
    nextPhase: RoomPhase,
    context: MutationContext,
  ): Promise<ActionResult>;
  regenerateInvitation(
    roomId: string,
    input: ManageRoomInvitationInput,
    context: MutationContext,
  ): Promise<ActionResult<RegeneratedRoomInvitationRecord>>;
  revokeInvitation(
    roomId: string,
    input: ManageRoomInvitationInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  advanceDemoPhase(
    roomId: string,
    nextPhase: RoomPhase,
    context: MutationContext,
  ): Promise<ActionResult>;
  startDemoScenario(
    roomId: string,
    input: StartDemoScenarioInput,
    authUserId: string,
  ): Promise<ActionResult>;
}
