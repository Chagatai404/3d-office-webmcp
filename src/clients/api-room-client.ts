"use client";

import { z } from "zod";
import {
  actionResultSchema,
  roomStateSchema,
  type ActionResult,
  type AddPositionInput,
  type CastVoteInput,
  type ClaimSeatInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type ProposeTradeoffInput,
  type RaiseObjectionInput,
  type RoomClient,
  type RoomPhase,
  type RoomState,
  type SubmitProposalInput,
} from "@/contracts/room";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
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

  proposeTradeoff(roomId: string, _input: ProposeTradeoffInput): Promise<ActionResult> {
    void _input;
    return Promise.resolve(this.notAvailable(roomId, "Trade-offs"));
  }

  castMyVote(roomId: string, _input: CastVoteInput): Promise<ActionResult> {
    void _input;
    return Promise.resolve(this.notAvailable(roomId, "Voting"));
  }

  previewFinalDecision(roomId: string): Promise<ActionResult<FinalDecisionPreview>> {
    return Promise.resolve(this.notAvailable(roomId, "Final decision preview"));
  }

  approveFinalDecision(
    roomId: string,
    _input: { decisionHash: string },
  ): Promise<ActionResult> {
    void _input;
    return Promise.resolve(this.notAvailable(roomId, "Approval"));
  }

  getDecisionRecord(roomId: string): Promise<ActionResult<DecisionRecord>> {
    return Promise.resolve(this.notAvailable(roomId, "Decision records"));
  }

  advanceDemoPhase(roomId: string, phase: RoomPhase) {
    return this.mutate(roomId, "phase", { phase }, `/api/dev/rooms/${encodeURIComponent(roomId)}/phase`);
  }

  private async ensureAnonymousSession(): Promise<string> {
    if (this.sessionPromise) return this.sessionPromise;
    this.sessionPromise = (async () => {
      const { data } = await this.supabase.auth.getSession();
      if (data.session) return data.session.access_token;
      const { data: signInData, error } = await this.supabase.auth.signInAnonymously();
      if (error || !signInData.session) throw new Error(error?.message ?? "Anonymous sign-in failed.");
      return signInData.session.access_token;
    })();
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

  private notAvailable(roomId: string, feature: string) {
    return {
      ok: false as const,
      error: {
        code: "WRONG_PHASE" as const,
        message: `${feature} is not implemented in the current backend milestone.`,
      },
      roomVersion: this.versions.get(roomId) ?? 0,
    };
  }
}
