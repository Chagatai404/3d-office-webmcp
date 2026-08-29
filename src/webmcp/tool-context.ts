"use client";

import type { RoomState } from "@/contracts/room";
import {
  getFinalDecisionRecord,
  getMeetingContext,
  previewFinalDecision,
} from "@/domain/rooms/operations";
import { getOpenIssues } from "@/domain/rooms/queries";
import type { MutationContext } from "@/domain/rooms/repository";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

export class RoomWebMcpContext {
  readonly repository: SupabaseRoomRepository;

  constructor(
    readonly roomId: string,
    private readonly observedRoom: () => RoomState | null,
  ) {
    this.repository = new SupabaseRoomRepository(createBrowserSupabaseClient());
  }

  async getRoom(): Promise<RoomState> {
    const actorUserId = await this.getActorUserId();
    const room = await getMeetingContext(this.repository, actorUserId, this.roomId);
    if (!room) throw new Error("Room not found or not available to this session.");
    return room;
  }

  async getOpenIssues() {
    return getOpenIssues(this.repository, await this.getActorUserId(), this.roomId);
  }

  async previewFinalDecision() {
    return previewFinalDecision(
      this.repository,
      await this.getActorUserId(),
      this.roomId,
    );
  }

  async getDecisionRecord() {
    return getFinalDecisionRecord(
      this.repository,
      await this.getActorUserId(),
      this.roomId,
    );
  }

  async mutationContext(): Promise<MutationContext> {
    const actorUserId = await this.getActorUserId();
    const observed = this.observedRoom();
    const roomVersion = observed?.version ?? (await this.getRoom()).version;
    return {
      actor: { authUserId: actorUserId, origin: "webmcp" },
      expectedRoomVersion: roomVersion,
    };
  }

  getObservedRoomVersion() {
    return this.observedRoom()?.version ?? 0;
  }

  /**
   * The seat this browser session has claimed, read from the snapshot the
   * provider is already showing. `null` means the session is not a member of
   * the room, which is what gates every participant mutation tool. The server
   * derives the same seat from `auth.uid()`; this only stops a stale tool
   * reference from reaching the domain at all.
   */
  getObservedSelfParticipantId(): string | null {
    return this.observedRoom()?.selfParticipantId ?? null;
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
