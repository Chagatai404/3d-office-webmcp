import type {
  ActionOrigin,
  ActionResult,
  AddPositionInput,
  ApproveFinalDecisionInput,
  ClaimSeatInput,
  CreateRoomInput,
  CreateMeetingSourceInput,
  DecisionRecord,
  ExpressAlignmentInput,
  FinalDecisionPreview,
  JoinRequest,
  JoinRequestResult,
  ManageJoinRequestInput,
  MarkMeetingSourceFailedInput,
  MarkMeetingSourceProcessedInput,
  MeetingSourceIdInput,
  MeetingSource,
  MeetingSourceContent,
  MeetingSourceSearchResults,
  RecordExpertAdviceOutcomeInput,
  RemoveParticipantInput,
  ReadMeetingSourceContentInput,
  RequestJoinByInviteInput,
  RequestJoinByPasscodeInput,
  RaiseObjectionInput,
  ResolveObjectionInput,
  ProposeTradeoffInput,
  SearchMeetingSourcesInput,
  RoomInvitePreview,
  RoomPhase,
  RoomState,
  SetDecisionPolicyInput,
  SetParticipantDecisionRoleInput,
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
  listSources(roomId: string, actor: DomainActor): Promise<ActionResult<MeetingSource[]>>;
  createSource(
    roomId: string,
    input: CreateMeetingSourceInput,
    context: MutationContext,
  ): Promise<ActionResult<MeetingSource>>;
  readSourceContent(
    roomId: string,
    input: ReadMeetingSourceContentInput,
    actor: DomainActor,
  ): Promise<ActionResult<MeetingSourceContent>>;
  searchSources(
    roomId: string,
    input: SearchMeetingSourcesInput,
    actor: DomainActor,
  ): Promise<ActionResult<MeetingSourceSearchResults>>;
  markSourceProcessed(
    roomId: string,
    input: MarkMeetingSourceProcessedInput,
    context: MutationContext,
  ): Promise<ActionResult<MeetingSource>>;
  markSourceFailed(
    roomId: string,
    input: MarkMeetingSourceFailedInput,
    context: MutationContext,
  ): Promise<ActionResult<MeetingSource>>;
  shareSource(
    roomId: string,
    input: MeetingSourceIdInput,
    context: MutationContext,
  ): Promise<ActionResult<MeetingSource>>;
  removeSource(
    roomId: string,
    input: MeetingSourceIdInput,
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
  expressAlignment(
    roomId: string,
    input: ExpressAlignmentInput,
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
  setDecisionPolicy(
    roomId: string,
    input: SetDecisionPolicyInput,
    context: MutationContext,
  ): Promise<ActionResult>;
  setParticipantDecisionRole(
    roomId: string,
    input: SetParticipantDecisionRoleInput,
    context: MutationContext,
  ): Promise<ActionResult>;

  /** Owner-only. Idempotent: enabling an already-enabled expert is a no-op success. */
  enableSecurityExpert(
    roomId: string,
    context: MutationContext,
  ): Promise<ActionResult<{ expertParticipantId: string }>>;

  /**
   * Any active human participant. Idempotent per active proposal (a
   * fingerprint-unique constraint on `expert_findings` guards duplicate
   * findings even under concurrent calls).
   */
  runSecurityExpertReview(
    roomId: string,
    context: MutationContext,
  ): Promise<ActionResult<{ findingIds: string[] }>>;

  /** Owner-only. Rejected once an exact decision candidate is frozen. */
  recordExpertAdviceOutcome(
    roomId: string,
    input: RecordExpertAdviceOutcomeInput,
    context: MutationContext,
  ): Promise<ActionResult>;
}
