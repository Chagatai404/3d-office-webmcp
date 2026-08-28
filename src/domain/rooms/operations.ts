import {
  addPositionInputSchema,
  claimSeatInputSchema,
  raiseObjectionInputSchema,
  proposeTradeoffInputSchema,
  roomPhaseSchema,
  submitProposalInputSchema,
  type ActionResult,
  type AddPositionInput,
  type ClaimSeatInput,
  type RaiseObjectionInput,
  type ProposeTradeoffInput,
  type RoomPhase,
  type RoomState,
  type SubmitProposalInput,
} from "@/contracts/room";
import type { MutationContext, RoomRepository } from "./repository";

function failure(
  code: "VALIDATION_ERROR" | "NOT_AUTHORIZED" | "WRONG_PHASE" | "STALE_ROOM_STATE",
  message: string,
  roomVersion: number,
  recovery?: string,
): ActionResult {
  return {
    ok: false,
    error: { code, message, ...(recovery ? { recovery } : {}) },
    roomVersion,
  };
}

async function prepareMutation(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
  allowedPhases: RoomPhase[],
): Promise<RoomState | ActionResult> {
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }

  const room = await repository.getRoom(roomId, context.actor.authUserId);
  if (!room) return failure("VALIDATION_ERROR", "Room not found.", 0);
  if (room.version !== context.expectedRoomVersion) {
    return failure(
      "STALE_ROOM_STATE",
      "The room changed before this action completed.",
      room.version,
      "Review the latest room state and retry if the action is still appropriate.",
    );
  }
  if (!allowedPhases.includes(room.phase)) {
    return failure(
      "WRONG_PHASE",
      `This action is not available during the ${room.phase} phase.`,
      room.version,
    );
  }
  return room;
}

export function getMeetingContext(
  repository: RoomRepository,
  actorUserId: string,
  roomId: string,
): Promise<RoomState | null> {
  return repository.getRoom(roomId, actorUserId);
}

export async function claimParticipantSeat(
  repository: RoomRepository,
  roomId: string,
  input: ClaimSeatInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = claimSeatInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Seat claim input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, [
    "input",
    "proposals",
    "deliberation",
    "voting",
    "approval",
  ]);
  if ("ok" in room) return room;
  return repository.claimSeat(roomId, parsed.data, context);
}

export async function addParticipantPosition(
  repository: RoomRepository,
  roomId: string,
  input: AddPositionInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = addPositionInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Position input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, ["input"]);
  if ("ok" in room) return room;
  return repository.addPosition(roomId, parsed.data, context);
}

export async function submitParticipantProposal(
  repository: RoomRepository,
  roomId: string,
  input: SubmitProposalInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = submitProposalInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Proposal input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, ["proposals"]);
  if ("ok" in room) return room;
  return repository.submitProposal(roomId, parsed.data, context);
}

export async function raiseParticipantObjection(
  repository: RoomRepository,
  roomId: string,
  input: RaiseObjectionInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = raiseObjectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Objection input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, ["deliberation"]);
  if ("ok" in room) return room;
  return repository.raiseObjection(roomId, parsed.data, context);
}

export async function proposeParticipantTradeoff(
  repository: RoomRepository,
  roomId: string,
  input: ProposeTradeoffInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = proposeTradeoffInputSchema.safeParse(input);
  if (!parsed.success || parsed.data.revisedProposal === null) {
    return failure(
      "VALIDATION_ERROR",
      "A trade-off must include a revised proposal in this milestone.",
      context.expectedRoomVersion,
    );
  }
  const room = await prepareMutation(repository, roomId, context, ["deliberation"]);
  if ("ok" in room) return room;
  return repository.proposeTradeoff(roomId, parsed.data, context);
}

export async function advanceDemoRoomPhase(
  repository: RoomRepository,
  roomId: string,
  nextPhase: RoomPhase,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = roomPhaseSchema.safeParse(nextPhase);
  if (!parsed.success || !["proposals", "deliberation"].includes(parsed.data)) {
    return failure("VALIDATION_ERROR", "Invalid early demo phase.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, ["input", "proposals"]);
  if ("ok" in room) return room;
  return repository.advanceDemoPhase(roomId, parsed.data, context);
}
