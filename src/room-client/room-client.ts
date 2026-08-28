"use client";

import type {
  RoomClient,
} from "@/contracts/room";

import {
  ApiRoomClient,
} from "@/clients/api-room-client";

/**
 * Single place where the frontend chooses its RoomClient implementation.
 *
 * The entire frontend depends only on the canonical RoomClient contract.
 *
 * MockRoomClient has now been replaced by ApiRoomClient at this boundary.
 * Providers, panels, view models, and 3D components remain unchanged.
 */

export type {
  RoomClient,
} from "@/contracts/room";

let client: RoomClient | null = null;

export function getRoomClient(): RoomClient {
  client ??= new ApiRoomClient();

  return client;
}

/**
 * Test seam.
 *
 * Drops the memoized client so a future call creates a fresh instance.
 */
export function resetRoomClient(): void {
  client = null;
}