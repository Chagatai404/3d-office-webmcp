import type { CreatedRoom } from "@/contracts/room";

/**
 * Volatile handoff for the single client-side transition from creation to setup.
 * Raw invitation capabilities never enter RoomState or durable browser storage.
 * A refresh intentionally clears this value; B2 can replace it with an
 * organizer-authorized refetch when that backend surface exists.
 */
let pendingCreatedRoom: CreatedRoom | null = null;

export function stageCreatedRoomForSetup(createdRoom: CreatedRoom): void {
  pendingCreatedRoom = createdRoom;
}

export function readCreatedRoomForSetup(roomId: string): CreatedRoom | null {
  return pendingCreatedRoom?.roomId === roomId ? pendingCreatedRoom : null;
}

export function clearCreatedRoomHandoff(): void {
  pendingCreatedRoom = null;
}
