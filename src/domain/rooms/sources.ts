import {
  createMeetingSourceInputSchema,
  markMeetingSourceFailedInputSchema,
  markMeetingSourceProcessedInputSchema,
  meetingSourceIdInputSchema,
  readMeetingSourceContentInputSchema,
  searchMeetingSourcesInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type CreateMeetingSourceInput,
  type MarkMeetingSourceFailedInput,
  type MarkMeetingSourceProcessedInput,
  type MeetingSourceIdInput,
  type MeetingSource,
  type MeetingSourceContent,
  type MeetingSourceSearchResults,
  type ReadMeetingSourceContentInput,
  type RoomState,
  type SearchMeetingSourcesInput,
} from "@/contracts/room";
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

export async function listMeetingSources(
  repository: RoomRepository,
  roomId: string,
  actor: DomainActor,
): Promise<ActionResult<MeetingSource[]>> {
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.listSources(roomId, actor);
}

export async function createMeetingSource(
  repository: RoomRepository,
  roomId: string,
  input: CreateMeetingSourceInput,
  context: MutationContext,
): Promise<ActionResult<MeetingSource>> {
  const parsed = createMeetingSourceInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "VALIDATION_ERROR",
      "Meeting source input is invalid.",
      context.expectedRoomVersion,
    );
  }
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }

  const room = await repository.getRoom(roomId, context.actor.authUserId);
  if (!room) return failure("VALIDATION_ERROR", "Room not found.", 0);
  if (room.version !== context.expectedRoomVersion) {
    return failure(
      "STALE_ROOM_STATE",
      "The room changed before this source was added.",
      room.version,
      "Review the latest room state and retry if the source is still appropriate.",
    );
  }
  if (room.phase === "finalized") {
    return failure("ALREADY_FINALIZED", "The finalized decision is immutable.", room.version);
  }
  if (room.phase !== "input") {
    return failure(
      "WRONG_PHASE",
      "Meeting sources can only be added while the room is gathering input.",
      room.version,
    );
  }
  if (room.selfParticipantId === null) {
    return failure(
      "NOT_AUTHORIZED",
      "Only an active admitted participant can add meeting sources.",
      room.version,
    );
  }

  return repository.createSource(roomId, parsed.data, context);
}

export async function readMeetingSourceContent(
  repository: RoomRepository,
  roomId: string,
  input: ReadMeetingSourceContentInput,
  actor: DomainActor,
): Promise<ActionResult<MeetingSourceContent>> {
  const parsed = readMeetingSourceContentInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Meeting source read input is invalid.", 0);
  }
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.readSourceContent(roomId, parsed.data, actor);
}

export async function searchMeetingSources(
  repository: RoomRepository,
  roomId: string,
  input: SearchMeetingSourcesInput,
  actor: DomainActor,
): Promise<ActionResult<MeetingSourceSearchResults>> {
  const parsed = searchMeetingSourcesInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Meeting source search input is invalid.", 0);
  }
  if (!actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.searchSources(roomId, parsed.data, actor);
}

export async function markMeetingSourceProcessed(
  repository: RoomRepository,
  roomId: string,
  input: MarkMeetingSourceProcessedInput,
  context: MutationContext,
): Promise<ActionResult<MeetingSource>> {
  const parsed = markMeetingSourceProcessedInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "VALIDATION_ERROR",
      "Meeting source processing input is invalid.",
      context.expectedRoomVersion,
    );
  }
  const room = await prepareSourceMutation<MeetingSource>(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.markSourceProcessed(roomId, parsed.data, context);
}

export async function markMeetingSourceFailed(
  repository: RoomRepository,
  roomId: string,
  input: MarkMeetingSourceFailedInput,
  context: MutationContext,
): Promise<ActionResult<MeetingSource>> {
  const parsed = markMeetingSourceFailedInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "VALIDATION_ERROR",
      "Meeting source failure input is invalid.",
      context.expectedRoomVersion,
    );
  }
  const room = await prepareSourceMutation<MeetingSource>(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.markSourceFailed(roomId, parsed.data, context);
}

export async function shareMeetingSource(
  repository: RoomRepository,
  roomId: string,
  input: MeetingSourceIdInput,
  context: MutationContext,
): Promise<ActionResult<MeetingSource>> {
  const parsed = meetingSourceIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Meeting source input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareSourceMutation<MeetingSource>(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.shareSource(roomId, parsed.data, context);
}

export async function removeMeetingSource(
  repository: RoomRepository,
  roomId: string,
  input: MeetingSourceIdInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = meetingSourceIdInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Meeting source input is invalid.", context.expectedRoomVersion);
  }
  const room = await prepareSourceMutation(repository, roomId, context);
  if ("ok" in room) return room;
  return repository.removeSource(roomId, parsed.data, context);
}

async function prepareSourceMutation<T = null>(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<RoomState | ActionResult<T>> {
  if (!context.actor.authUserId) {
    return failure<T>("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  const room = await repository.getRoom(roomId, context.actor.authUserId);
  if (!room) return failure<T>("VALIDATION_ERROR", "Room not found.", 0);
  if (room.version !== context.expectedRoomVersion) {
    return failure<T>(
      "STALE_ROOM_STATE",
      "The room changed before this source action completed.",
      room.version,
      "Review the latest room state and retry if the source action is still appropriate.",
    );
  }
  if (room.phase === "finalized") {
    return failure<T>("ALREADY_FINALIZED", "The finalized decision is immutable.", room.version);
  }
  if (room.selfParticipantId === null) {
    return failure<T>(
      "NOT_AUTHORIZED",
      "Only an active admitted participant can manage meeting sources.",
      room.version,
    );
  }
  return room;
}
