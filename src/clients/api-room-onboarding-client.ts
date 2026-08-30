"use client";

import { z } from "zod";
import {
  actionResultSchema,
  createdRoomSchema,
  joinRequestResultSchema,
  joinRequestSchema,
  roomInvitePreviewSchema,
  type ActionResult,
  type CreateRoomInput,
  type CreatedRoom,
  type JoinRequest,
  type JoinRequestResult,
  type RequestJoinByInviteInput,
  type RequestJoinByPasscodeInput,
  type RoomInvitePreview,
} from "@/contracts/room";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ensureAnonymousAccessToken } from "@/lib/supabase/session";
import type { SupabaseClient } from "@supabase/supabase-js";

function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export class ApiRoomOnboardingClient implements RoomOnboardingClient {
  constructor(private readonly supabase: SupabaseClient = createBrowserSupabaseClient()) {}

  async createRoom(input: CreateRoomInput): Promise<CreatedRoom> {
    return unwrap(await this.post("/api/rooms", input, createdRoomSchema));
  }

  async previewInvite(inviteToken: string): Promise<RoomInvitePreview> {
    return unwrap(await this.post("/api/invitations/preview", { inviteToken }, roomInvitePreviewSchema));
  }

  requestJoinByPasscode(input: RequestJoinByPasscodeInput): Promise<ActionResult<JoinRequestResult>> {
    return this.post("/api/join-requests/passcode", input, joinRequestResultSchema);
  }

  requestJoinByInvite(input: RequestJoinByInviteInput): Promise<ActionResult<JoinRequestResult>> {
    return this.post("/api/join-requests/invite", input, joinRequestResultSchema);
  }

  getMyJoinRequest(joinRequestId: string): Promise<ActionResult<JoinRequest>> {
    return this.get(`/api/join-requests/${encodeURIComponent(joinRequestId)}`, joinRequestSchema);
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<ActionResult<T>> {
    const token = await ensureAnonymousAccessToken(this.supabase);
    const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    return this.parse(response, path, schema);
  }

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<ActionResult<T>> {
    const token = await ensureAnonymousAccessToken(this.supabase);
    const response = await fetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parse(response, path, schema);
  }

  private async parse<T>(response: Response, path: string, schema: z.ZodType<T>): Promise<ActionResult<T>> {
    const parsed = actionResultSchema(schema).safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new Error(`Request to ${path} failed with HTTP ${response.status}.`);
    return parsed.data as ActionResult<T>;
  }
}
