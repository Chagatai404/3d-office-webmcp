"use client";

import { z } from "zod";
import {
  actionResultSchema,
  decisionRecordSchema,
  finalDecisionPreviewSchema,
  joinRequestSchema,
  meetingSourceContentSchema,
  meetingSourceSearchResultsSchema,
  meetingSourceSchema,
  roomStateSchema,
  type ActionResult,
  type AddPositionInput,
  type ExpressAlignmentInput,
  type ClaimSeatInput,
  type CreateMeetingSourceInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type ManageJoinRequestInput,
  type JoinRequest,
  type MarkMeetingSourceFailedInput,
  type MarkMeetingSourceProcessedInput,
  type MeetingSource,
  type MeetingSourceContent,
  type MeetingSourceSearchResults,
  type MeetingSourceVisibility,
  type ProposeTradeoffInput,
  type RaiseObjectionInput,
  type ReadMeetingSourceContentInput,
  type RemoveParticipantInput,
  type ResolveObjectionInput,
  type RoomClient,
  type RoomPhase,
  type SearchMeetingSourcesInput,
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

class RoomLoadError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RoomLoadError";
  }
}

type RoomSubscription = {
  callback: (state: RoomState) => void;
  onUnavailable: (() => void) | undefined;
};

export interface UploadMeetingSourceInput {
  file: File;
  title?: string;
  visibility: MeetingSourceVisibility;
}

const TERMINAL_ROOM_STATUSES = new Set([401, 403, 404]);

export class ApiRoomClient implements RoomClient {
  private readonly supabase: SupabaseClient;
  private readonly versions = new Map<string, number>();
  private readonly subscribers = new Map<string, Set<RoomSubscription>>();
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
    if (!response.ok) {
      throw new RoomLoadError(response.status, "The room could not be loaded.");
    }
    const room = roomStateSchema.parse(await response.json());
    this.versions.set(roomId, room.version);
    return room;
  }

  subscribe(
    roomId: string,
    callback: (state: RoomState) => void,
    onUnavailable?: () => void,
  ): () => void {
    const subscriptions = this.subscribers.get(roomId) ?? new Set();
    const subscription = { callback, onUnavailable };
    subscriptions.add(subscription);
    this.subscribers.set(roomId, subscriptions);
    void this.startRealtime(roomId);

    return () => {
      subscriptions.delete(subscription);
      if (subscriptions.size > 0) return;
      this.subscribers.delete(roomId);
      this.stopRealtime(roomId);
    };
  }

  claimSeat(roomId: string, input: ClaimSeatInput) {
    return this.mutate(roomId, "claim-seat", input);
  }

  listMeetingSources(roomId: string): Promise<ActionResult<MeetingSource[]>> {
    return this.readAction(roomId, "sources", z.array(meetingSourceSchema));
  }

  createMeetingSource(
    roomId: string,
    input: CreateMeetingSourceInput,
  ): Promise<ActionResult<MeetingSource>> {
    return this.mutateWithData(roomId, "sources", input, meetingSourceSchema);
  }

  async uploadMeetingSource(
    roomId: string,
    input: UploadMeetingSourceInput,
  ): Promise<ActionResult<MeetingSource>> {
    if (!this.versions.has(roomId)) await this.getRoom(roomId);
    const accessToken = await this.ensureAnonymousSession();
    const body = new FormData();
    body.append("file", input.file);
    body.append("visibility", input.visibility);
    if (input.title?.trim()) body.append("title", input.title.trim());

    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/sources`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "If-Match": String(this.versions.get(roomId) ?? 0),
      },
      body,
    });
    const parsed = actionResultSchema(meetingSourceSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error(`Room source upload failed with HTTP ${response.status}.`);
    const result = parsed.data as ActionResult<MeetingSource>;
    this.versions.set(roomId, result.roomVersion);
    if (result.ok || result.error.code === "STALE_ROOM_STATE") await this.refresh(roomId);
    return result;
  }

  readMeetingSourceContent(
    roomId: string,
    input: ReadMeetingSourceContentInput,
  ): Promise<ActionResult<MeetingSourceContent>> {
    return this.readAction(
      roomId,
      `sources/${encodeURIComponent(input.sourceId)}/content?cursor=${encodeURIComponent(input.cursor ?? "")}&maxChunks=${input.maxChunks}`,
      meetingSourceContentSchema,
    );
  }

  searchMeetingSources(
    roomId: string,
    input: SearchMeetingSourcesInput,
  ): Promise<ActionResult<MeetingSourceSearchResults>> {
    return this.mutateWithData(
      roomId,
      "sources/search",
      input,
      meetingSourceSearchResultsSchema,
    );
  }

  markMeetingSourceProcessed(
    roomId: string,
    input: MarkMeetingSourceProcessedInput,
  ): Promise<ActionResult<MeetingSource>> {
    return this.mutateWithData(
      roomId,
      `sources/${encodeURIComponent(input.sourceId)}/process`,
      { chunks: input.chunks, summary: input.summary },
      meetingSourceSchema,
    );
  }

  markMeetingSourceFailed(
    roomId: string,
    input: MarkMeetingSourceFailedInput,
  ): Promise<ActionResult<MeetingSource>> {
    return this.mutateWithData(
      roomId,
      `sources/${encodeURIComponent(input.sourceId)}/fail`,
      { errorMessage: input.errorMessage },
      meetingSourceSchema,
    );
  }

  /**
   * Re-run text extraction on a `failed` (or still-`processing`) source from a
   * file the human re-selects, then finish it. Keeps the same source row so
   * its citations and audit history survive the retry.
   */
  async retryMeetingSource(
    roomId: string,
    sourceId: string,
    file: File,
  ): Promise<ActionResult<MeetingSource>> {
    if (!this.versions.has(roomId)) await this.getRoom(roomId);
    const accessToken = await this.ensureAnonymousSession();
    const body = new FormData();
    body.append("file", file);
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(roomId)}/sources/${encodeURIComponent(sourceId)}/process`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "If-Match": String(this.versions.get(roomId) ?? 0),
        },
        body,
      },
    );
    const parsed = actionResultSchema(meetingSourceSchema).safeParse(await response.json());
    if (!parsed.success) throw new Error(`Room source retry failed with HTTP ${response.status}.`);
    const result = parsed.data as ActionResult<MeetingSource>;
    this.versions.set(roomId, result.roomVersion);
    if (result.ok || result.error.code === "STALE_ROOM_STATE") await this.refresh(roomId);
    return result;
  }

  shareMeetingSource(roomId: string, sourceId: string): Promise<ActionResult<MeetingSource>> {
    return this.mutateWithData(roomId, `sources/${encodeURIComponent(sourceId)}/share`, {}, meetingSourceSchema);
  }

  removeMeetingSource(roomId: string, sourceId: string): Promise<ActionResult> {
    return this.deleteMutation(roomId, `sources/${encodeURIComponent(sourceId)}`);
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

  async removeParticipant(roomId: string, input: RemoveParticipantInput): Promise<ActionResult> {
    const result = await this.mutate(roomId, "participants/remove", input);
    if (result.ok) {
      void this.channels.get(roomId)?.send({
        type: "broadcast",
        event: "room_changed",
        payload: {},
      });
    }
    return result;
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

  private async deleteMutation(
    roomId: string,
    action: string,
  ): Promise<ActionResult> {
    if (!this.versions.has(roomId)) await this.getRoom(roomId);
    const accessToken = await this.ensureAnonymousSession();
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${action}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "If-Match": String(this.versions.get(roomId) ?? 0),
      },
    });
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
      this.subscribers.get(roomId)?.forEach(({ callback }) => callback(state));
    } catch (error) {
      if (error instanceof RoomLoadError && TERMINAL_ROOM_STATUSES.has(error.status)) {
        this.versions.delete(roomId);
        this.stopRealtime(roomId);
        this.subscribers.get(roomId)?.forEach(({ onUnavailable }) => onUnavailable?.());
        return;
      }
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
          "broadcast",
          { event: "room_changed" },
          () => void this.refresh(roomId),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
          () => void this.refresh(roomId),
        );
      this.channels.set(roomId, channel);
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED" || this.channels.get(roomId) !== channel) return;
        void this.refresh(roomId);
      });
    } finally {
      this.startingChannels.delete(roomId);
    }
  }

  private stopRealtime(roomId: string) {
    const channel = this.channels.get(roomId);
    this.channels.delete(roomId);
    if (channel) void this.supabase.removeChannel(channel);
  }
}
