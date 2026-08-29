import {
  addPositionInputSchema,
  approveFinalDecisionInputSchema,
  castVoteInputSchema,
  claimInvitationInputSchema,
  claimSeatInputSchema,
  createRoomInputSchema,
  createdRoomSchema,
  raiseObjectionInputSchema,
  proposeTradeoffInputSchema,
  resolveObjectionInputSchema,
  roomPhaseSchema,
  startDemoScenarioInputSchema,
  submitProposalInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type AddPositionInput,
  type ApproveFinalDecisionInput,
  type CastVoteInput,
  type ClaimInvitationInput,
  type ClaimInvitationResult,
  type ClaimSeatInput,
  type CreatedRoom,
  type CreateRoomInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type RaiseObjectionInput,
  type ProposeTradeoffInput,
  type ResolveObjectionInput,
  type RoomInvitePreview,
  type RoomPhase,
  type RoomState,
  type StartDemoScenarioInput,
  type SubmitProposalInput,
} from "@/contracts/room";
import { buildInviteUrl } from "./invitations";
import type { DomainActor, MutationContext, RoomRepository } from "./repository";

function failure<T = null>(
  code: ActionErrorCode,
  message: string,
  roomVersion: number,
  recovery?: string,
): ActionResult<T> {
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
  if (room.phase === "finalized") {
    return failure(
      "ALREADY_FINALIZED",
      "The finalized decision is immutable.",
      room.version,
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

export interface CreateRoomContext {
  actor: DomainActor;
  /** Absolute origin used to build shareable invite links, e.g. `https://app.example`. */
  inviteBaseUrl: string;
}

/**
 * Creates a private, non-demo room. Organizer identity comes from the
 * authenticated session only: the input schema is strict, so a request body
 * cannot carry `organizerUserId`, `actorId`, `participantId`, `userId` or
 * `origin`, and the database sets `organizer_user_id` from `auth.uid()`.
 *
 * Raw invitation tokens leave the system exactly once, inside the returned
 * invite URLs; they are never persisted and never enter `RoomState`.
 */
export async function createRoom(
  repository: RoomRepository,
  input: CreateRoomInput,
  context: CreateRoomContext,
): Promise<ActionResult<CreatedRoom>> {
  const parsed = createRoomInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Room creation input is invalid.", 0);
  }
  const distinctNames = new Set(
    parsed.data.participants.map((participant) => participant.name.trim()),
  );
  if (distinctNames.size !== parsed.data.participants.length) {
    return failure(
      "VALIDATION_ERROR",
      "Participant names must be unique within a room.",
      0,
    );
  }
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }

  const created = await repository.createRoom(parsed.data, context.actor);
  if (!created.ok) return created;

  return {
    ...created,
    data: createdRoomSchema.parse({
      roomId: created.data.roomId,
      participantInvites: created.data.participantInvites.map((invite) => ({
        participantId: invite.participantId,
        role: invite.role,
        inviteUrl: buildInviteUrl(
          context.inviteBaseUrl,
          created.data.roomId,
          invite.inviteToken,
        ),
      })),
    }),
  };
}

/**
 * Resolves a raw invitation token into the narrow pre-membership preview.
 *
 * An unknown, expired, revoked or foreign-claimed token is not an error: it is
 * answered with the `inviteValid: false` branch, which carries no room or
 * participant fields. Only a missing token is a validation failure, because
 * there is nothing to resolve.
 */
export async function previewRoomInvitation(
  repository: RoomRepository,
  inviteToken: unknown,
  actor: DomainActor,
): Promise<ActionResult<RoomInvitePreview>> {
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  if (typeof inviteToken !== "string" || inviteToken.length === 0) {
    return failure("VALIDATION_ERROR", "An invitation token is required.", 0);
  }
  return repository.previewInvitation(inviteToken, actor);
}

/**
 * Binds the authenticated session to the one seat its capability names. The
 * input carries no seat, participant or user field, so the claimed seat is
 * always the one the token was minted for; the database performs the whole
 * claim atomically and increments the room version once.
 */
export async function claimRoomInvitation(
  repository: RoomRepository,
  input: ClaimInvitationInput,
  actor: DomainActor,
): Promise<ActionResult<ClaimInvitationResult>> {
  const parsed = claimInvitationInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Invitation claim input is invalid.", 0);
  }
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.claimInvitation(parsed.data, actor);
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

export async function resolveParticipantObjection(
  repository: RoomRepository,
  roomId: string,
  input: ResolveObjectionInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = resolveObjectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Conflict resolution input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, ["deliberation"]);
  if ("ok" in room) return room;
  return repository.resolveObjection(roomId, parsed.data, context);
}

export async function castParticipantVote(
  repository: RoomRepository,
  roomId: string,
  input: CastVoteInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = castVoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Vote input is invalid.", context.expectedRoomVersion);
  }
  if (!["manual_ui", "webmcp"].includes(context.actor.origin)) {
    return failure(
      "NOT_AUTHORIZED",
      "Only an authenticated human participant may use this voting operation.",
      context.expectedRoomVersion,
    );
  }
  const room = await prepareMutation(repository, roomId, context, ["voting"]);
  if ("ok" in room) return room;
  return repository.castVote(roomId, parsed.data, context);
}

export async function previewFinalDecision(
  repository: RoomRepository,
  actorUserId: string,
  roomId: string,
): Promise<ActionResult<FinalDecisionPreview>> {
  if (!actorUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  const room = await repository.getRoom(roomId, actorUserId);
  if (!room) return failure("VALIDATION_ERROR", "Room not found.", 0);
  if (room.phase !== "approval") {
    return failure(
      room.phase === "finalized" ? "ALREADY_FINALIZED" : "WRONG_PHASE",
      room.phase === "finalized"
        ? "The decision is already finalized; read its immutable record."
        : "Final decision preview is available only during approval.",
      room.version,
    );
  }
  return repository.previewFinalDecision(roomId, actorUserId);
}

export async function approveParticipantFinalDecision(
  repository: RoomRepository,
  roomId: string,
  input: ApproveFinalDecisionInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = approveFinalDecisionInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Approval input is invalid.", context.expectedRoomVersion);
  }
  if (!["manual_ui", "webmcp"].includes(context.actor.origin)) {
    return failure(
      "NOT_AUTHORIZED",
      "Only an authenticated human participant may approve a decision.",
      context.expectedRoomVersion,
    );
  }
  const room = await prepareMutation(repository, roomId, context, ["approval"]);
  if ("ok" in room) return room;
  return repository.approveFinalDecision(roomId, parsed.data, context);
}

export async function getFinalDecisionRecord(
  repository: RoomRepository,
  actorUserId: string,
  roomId: string,
): Promise<ActionResult<DecisionRecord>> {
  if (!actorUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  const room = await repository.getRoom(roomId, actorUserId);
  if (!room) return failure("VALIDATION_ERROR", "Room not found.", 0);
  if (room.phase !== "finalized") {
    return failure(
      "WRONG_PHASE",
      "The immutable decision record is available only after finalization.",
      room.version,
    );
  }
  return repository.getDecisionRecord(roomId, actorUserId);
}

export async function advanceDemoRoomPhase(
  repository: RoomRepository,
  roomId: string,
  nextPhase: RoomPhase,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = roomPhaseSchema.safeParse(nextPhase);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Invalid demo phase.", context.expectedRoomVersion);
  }
  const room = await prepareMutation(repository, roomId, context, [
    "input",
    "proposals",
    "deliberation",
    "voting",
  ]);
  if ("ok" in room) return room;
  const expectedNextPhase: Partial<Record<RoomPhase, RoomPhase>> = {
    input: "proposals",
    proposals: "deliberation",
    deliberation: "voting",
    voting: "approval",
  };
  if (expectedNextPhase[room.phase] !== parsed.data) {
    return failure(
      "WRONG_PHASE",
      "Only the next controlled demo phase may be selected.",
      room.version,
    );
  }
  return repository.advanceDemoPhase(roomId, parsed.data, context);
}

export async function startDemoScenario(
  repository: RoomRepository,
  roomId: string,
  input: StartDemoScenarioInput,
  actorUserId: string,
): Promise<ActionResult> {
  const parsed = startDemoScenarioInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Demo scenario input is invalid.", 0);
  }
  if (!actorUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  if (roomId !== "demo") {
    return failure("NOT_AUTHORIZED", "Only the shared demo room may be reset.", 0);
  }
  return repository.startDemoScenario(roomId, parsed.data, actorUserId);
}
