import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  createRoom,
  getMeetingContext,
  markMyInputReady,
  requestJoinByInvite,
  setParticipantDecisionRole,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { CreateRoomInput, RoomState } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A4: "meeting administration != meeting progression != decision authority."
 * Proves the new `advance_room_phase` authority model
 * (`supabase/migrations/20260831120000_procedural_progression_authority.sql`)
 * against real Postgres: procedural progression (Input -> Proposals ->
 * Deliberation -> Alignment) is open to any active claimed human, while
 * entering Decision review requires decision authority (`decision_maker`),
 * not meeting ownership. See tests/domain/alignment-and-decision.test.ts for
 * the shared actor/room-scaffolding pattern this file follows.
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

function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

const roomInput: CreateRoomInput = {
  title: "Procedural progression authority",
  brief: "Prove non-owner procedural progression and decision-authority-gated review.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

/** Creates a room and admits one contributor (not owner, not decision-maker by default). */
async function createRoomWithContributor(owner: Actor, contributor: Actor) {
  const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
  if (!created.ok) throw new Error(created.error.message);

  const request = await requestJoinByInvite(
    contributor.repository,
    { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Maya", role: "Engineer" },
    actorOf(contributor),
  );
  if (!request.ok) throw new Error(request.error.message);
  const admitted = await admitJoinRequest(
    owner.repository, created.data.roomId,
    { joinRequestId: request.data.joinRequest.id },
    ctx(owner, 0),
  );
  if (!admitted.ok) throw new Error(admitted.error.message);

  const room = await snapshot(owner, created.data.roomId);
  const contributorParticipantId = room.participants.find((p) => p.name === "Maya")!.id;
  expect(room.participants.find((p) => p.id === contributorParticipantId)!.decisionRole).toBe("contributor");
  return { roomId: created.data.roomId, contributorParticipantId, version: room.version };
}

describe.sequential("A4: procedural progression is open to any active human", () => {
  let owner: Actor;
  let maya: Actor;
  let roomId = "";
  let mayaParticipantId = "";
  let version = 0;

  beforeAll(async () => {
    [owner, maya] = await Promise.all([actor(), actor()]);
    const room = await createRoomWithContributor(owner, maya);
    roomId = room.roomId;
    mayaParticipantId = room.contributorParticipantId;
    version = room.version;

    const position = await addParticipantPosition(
      owner.repository, roomId,
      { summary: "Ship a reduced onboarding scope on time.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, version),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    version = ready.roomVersion;
  });

  it("lets a non-owner contributor advance Input -> Proposals", async () => {
    const result = await advanceRoomPhase(maya.repository, roomId, "proposals", ctx(maya, version));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) version = result.roomVersion;
    expect((await snapshot(owner, roomId)).phase).toBe("proposals");
  });

  it("attributes the phase-advance audit event to the calling contributor, not the owner", async () => {
    const room = await snapshot(owner, roomId);
    const event = room.activity.find((e) => e.action === "room.phase_advanced" && e.resultingRoomVersion === version);
    expect(event).toBeDefined();
    expect(event!.actorId).toBe(mayaParticipantId);
  });

  it("lets the same non-owner contributor advance Proposals -> Deliberation", async () => {
    const proposal = await submitParticipantProposal(
      maya.repository, roomId,
      {
        title: "Reduced scope onboarding",
        summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline without an authentication rewrite.",
        expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [],
        parentProposalId: null,
      },
      ctx(maya, version),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    version = proposal.roomVersion;

    const result = await advanceRoomPhase(maya.repository, roomId, "deliberation", ctx(maya, version));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) version = result.roomVersion;
    expect((await snapshot(owner, roomId)).phase).toBe("deliberation");
  });

  it("lets the same non-owner contributor advance Deliberation -> Alignment", async () => {
    const result = await advanceRoomPhase(maya.repository, roomId, "voting", ctx(maya, version));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) version = result.roomVersion;
    expect((await snapshot(owner, roomId)).phase).toBe("voting");
  });

  it("refuses a contributor (no decision authority) entering Decision review", async () => {
    const result = await advanceRoomPhase(maya.repository, roomId, "approval", ctx(maya, version));
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
    });
    expect((await snapshot(owner, roomId)).phase).toBe("voting");
  });

  it("allows the same participant to enter Decision review once promoted to decision-maker", async () => {
    const promoted = await setParticipantDecisionRole(
      owner.repository, roomId,
      { participantId: mayaParticipantId, decisionRole: "decision_maker" },
      ctx(owner, version),
    );
    if (!promoted.ok) throw new Error(promoted.error.message);
    version = promoted.roomVersion;

    const result = await advanceRoomPhase(maya.repository, roomId, "approval", ctx(maya, version));
    expect(result).toMatchObject({ ok: true });
    expect((await snapshot(owner, roomId)).phase).toBe("approval");
  });
});

describe("A4: canonical prerequisites still gate progression regardless of caller", () => {
  it("refuses Proposals -> Deliberation without an active proposal even for a legitimate caller", async () => {
    const [owner, maya] = await Promise.all([actor(), actor()]);
    const room = await createRoomWithContributor(owner, maya);

    const position = await addParticipantPosition(
      owner.repository, room.roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, room.version),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, room.roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    const toProposals = await advanceRoomPhase(maya.repository, room.roomId, "proposals", ctx(maya, ready.roomVersion));
    if (!toProposals.ok) throw new Error(toProposals.error.message);

    const result = await advanceRoomPhase(maya.repository, room.roomId, "deliberation", ctx(maya, toProposals.roomVersion));
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("still refuses an unaffiliated session, distinct from the decision-authority refusal", async () => {
    const [owner, maya, outsider] = await Promise.all([actor(), actor(), actor()]);
    const room = await createRoomWithContributor(owner, maya);
    // A room-level outsider can't read the room at all (RLS membership
    // check), so the domain operation's own `prepareMutation` pre-check
    // fails with "Room not found" before ever reaching the RPC -- distinct
    // from the SQL-level NOT_AUTHORIZED an admitted-but-unclaimed caller
    // would get. See tests/domain/room-lifecycle.test.ts's equivalent
    // repository-level check for the raw RPC's own refusal.
    const result = await advanceRoomPhase(outsider.repository, room.roomId, "proposals", ctx(outsider, room.version));
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});
