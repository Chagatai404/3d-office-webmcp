import {
  addPositionInputSchema,
  approveFinalDecisionInputSchema,
  castVoteInputSchema,
  claimSeatInputSchema,
  createRoomInputSchema,
  createdRoomSchema,
  manageJoinRequestInputSchema,
  removeParticipantInputSchema,
  requestJoinByInviteInputSchema,
  requestJoinByPasscodeInputSchema,
  raiseObjectionInputSchema,
  proposeTradeoffInputSchema,
  resolveObjectionInputSchema,
  roomPhaseSchema,
  startDemoScenarioInputSchema,
  submitProposalInputSchema,
  transferOwnershipInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type AddPositionInput,
  type ApproveFinalDecisionInput,
  type CastVoteInput,
  type ClaimSeatInput,
  type CreatedRoom,
  type CreateRoomInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type JoinRequest,
  type JoinRequestResult,
  type ManageJoinRequestInput,
  type RemoveParticipantInput,
  type RequestJoinByInviteInput,
  type RequestJoinByPasscodeInput,
  type RaiseObjectionInput,
  type ProposeTradeoffInput,
  type ResolveObjectionInput,
  type RoomInvitePreview,
  type RoomPhase,
  type RoomState,
  type StartDemoScenarioInput,
  type SubmitProposalInput,
  type TransferOwnershipInput,
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
): Promise<RoomState | ActionResult<never>> {
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
  baseUrl?: string;
}

/**
 * Creates a private, non-demo room. Owner identity comes from the
 * authenticated session only: the input schema is strict, so a request body
 * cannot carry authority identifiers or roles, and the database binds the
 * single owner participant to `auth.uid()` atomically.
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
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }

  const created = await repository.createRoom(
    {
      ...parsed.data,
      decisionPolicy: parsed.data.decisionPolicy ?? "owner_decides",
    },
    context.actor,
  );
  if (!created.ok) return created;

  // A caller without an HTTP request (a direct domain-layer test, for
  // instance) has no origin to derive; fall back to a placeholder absolute
  // origin so the invite URL stays a valid, shareable link either way.
  const baseUrl = (context.baseUrl?.replace(/\/+$/, "") || null) ?? "http://localhost:3000";
  return {
    ...created,
    data: createdRoomSchema.parse({
      roomId: created.data.roomId,
      ownerParticipantId: created.data.ownerParticipantId,
      passcode: created.data.passcode,
      inviteUrl: buildInviteUrl(baseUrl, created.data.roomId, created.data.inviteToken),
    }),
  };
}

export async function previewRoomInvite(
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
  return repository.previewInvite(inviteToken, actor);
}

export async function requestJoinByPasscode(
  repository: RoomRepository,
  input: RequestJoinByPasscodeInput,
  actor: DomainActor,
): Promise<ActionResult<JoinRequestResult>> {
  const parsed = requestJoinByPasscodeInputSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_ERROR", "Join request input is invalid.", 0);
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.requestJoinByPasscode(parsed.data, actor);
}

export async function requestJoinByInvite(
  repository: RoomRepository,
  input: RequestJoinByInviteInput,
  actor: DomainActor,
): Promise<ActionResult<JoinRequestResult>> {
  const parsed = requestJoinByInviteInputSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_ERROR", "Join request input is invalid.", 0);
  if (!actor.authUserId) return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  return repository.requestJoinByInvite(parsed.data, actor);
}

export function getMyJoinRequest(repository: RoomRepository, joinRequestId: string, actor: DomainActor) {
  if (!actor.authUserId || !joinRequestId) return Promise.resolve(failure<JoinRequest>("NOT_AUTHORIZED", "Join request unavailable.", 0));
  return repository.getMyJoinRequest(joinRequestId, actor);
}

export function listJoinRequests(repository: RoomRepository, roomId: string, actor: DomainActor) {
  if (!actor.authUserId) return Promise.resolve(failure<JoinRequest[]>("NOT_AUTHORIZED", "Owner authority is required.", 0));
  return repository.listJoinRequests(roomId, actor);
}

async function manageJoinRequest(
  repository: RoomRepository,
  roomId: string,
  input: ManageJoinRequestInput,
  context: MutationContext,
  action: "admit" | "reject",
): Promise<ActionResult<JoinRequest>> {
  const parsed = manageJoinRequestInputSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_ERROR", "Join request input is invalid.", context.expectedRoomVersion);
  const room = await prepareMutation(repository, roomId, context, ["input", "proposals", "deliberation", "voting", "approval"]);
  if ("ok" in room) return room;
  const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
  if (!self || self.id !== room.ownerParticipantId || self.meetingRole !== "owner") {
    return failure("NOT_AUTHORIZED", "Only the current room owner can manage the waiting room.", room.version);
  }
  return action === "admit"
    ? repository.admitJoinRequest(roomId, parsed.data, context)
    : repository.rejectJoinRequest(roomId, parsed.data, context);
}

export function admitJoinRequest(repository: RoomRepository, roomId: string, input: ManageJoinRequestInput, context: MutationContext) {
  return manageJoinRequest(repository, roomId, input, context, "admit");
}

export function rejectJoinRequest(repository: RoomRepository, roomId: string, input: ManageJoinRequestInput, context: MutationContext) {
  return manageJoinRequest(repository, roomId, input, context, "reject");
}

const OWNER_LIFECYCLE_PHASES: RoomPhase[] = [
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
];

/**
 * Every owner-lifecycle operation (lock/unlock/remove/transfer) shares this
 * gate: derive the room, reject stale/finalized state, then confirm the
 * caller's own canonical seat is the current owner. This is a courtesy check
 * only -- the database repeats the identical derivation from `auth.uid()`
 * inside the same transaction that performs the mutation, so a spoofed or
 * stale client cannot skip it.
 */
async function requireOwnerRoom(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<RoomState | ActionResult<never>> {
  const room = await prepareMutation(repository, roomId, context, OWNER_LIFECYCLE_PHASES);
  if ("ok" in room) return room;
  const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
  if (!self || self.id !== room.ownerParticipantId || self.meetingRole !== "owner") {
    return failure("NOT_AUTHORIZED", "Only the current room owner can perform this action.", room.version);
  }
  return room;
}

/** Owner-only. Existing participants keep normal access; new join requests are refused. */
export async function lockMeeting(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<ActionResult> {
  const room = await requireOwnerRoom(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.lockMeeting(roomId, context);
}

/** Owner-only. Allows new join requests again. */
export async function unlockMeeting(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<ActionResult> {
  const room = await requireOwnerRoom(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.unlockMeeting(roomId, context);
}

/**
 * Owner-only. `input.participantId` is always the target of the removal, not
 * caller authority -- the acting owner is derived from the authenticated
 * session, never from a request field.
 */
export async function removeParticipant(
  repository: RoomRepository,
  roomId: string,
  input: RemoveParticipantInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = removeParticipantInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Removal input is invalid.", context.expectedRoomVersion);
  }
  const room = await requireOwnerRoom(repository, roomId, context);
  if ("ok" in room) return room;
  if (parsed.data.participantId === room.ownerParticipantId) {
    return failure(
      "NOT_AUTHORIZED",
      "The current owner cannot remove themselves. Transfer ownership first.",
      room.version,
    );
  }
  return repository.removeParticipant(roomId, parsed.data, context);
}

/**
 * Owner-only. Atomically moves meeting authority to another active human
 * participant. `input.participantId` names the *new* owner; the current
 * owner is derived from the authenticated session, never from the request.
 */
export async function transferOwnership(
  repository: RoomRepository,
  roomId: string,
  input: TransferOwnershipInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = transferOwnershipInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Ownership transfer input is invalid.", context.expectedRoomVersion);
  }
  const room = await requireOwnerRoom(repository, roomId, context);
  if ("ok" in room) return room;
  if (parsed.data.participantId === room.ownerParticipantId) {
    return failure(
      "VALIDATION_ERROR",
      "The target is already the meeting owner.",
      room.version,
    );
  }
  return repository.transferOwnership(roomId, parsed.data, context);
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

/**
 * A claimed human declares their own input complete.
 *
 * The acting seat is derived from the authenticated session inside the
 * database, so this operation carries no participant field and can never mark
 * another seat ready. The remaining prerequisites -- a claimed human seat and
 * at least one published position -- are enforced in the same transaction that
 * writes `ready_at`, bumps the room version and audits the event.
 */
export async function markMyInputReady(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<ActionResult> {
  const room = await prepareMutation(repository, roomId, context, ["input"]);
  if ("ok" in room) return room;
  return repository.markMyInputReady(roomId, context);
}

/**
 * Owner-only production phase advance.
 *
 * Deliberately not `advanceDemoRoomPhase`: that one is a demo-room developer
 * affordance authorized by any claimed seat, while this one is authorized by
 * the server-derived owner membership of a real room and enforces the per-phase
 * prerequisites (readiness, an active proposal, no blocking conflict, the
 * existing voting rules).
 *
 * `approval` is not a source phase here, so an owner can move a room into
 * approval but never past it: finalization stays with the last required human
 * approval.
 */
export async function advanceRoomPhase(
  repository: RoomRepository,
  roomId: string,
  nextPhase: RoomPhase,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = roomPhaseSchema.safeParse(nextPhase);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Invalid room phase.", context.expectedRoomVersion);
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
      "Only the next room phase may be selected.",
      room.version,
    );
  }
  return repository.advanceRoomPhase(roomId, parsed.data, context);
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
