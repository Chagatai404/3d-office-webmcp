import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  advanceRoomPhase,
  createRoom,
  getMeetingContext,
  markMyInputReady,
} from "@/domain/rooms/operations";
import type { CreateRoomInput, RoomState } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A5: explicit waiting/recovery semantics. Proves `WAITING_FOR_PARTICIPANTS`
 * (`supabase/migrations/20260831130000_waiting_for_participants_semantics.sql`)
 * end to end against real Postgres, including that the new `details.
 * waitingParticipantIds` field survives the repository's Zod parse of the
 * raw RPC response (`actionResultSchema` in `src/contracts/room.ts`).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, repository: new SupabaseRoomRepository(client) };
}

type Actor = Awaited<ReturnType<typeof actor>>;
const actorOf = (session: Actor) => ({ authUserId: session.userId, origin: "manual_ui" as const });
const ctx = (session: Actor, expectedRoomVersion: number): MutationContext => ({
  actor: actorOf(session), expectedRoomVersion,
});

async function snapshot(session: Actor, roomId: string): Promise<RoomState> {
  const room = await getMeetingContext(session.repository, session.userId, roomId);
  if (!room) throw new Error("Room is not readable.");
  return room;
}

const roomInput: CreateRoomInput = {
  title: "Waiting-for-participants semantics",
  brief: "Prove the WAITING_FOR_PARTICIPANTS refusal and its structured details.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("A5: WAITING_FOR_PARTICIPANTS carries who and why", () => {
  let owner: Actor;
  let roomId = "";
  let ownerParticipantId = "";
  let version = 0;

  beforeAll(async () => {
    owner = await actor();
    const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
    if (!created.ok) throw new Error(created.error.message);
    roomId = created.data.roomId;
    ownerParticipantId = created.data.ownerParticipantId;
    version = 0;
  });

  it("refuses to advance to Proposals before input is published, naming exactly who is pending", async () => {
    const result = await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, version));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "WAITING_FOR_PARTICIPANTS",
        message: "Every required participant must publish a position before proposals begin.",
        details: { waitingParticipantIds: [ownerParticipantId] },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("refuses to advance once positioned but still not ready, still naming who is pending", async () => {
    const position = await addParticipantPosition(
      owner.repository, roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, version),
    );
    if (!position.ok) throw new Error(position.error.message);
    version = position.roomVersion;

    const result = await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, version));
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "WAITING_FOR_PARTICIPANTS",
        message: "Every required participant must mark their input ready before proposals begin.",
        details: { waitingParticipantIds: [ownerParticipantId] },
      },
    });
  });

  it("advances once ready, with no leftover waiting-for-participants refusal", async () => {
    const ready = await markMyInputReady(owner.repository, roomId, ctx(owner, version));
    if (!ready.ok) throw new Error(ready.error.message);
    version = ready.roomVersion;

    const result = await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, version));
    expect(result).toMatchObject({ ok: true });
    expect((await snapshot(owner, roomId)).phase).toBe("proposals");
  });
});
