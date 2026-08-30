"use client";

import { z } from "zod";
import {
  actionResultSchema,
  decisionRecordSchema,
  finalDecisionPreviewSchema,
  joinRequestSchema,
  roomStateSchema,
  type ActionResult,
  type AddPositionInput,
  type ExpressAlignmentInput,
  type ClaimSeatInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type ManageJoinRequestInput,
  type JoinRequest,
  type ProposeTradeoffInput,
  type RaiseObjectionInput,
  type RemoveParticipantInput,
  type ResolveObjectionInput,
  type RoomClient,
  type RoomPhase,
  type RoomState,
  type SetDecisionPolicyInput,
  type SetParticipantDecisionRoleInput,
  type StartDemoScenarioInput,
  type SubmitProposalInput,
  type TransferOwnershipInput,
} from "@/contracts/room";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ensureAnonymousAccessToken } from "@/lib/supabase/session";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

export class ApiRoomClient implements RoomClient {
  private readonly supabase: SupabaseClient;
  private readonly versions = new Map<string, number>();
  private readonly subscribers = new Map<string, Set<(state: RoomState) => void>>();
  private readonly channels = new Map<string, RealtimeChannel>();
  private readonly startingChannels = new Set<string>();
  private sessionPromise: Promise<string> | null = null;

  constructor(supabase = createBrowserSupabaseClient()) {
    this.supabase = supabase;
  }

  async getRoom(roomId: string): Promise<RoomState> {
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Unable to load room (${response.status}).`);
    const room = roomStateSchema.parse(await response.json());
    this.versions.set(roomId, room.version);
    return room;
  }

  subscribe(roomId: string, callback: (state: RoomState) => void): () => void {
    const callbacks = this.subscribers.get(roomId) ?? new Set();
    callbacks.add(callback);
    this.subscribers.set(roomId, callbacks);
    void this.refresh(roomId);

    void this.startRealtime(roomId);

    return () => {
      callbacks.delete(callback);
      if (callbacks.size > 0) return;
      this.subscribers.delete(roomId);
      const channel = this.channels.get(roomId);
      if (channel) void this.supabase.removeChannel(channel);
      this.channels.delete(roomId);
    };
  }

  claimSeat(roomId: string, input: ClaimSeatInput) {
    return this.mutate(roomId, "claim-seat", input);
  }

  addMyPosition(roomId: string, input: AddPositionInput) {
    return this.mutate(roomId, "positions", input);
  }

  submitProposal(roomId: string, input: SubmitProposalInput) {
    return this.mutate(roomId, "proposals", input);
  }

  raiseObjection(roomId: string, input: RaiseObjectionInput) {
    return this.mutate(roomId, "objections", input);
  }

  resolveObjection(roomId: string, input: ResolveObjectionInput) {
    return this.mutate(roomId, "resolve-objection", input);
  }

  proposeTradeoff(roomId: string, input: ProposeTradeoffInput): Promise<ActionResult> {
    return this.mutate(roomId, "tradeoffs", input);
  }

  expressMyAlignment(roomId: string, input: ExpressAlignmentInput): Promise<ActionResult> {
    return this.mutate(roomId, "alignments", input);
  }

  previewFinalDecision(roomId: string): Promise<ActionResult<FinalDecisionPreview>> {
    return this.readAction(roomId, "final-decision", finalDecisionPreviewSchema);
  }

  approveFinalDecision(
    roomId: string,
    input: { decisionHash: string },
  ): Promise<ActionResult> {
    return this.mutate(roomId, "approval", input, undefined, {
      "X-Human-Confirmed": "true",
    });
  }

  getDecisionRecord(roomId: string): Promise<ActionResult<DecisionRecord>> {
    return this.readAction(roomId, "decision-record", decisionRecordSchema);
  }

  async startDemoScenario(
    roomId: string,
    input: StartDemoScenarioInput,
  ): Promise<ActionResult> {
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(
      `/api/dev/rooms/${encodeURIComponent(roomId)}/scenario`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
    const parsed = actionResultSchema(z.null()).safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`Demo reset failed with HTTP ${response.status}.`);
    }
    const result = parsed.data as ActionResult;
    this.versions.set(roomId, result.roomVersion);
    await this.refresh(roomId);
    return result;
  }

  advanceDemoPhase(roomId: string, phase: RoomPhase) {
    return this.mutate(roomId, "phase", { phase }, `/api/dev/rooms/${encodeURIComponent(roomId)}/phase`);
  }

  /** No body: the server derives the acting seat from the session. */
  markMyInputReady(roomId: string): Promise<ActionResult> {
    return this.mutate(roomId, "ready", {});
  }

  /** Organizer-only. Distinct route from `advanceDemoPhase`. */
  advanceRoomPhase(roomId: string, phase: RoomPhase): Promise<ActionResult> {
    return this.mutate(roomId, "phase", { phase });
  }

  listJoinRequests(roomId: string): Promise<ActionResult<JoinRequest[]>> {
    return this.readAction(roomId, "join-requests", z.array(joinRequestSchema));
  }

  admitJoinRequest(roomId: string, input: ManageJoinRequestInput): Promise<ActionResult<JoinRequest>> {
    return this.mutateWithData(roomId, "join-requests/admit", input, joinRequestSchema);
  }

  rejectJoinRequest(roomId: string, input: ManageJoinRequestInput): Promise<ActionResult<JoinRequest>> {
    return this.mutateWithData(roomId, "join-requests/reject", input, joinRequestSchema);
  }

  lockMeeting(roomId: string): Promise<ActionResult> {
    return this.mutate(roomId, "lock", {});
  }

  unlockMeeting(roomId: string): Promise<ActionResult> {
    return this.mutate(roomId, "unlock", {});
  }

  removeParticipant(roomId: string, input: RemoveParticipantInput): Promise<ActionResult> {
    return this.mutate(roomId, "participants/remove", input);
  }

  transferOwnership(roomId: string, input: TransferOwnershipInput): Promise<ActionResult> {
    return this.mutate(roomId, "ownership", input);
  }

  setDecisionPolicy(roomId: string, input: SetDecisionPolicyInput): Promise<ActionResult> {
    return this.mutate(roomId, "decision-policy", input);
  }

  setParticipantDecisionRole(
    roomId: string,
    input: SetParticipantDecisionRoleInput,
  ): Promise<ActionResult> {
    return this.mutate(roomId, "decision-role", input);
  }

  private async ensureAnonymousSession(): Promise<string> {
    if (this.sessionPromise) return this.sessionPromise;
    this.sessionPromise = ensureAnonymousAccessToken(this.supabase);
    try {
      return await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
  }

  private async mutate(
    roomId: string,
    action: string,
    input: unknown,
    explicitUrl?: string,
    extraHeaders?: Record<string, string>,
  ): Promise<ActionResult> {
    if (!this.versions.has(roomId)) await this.getRoom(roomId);
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(
      explicitUrl ?? `/api/rooms/${encodeURIComponent(roomId)}/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "If-Match": String(this.versions.get(roomId) ?? 0),
          ...extraHeaders,
        },
        body: JSON.stringify(input),
      },
    );
    const parsed = actionResultSchema(z.null()).safeParse(await response.json());
    if (!parsed.success) throw new Error(`Room action failed with HTTP ${response.status}.`);
    const result = parsed.data as ActionResult;
    this.versions.set(roomId, result.roomVersion);
    if (result.ok || result.error.code === "STALE_ROOM_STATE") await this.refresh(roomId);
    return result;
  }

  private async readAction<T>(
    roomId: string,
    action: string,
    dataSchema: z.ZodType<T>,
  ): Promise<ActionResult<T>> {
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const parsed = actionResultSchema(dataSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error(`Room query failed with HTTP ${response.status}.`);
    this.versions.set(roomId, parsed.data.roomVersion);
    return parsed.data as ActionResult<T>;
  }

  private async mutateWithData<T>(
    roomId: string,
    action: string,
    input: unknown,
    dataSchema: z.ZodType<T>,
  ): Promise<ActionResult<T>> {
    if (!this.versions.has(roomId)) await this.getRoom(roomId);
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "If-Match": String(this.versions.get(roomId) ?? 0),
      },
      body: JSON.stringify(input),
    });
    const parsed = actionResultSchema(dataSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error(`Room action failed with HTTP ${response.status}.`);
    const result = parsed.data as ActionResult<T>;
    this.versions.set(roomId, result.roomVersion);
    if (result.ok || result.error.code === "STALE_ROOM_STATE") await this.refresh(roomId);
    return result;
  }

  private async refresh(roomId: string) {
    try {
      const state = await this.getRoom(roomId);
      this.subscribers.get(roomId)?.forEach((callback) => callback(state));
    } catch (error) {
      console.error("Room refresh failed", error);
    }
  }

  private async startRealtime(roomId: string) {
    if (this.channels.has(roomId) || this.startingChannels.has(roomId)) return;
    this.startingChannels.add(roomId);
    try {
      const accessToken = await this.ensureAnonymousSession();
      await this.supabase.realtime.setAuth(accessToken);
      if (!this.subscribers.has(roomId)) return;
      const channel = this.supabase
        .channel(`room:${roomId}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          () => void this.refresh(roomId),
        )
        .subscribe();
      this.channels.set(roomId, channel);
    } finally {
      this.startingChannels.delete(roomId);
    }
  }
}
