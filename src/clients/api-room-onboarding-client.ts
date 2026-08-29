"use client";

import {
  actionResultSchema,
  createdRoomSchema,
  type ActionResult,
  type ClaimInvitationInput,
  type ClaimInvitationResult,
  type CreateRoomInput,
  type CreatedRoom,
  type RoomInvitePreview,
} from "@/contracts/room";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ensureAnonymousAccessToken } from "@/lib/supabase/session";
import type { SupabaseClient } from "@supabase/supabase-js";

const NOT_IMPLEMENTED_UNTIL_A2 =
  "Invitation preview and claim arrive with the secure invitation slice.";

/**
 * Pre-membership onboarding over the HTTP API. Deliberately separate from
 * `ApiRoomClient`: these calls happen before the caller holds a seat, so they
 * carry no room version and never touch room-runtime state.
 */
export class ApiRoomOnboardingClient implements RoomOnboardingClient {
  private readonly supabase: SupabaseClient;

  constructor(supabase = createBrowserSupabaseClient()) {
    this.supabase = supabase;
  }

  async createRoom(input: CreateRoomInput): Promise<CreatedRoom> {
    const accessToken = await ensureAnonymousAccessToken(this.supabase);
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const parsed = actionResultSchema(createdRoomSchema).safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new Error(`Room creation failed with HTTP ${response.status}.`);
    }
    const result = parsed.data as ActionResult<CreatedRoom>;
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  previewInvitation(inviteToken: string): Promise<RoomInvitePreview> {
    void inviteToken;
    return Promise.reject(new Error(NOT_IMPLEMENTED_UNTIL_A2));
  }

  claimInvitation(
    input: ClaimInvitationInput,
  ): Promise<ActionResult<ClaimInvitationResult>> {
    void input;
    return Promise.reject(new Error(NOT_IMPLEMENTED_UNTIL_A2));
  }
}
