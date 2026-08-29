import type { CreateRoomInput, CreatedRoom } from "@/contracts/room";

/**
 * Volatile handoff for the single client-side transition from creation to setup.
 * Raw invitation capabilities never enter RoomState or durable browser storage.
 * A refresh intentionally clears this value; B2 can replace it with an
 * organizer-authorized refetch when that backend surface exists.
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
      participants: input.participants.map((participant) => ({ ...participant })),
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
