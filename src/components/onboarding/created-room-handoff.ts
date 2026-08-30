import type { CreateRoomInput, CreatedRoom } from "@/contracts/room";

/**
 * @deprecated Slice 1 routes creators directly into the room. Kept only for
 * compatibility with the old setup page tests/bookmarks; it contains no
 * invitation capability or participant-seat configuration.
 */
type PendingCreatedRoom = {
  createdRoom: CreatedRoom;
  /** Presentation metadata only; it grants no participant authority. */
  input: CreateRoomInput;
};

let pendingCreatedRoom: PendingCreatedRoom | null = null;

export function stageCreatedRoomForSetup(
  createdRoom: CreatedRoom,
  input: CreateRoomInput,
): void {
  pendingCreatedRoom = {
    createdRoom,
    input: {
      title: input.title,
      brief: input.brief,
      creatorName: input.creatorName,
      creatorRole: input.creatorRole,
      ...(input.decisionPolicy ? { decisionPolicy: input.decisionPolicy } : {}),
    },
  };
}

export function readCreatedRoomForSetup(roomId: string): PendingCreatedRoom | null {
  return pendingCreatedRoom?.createdRoom.roomId === roomId
    ? pendingCreatedRoom
    : null;
}

export function clearCreatedRoomHandoff(): void {
  pendingCreatedRoom = null;
}
