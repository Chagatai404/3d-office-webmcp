import type { RoomClient } from "@/contracts/room";
import { demoRoom } from "@/fixtures/demo-room";
import { MockRoomClient } from "./mock-room-client";

/**
 * Single place where the frontend chooses its `RoomClient` implementation.
 *
 * BACKEND CONTRACT:
 * Milestone I replaces the constructed implementation here with
 * `ApiRoomClient`. No provider, panel, view model, or 3D component may import
 * a concrete client, so that swap stays local to this module.
 */

export type { RoomClient } from "@/contracts/room";

let client: RoomClient | null = null;

export function getRoomClient(): RoomClient {
  client ??= new MockRoomClient(demoRoom);
  return client;
}

/** Test seam: drops the memoized client so each test starts from the seed. */
export function resetRoomClient(): void {
  client = null;
}
