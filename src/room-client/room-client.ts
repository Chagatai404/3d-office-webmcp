"use client";

import type { RoomClient } from "@/contracts/room";
import { ApiRoomClient } from "@/clients/api-room-client";

/**
 * Single place where the frontend chooses its `RoomClient` implementation.
 *
 * Production defaults to `ApiRoomClient`. Tests may inject a deterministic
 * client through `setRoomClientForTests` without changing providers or UI.
 */
export type { RoomClient } from "@/contracts/room";

let client: RoomClient | null = null;

export function getRoomClient(): RoomClient {
  client ??= new ApiRoomClient();
  return client;
}

/**
 * Test-only dependency injection seam.
 *
 * This prevents jsdom component tests from constructing `ApiRoomClient` and
 * requiring browser Supabase environment variables. Production code should
 * never call this function.
 */
export function setRoomClientForTests(next: RoomClient | null): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setRoomClientForTests is only available while NODE_ENV=test.");
  }
  client = next;
}

/** Test seam: drops any injected or memoized client. */
export function resetRoomClient(): void {
  client = null;
}
