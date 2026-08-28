import type {
  ActionOrigin,
  ActionResult,
  AddPositionInput,
  ApproveFinalDecisionInput,
  CastVoteInput,
  ClaimSeatInput,
  DecisionRecord,
  FinalDecisionPreview,
  RaiseObjectionInput,
  ResolveObjectionInput,
  ProposeTradeoffInput,
  RoomPhase,
  RoomState,
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

export interface RoomRepository {
  getRoom(roomId: string, authUserId: string): Promise<RoomState | null>;
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
  advanceDemoPhase(
    roomId: string,
    nextPhase: RoomPhase,
    context: MutationContext,
  ): Promise<ActionResult>;
}
