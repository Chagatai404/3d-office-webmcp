"use client";

import { z } from "zod";
import {
  actionResultSchema,
  claimInvitationResultSchema,
  createdRoomSchema,
  roomInvitePreviewSchema,
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

/** Callers that expect a value rather than a structured refusal. */
function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

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
    return unwrap(await this.post("/api/rooms", input, createdRoomSchema));
  }

  /**
   * An unknown, expired, revoked or already-spent token is a normal answer, not
   * a failure: it resolves to the `inviteValid: false` preview, which carries
   * no room details.
   */
  async previewInvitation(inviteToken: string): Promise<RoomInvitePreview> {
    return unwrap(
      await this.post(
        "/api/invitations/preview",
        { inviteToken },
        roomInvitePreviewSchema,
      ),
    );
  }

  /**
   * Returns the raw `ActionResult` so the join UI can render the structured
   * reason a capability was refused instead of a thrown message.
   */
  claimInvitation(
    input: ClaimInvitationInput,
  ): Promise<ActionResult<ClaimInvitationResult>> {
    return this.post("/api/invitations/claim", input, claimInvitationResultSchema);
  }

  private async post<T>(
    path: string,
    body: unknown,
    dataSchema: z.ZodType<T>,
  ): Promise<ActionResult<T>> {
    const accessToken = await ensureAnonymousAccessToken(this.supabase);
    const response = await fetch(path, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const parsed = actionResultSchema(dataSchema).safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      throw new Error(`Request to ${path} failed with HTTP ${response.status}.`);
    }
    return parsed.data as ActionResult<T>;
  }
}
