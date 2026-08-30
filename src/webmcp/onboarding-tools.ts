"use client";

import { z } from "zod";
import {
  createRoomInputSchema,
  requestJoinByInviteInputSchema,
  requestJoinByPasscodeInputSchema,
  type ActionResult,
  type JoinRequest,
} from "@/contracts/room";
import {
  createRoom,
  getMyJoinRequest as domainGetMyJoinRequest,
  requestJoinByInvite,
  requestJoinByPasscode,
} from "@/domain/rooms/operations";
import type { DomainActor } from "@/domain/rooms/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";
import { executeToolSafely, readToolSuccess, toolRefusal } from "./tool-result";
import { readPendingJoinRequest, savePendingJoinRequest } from "./join-request-store";

/**
 * Pre-membership counterpart to `RoomWebMcpContext`: identity bootstrap plus
 * a repository, but no `roomId`/version yet, because the caller has no seat
 * -- and therefore no readable room version -- until admitted. Reuses
 * `SupabaseRoomRepository` directly: its `RoomRepository` interface already
 * includes `createRoom`/`requestJoinByPasscode`/`requestJoinByInvite`/
 * `getMyJoinRequest`, the same repository the post-membership tools use.
 */
export class OnboardingWebMcpContext {
  readonly repository = new SupabaseRoomRepository(createBrowserSupabaseClient());

  async getActor(): Promise<DomainActor> {
    return { authUserId: await this.getActorUserId(), origin: "webmcp" };
  }

  private async getActorUserId(): Promise<string> {
    const client = createBrowserSupabaseClient();
    const existing = await client.auth.getUser();
    if (existing.data.user) return existing.data.user.id;
    const signedIn = await client.auth.signInAnonymously();
    if (signedIn.error || !signedIn.data.user) {
      throw new Error(signedIn.error?.message ?? "Anonymous sign-in failed.");
    }
    return signedIn.data.user.id;
  }
}

/** Extracts an invite token whether the agent has a bare token or a full invite URL. */
function extractInviteToken(value: string): string {
  try {
    const url = new URL(value);
    const fromQuery = url.searchParams.get("invite");
    return fromQuery ?? value;
  } catch {
    return value;
  }
}

const joinMeetingToolInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("passcode"),
    roomId: z.string().min(1),
    passcode: z.string().min(1).max(64),
    displayName: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
  }).strict(),
  z.object({
    method: z.literal("invite"),
    inviteToken: z.string().min(1).max(512),
    displayName: z.string().trim().min(1).max(120),
    role: z.string().trim().min(1).max(120),
  }).strict(),
]);

const joinMeetingToolJsonSchema = {
  type: "object",
  oneOf: [
    {
      properties: {
        method: { const: "passcode" },
        roomId: { type: "string", minLength: 1 },
        passcode: { type: "string", minLength: 1 },
        displayName: { type: "string", minLength: 1 },
        role: { type: "string", minLength: 1 },
      },
      required: ["method", "roomId", "passcode", "displayName", "role"],
      additionalProperties: false,
    },
    {
      properties: {
        method: { const: "invite" },
        inviteToken: { type: "string", minLength: 1 },
        displayName: { type: "string", minLength: 1 },
        role: { type: "string", minLength: 1 },
      },
      required: ["method", "inviteToken", "displayName", "role"],
      additionalProperties: false,
    },
  ],
} as const;

function joinResultData(result: ActionResult<{ roomId: string; joinRequest: JoinRequest }>) {
  if (!result.ok) return result;
  savePendingJoinRequest({ joinRequestId: result.data.joinRequest.id, roomId: result.data.roomId });
  // `join-room.tsx` picks the pending request up from the store (same-page,
  // via the `webmcp:join-request-created` event `savePendingJoinRequest`
  // dispatches) if it is already mounted; otherwise navigate there so the
  // waiting state is visible.
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/join")) {
    // Tool execution is outside React's event/render lifecycle, so a full
    // internal navigation is the reliable handoff into the visible waiting UI.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/join");
  }
  return result;
}

export function createOnboardingWebMcpTools(context: OnboardingWebMcpContext): Record<string, WebMcpToolDefinition> {
  return {
    create_meeting: {
      name: "create_meeting",
      description:
        "Create a new decision room as its owner and initial decision-maker. Give it a clear title and a short brief describing the decision to be made, plus the creator's own display name and role. Navigates the browser into the new room and returns its invite URL and one-time passcode so they can be shared -- no seat count or other participants are needed to create a room.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          brief: { type: "string", minLength: 1, maxLength: 4000 },
          creatorName: { type: "string", minLength: 1, maxLength: 120 },
          creatorRole: { type: "string", minLength: 1, maxLength: 120 },
          decisionPolicy: { type: ["string", "null"], enum: ["owner_decides", "equal_authority_consensus", null] },
        },
        required: ["title", "brief", "creatorName", "creatorRole"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (rawInput) =>
        executeToolSafely(async () => {
          const parsedInput = createRoomInputSchema.parse(
            typeof rawInput === "object" && rawInput !== null
              ? Object.fromEntries(
                  Object.entries(rawInput as Record<string, unknown>).filter(([, value]) => value !== null),
                )
              : rawInput,
          );
          const actor = await context.getActor();
          const result = await createRoom(
            context.repository,
            parsedInput,
            typeof window !== "undefined" ? { actor, baseUrl: window.location.origin } : { actor },
          );
          if (result.ok && typeof window !== "undefined") {
            // See the join navigation note above: the tool is not a React handler.
            // eslint-disable-next-line @next/next/no-location-assign-relative-destination
            window.location.assign(`/room/${encodeURIComponent(result.data.roomId)}`);
          }
          return result;
        }, () => 0),
    },

    join_meeting: {
      name: "join_meeting",
      description:
        "Request to join an existing meeting, by room ID + passcode or by invite link/token, with the joining participant's own display name and role. This creates a waiting join request and moves the browser to the waiting room -- it never admits the participant directly; the meeting owner must admit them. An invalid room ID, passcode, or invite fails without revealing whether a matching room exists.",
      inputSchema: joinMeetingToolJsonSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (rawInput) =>
        executeToolSafely(async () => {
          const input = joinMeetingToolInputSchema.parse(rawInput);
          const actor = await context.getActor();
          if (input.method === "passcode") {
            const parsed = requestJoinByPasscodeInputSchema.parse({
              roomId: input.roomId,
              passcode: input.passcode,
              displayName: input.displayName,
              role: input.role,
            });
            return joinResultData(await requestJoinByPasscode(context.repository, parsed, actor));
          }
          const parsed = requestJoinByInviteInputSchema.parse({
            inviteToken: extractInviteToken(input.inviteToken),
            displayName: input.displayName,
            role: input.role,
          });
          return joinResultData(await requestJoinByInvite(context.repository, parsed, actor));
        }, () => 0),
    },

    get_my_join_status: {
      name: "get_my_join_status",
      description:
        "Check only the authenticated browser session's own pending join request: waiting, admitted, or rejected. Never lists other prospective participants. If admitted, the application navigates into the room automatically once this or the visible waiting page next checks.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute: () =>
        executeToolSafely(async () => {
          const pending = readPendingJoinRequest();
          if (!pending) {
            return toolRefusal(
              "VALIDATION_ERROR",
              "No join request is pending in this browser session.",
              "Call join_meeting first.",
              0,
            );
          }
          const actor = await context.getActor();
          const result = await domainGetMyJoinRequest(context.repository, pending.joinRequestId, actor);
          if (result.ok) {
            return readToolSuccess(
              { status: result.data.status, roomId: pending.roomId },
              0,
              "Join status loaded.",
            );
          }
          return result;
        }, () => 0),
    },
  };
}
