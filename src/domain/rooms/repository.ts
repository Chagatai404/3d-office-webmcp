import type {
  ActionOrigin,
  ActionResult,
  AddPositionInput,
  ClaimSeatInput,
  RaiseObjectionInput,
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
  advanceDemoPhase(
    roomId: string,
    nextPhase: RoomPhase,
    context: MutationContext,
  ): Promise<ActionResult>;
}
