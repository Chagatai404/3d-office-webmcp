import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  createRoom,
  getMeetingContext,
  markMyInputReady,
  raiseParticipantObjection,
  requestJoinByInvite,
  resolveConcernAsOwner,
  setDecisionPolicy,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * `resolve_concern_as_owner` is the deliberate escape hatch for a concern
 * its raiser cannot or will not close themselves (a simulated colleague
 * with no response mechanism, a participant who has left). Unlike
 * `resolveParticipantObjection` -- which the underlying room already lets
 * any active participant call on any open concern -- this operation adds
 * its own authority gate: only the current room owner, and only while
 * `owner_decides` actually makes that a singular authority. Proven against
 * real Postgres, following tests/domain/meeting-report.test.ts's
 * fresh-room-per-file pattern so this never touches the shared "demo" room.
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

function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

const roomInput: CreateRoomInput = {
  title: "Owner override of another participant's concern",
  brief: "Prove the deliberate escape hatch for a concern its raiser cannot close.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("resolve_concern_as_owner: the owner's deliberate override", () => {
  let owner: Actor;
  let maya: Actor;

  beforeAll(async () => {
    [owner, maya] = await Promise.all([actor(), actor()]);
  });

  /** Fresh room, Maya admitted, driven to Deliberation with an active proposal and one of Maya's open concerns. */
  async function roomWithMayasOpenConcern() {
    const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
    if (!created.ok) throw new Error(created.error.message);
    const roomId = created.data.roomId;

    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Maya", role: "Engineer" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);
    const admitted = await admitJoinRequest(
      owner.repository, roomId,
      { joinRequestId: request.data.joinRequest.id, role: null, decisionRole: null },
      ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);

    const position = await addParticipantPosition(
      owner.repository, roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, admitted.roomVersion),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    const toProposals = await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, ready.roomVersion));
    if (!toProposals.ok) throw new Error(toProposals.error.message);

    const proposal = await submitParticipantProposal(
      owner.repository, roomId,
      {
        title: "Reduced scope onboarding", summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline without an authentication rewrite.",
        expectedOutcomes: ["Launch on time"], referencedConstraintIds: [], parentProposalId: null,
      },
      ctx(owner, toProposals.roomVersion),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    const proposalId = room!.activeProposalId!;

    const toDeliberation = await advanceRoomPhase(owner.repository, roomId, "deliberation", ctx(owner, proposal.roomVersion));
    if (!toDeliberation.ok) throw new Error(toDeliberation.error.message);

    const concern = await raiseParticipantObjection(
      maya.repository, roomId,
      { proposalId, constraintId: null, reason: "This scope requires auth work beyond available capacity.", severity: "blocking" },
      ctx(maya, toDeliberation.roomVersion),
    );
    if (!concern.ok) throw new Error(concern.error.message);
    const roomWithConcern = await getMeetingContext(owner.repository, owner.userId, roomId);
    const conflictId = roomWithConcern!.conflicts[0]!.id;

    return { roomId, conflictId, version: concern.roomVersion };
  }

  it("lets the owner explicitly resolve a concern Maya raised, under owner_decides", async () => {
    const { roomId, conflictId, version } = await roomWithMayasOpenConcern();

    const resolved = await resolveConcernAsOwner(
      owner.repository, roomId,
      { conflictId, resolutionNote: "Descoping the auth work; capacity constraint resolved by scope cut." },
      ctx(owner, version),
    );
    expect(resolved.ok).toBe(true);

    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    const conflict = room!.conflicts.find((candidate) => candidate.id === conflictId)!;
    expect(conflict.status).toBe("resolved");
    expect(conflict.raisedByActorId).not.toBe(conflict.resolvedByActorId);
    expect(conflict.resolvedByActorId).toBe(room!.selfParticipantId);
  });

  it("refuses the override from Maya -- she is not the room owner", async () => {
    const { roomId, conflictId, version } = await roomWithMayasOpenConcern();

    const attempt = await resolveConcernAsOwner(
      maya.repository, roomId,
      { conflictId, resolutionNote: "Maya trying to grant herself the owner's override." },
      ctx(maya, version),
    );
    expect(attempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    expect(room!.conflicts.find((candidate) => candidate.id === conflictId)!.status).toBe("open");
  });

  it("refuses the override under equal_authority_consensus -- no single participant holds that authority there", async () => {
    const { roomId, conflictId, version } = await roomWithMayasOpenConcern();

    const policy = await setDecisionPolicy(
      owner.repository, roomId, { decisionPolicy: "equal_authority_consensus" }, ctx(owner, version),
    );
    if (!policy.ok) throw new Error(policy.error.message);

    const attempt = await resolveConcernAsOwner(
      owner.repository, roomId,
      { conflictId, resolutionNote: "Owner trying to override under consensus." },
      ctx(owner, policy.roomVersion),
    );
    expect(attempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    expect(room!.conflicts.find((candidate) => candidate.id === conflictId)!.status).toBe("open");
  });
});
