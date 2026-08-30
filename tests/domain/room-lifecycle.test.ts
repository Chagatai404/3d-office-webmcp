import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  advanceDemoRoomPhase,
  advanceRoomPhase,
  castParticipantVote,
  createRoom,
  getMeetingContext,
  markMyInputReady,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { RoomState } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Auth failed.");
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

describe.sequential("owner-only lifecycle compatibility", () => {
  let owner: Actor;
  let outsider: Actor;
  let roomId = "";
  let proposalId = "";

  beforeAll(async () => {
    [owner, outsider] = await Promise.all([actor(), actor()]);
    const created = await createRoom(
      owner.repository,
      {
        title: "Owner lifecycle",
        brief: "Exercise the legacy phases without creating participant seats.",
        creatorName: "Maya",
        creatorRole: "Founder",
      },
      { actor: actorOf(owner) },
    );
    if (!created.ok) throw new Error(created.error.message);
    roomId = created.data.roomId;
  });

  it("does not let an unaffiliated session mutate the room", async () => {
    const result = await outsider.repository.advanceRoomPhase(
      roomId,
      "proposals",
      ctx(outsider, 0),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("requires the owner to publish input before becoming ready", async () => {
    expect(
      await markMyInputReady(owner.repository, roomId, ctx(owner, 0)),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const position = await addParticipantPosition(
      owner.repository,
      roomId,
      { summary: "Ship a reduced scope.", category: "scope", priority: "high", constraints: [] },
      ctx(owner, 0),
    );
    expect(position.ok).toBe(true);
    const ready = await markMyInputReady(
      owner.repository,
      roomId,
      ctx(owner, position.roomVersion),
    );
    expect(ready.ok).toBe(true);
    expect((await snapshot(owner, roomId)).participants).toEqual([
      expect.objectContaining({ meetingRole: "owner", isReady: true }),
    ]);
  });

  it("keeps phase order and demo controls isolated", async () => {
    const room = await snapshot(owner, roomId);
    expect(
      await advanceRoomPhase(owner.repository, roomId, "voting", ctx(owner, room.version)),
    ).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    expect(
      await advanceDemoRoomPhase(owner.repository, roomId, "proposals", ctx(owner, room.version)),
    ).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("lets the sole owner progress through the retained legacy decision phases", async () => {
    let room = await snapshot(owner, roomId);
    expect((await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, room.version))).ok)
      .toBe(true);

    room = await snapshot(owner, roomId);
    const proposal = await submitParticipantProposal(
      owner.repository,
      roomId,
      {
        title: "Reduced scope",
        summary: "Ship the smallest complete onboarding scope.",
        rationale: "It fits the deadline.",
        expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [],
        parentProposalId: null,
      },
      ctx(owner, room.version),
    );
    expect(proposal.ok).toBe(true);

    room = await snapshot(owner, roomId);
    proposalId = room.activeProposalId!;
    expect((await advanceRoomPhase(owner.repository, roomId, "deliberation", ctx(owner, room.version))).ok)
      .toBe(true);
    room = await snapshot(owner, roomId);
    expect((await advanceRoomPhase(owner.repository, roomId, "voting", ctx(owner, room.version))).ok)
      .toBe(true);

    room = await snapshot(owner, roomId);
    expect((await castParticipantVote(
      owner.repository,
      roomId,
      { proposalId, choice: "support", comment: null },
      ctx(owner, room.version),
    )).ok).toBe(true);

    room = await snapshot(owner, roomId);
    expect((await advanceRoomPhase(owner.repository, roomId, "approval", ctx(owner, room.version))).ok)
      .toBe(true);
    room = await snapshot(owner, roomId);
    expect(room.phase).toBe("approval");
    expect(room.finalDecisionPreview?.missingApprovalParticipantIds).toEqual([
      room.ownerParticipantId,
    ]);
  });
});
