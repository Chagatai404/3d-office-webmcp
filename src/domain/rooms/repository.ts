import type {
  ActionOrigin,
  ActionResult,
  AddPositionInput,
  ApproveFinalDecisionInput,
  CastVoteInput,
  ClaimSeatInput,
  CreateRoomInput,
  DecisionRecord,
  FinalDecisionPreview,
  JoinRequest,
  JoinRequestResult,
  ManageJoinRequestInput,
  RemoveParticipantInput,
  RequestJoinByInviteInput,
  RequestJoinByPasscodeInput,
  RaiseObjectionInput,
  ResolveObjectionInput,
  ProposeTradeoffInput,
  RoomInvitePreview,
  RoomPhase,
  RoomState,
  StartDemoScenarioInput,
  SubmitProposalInput,
  TransferOwnershipInput,
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
  inviteToken: string;
  passcode: string;
}

export interface RoomRepository {
  getRoom(roomId: string, authUserId: string): Promise<RoomState | null>;
  createRoom(
    input: CreateRoomInput,
    actor: DomainActor,
  ): Promise<ActionResult<CreatedRoomRecord>>;
  previewInvite(
    inviteToken: string,
    actor: DomainActor,
  ): Promise<ActionResult<RoomInvitePreview>>;
  requestJoinByPasscode(
    input: RequestJoinByPasscodeInput,
    actor: DomainActor,
  ): Promise<ActionResult<JoinRequestResult>>;
  requestJoinByInvite(input: RequestJoinByInviteInput, actor: DomainActor): Promise<ActionResult<JoinRequestResult>>;
  getMyJoinRequest(joinRequestId: string, actor: DomainActor): Promise<ActionResult<JoinRequest>>;
  listJoinRequests(roomId: string, actor: DomainActor): Promise<ActionResult<JoinRequest[]>>;
  admitJoinRequest(roomId: string, input: ManageJoinRequestInput, context: MutationContext): Promise<ActionResult<JoinRequest>>;
  rejectJoinRequest(roomId: string, input: ManageJoinRequestInput, context: MutationContext): Promise<ActionResult<JoinRequest>>;
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
  lockMeeting(roomId: string, context: MutationContext): Promise<ActionResult>;
  unlockMeeting(roomId: string, context: MutationContext): Promise<ActionResult>;
  removeParticipant(
    roomId: string,
    input: RemoveParticipantInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  transferOwnership(
    roomId: string,
    input: TransferOwnershipInput,
    context: MutationContext,
  ): Promise<ActionResult>;
}
