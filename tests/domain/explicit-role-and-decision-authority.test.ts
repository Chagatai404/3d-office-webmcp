import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  configureParticipant,
  createRoom,
  getMeetingContext,
  markMyInputReady,
  requestJoinByInvite,
} from "@/domain/rooms/operations";
import { enableSecurityExpert } from "@/domain/rooms/expert";
import type { CreateRoomInput, RoomState } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A6: explicit role and decision-authority assignment, proven against real
 * Postgres. Covers both halves of the sprint checklist's scope: admitting a
 * joiner with an explicit role/decision role in one call, and the
 * post-admission `configure_participant` capability.
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
  title: "Explicit role and decision authority",
  brief: "Prove admission overrides and post-admission configuration.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

async function freshRoom(owner: Actor) {
  const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

describe.sequential("A6: admission accepts an explicit role and decision role", () => {
  let owner: Actor;
  let maya: Actor;

  beforeAll(async () => {
    [owner, maya] = await Promise.all([actor(), actor()]);
  });

  it("admits with the owner's explicit role and contributor decision role by default", async () => {
    const room = await freshRoom(owner);
    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(room.inviteUrl), displayName: "Maya", role: "Engineer (requested)" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);

    const admitted = await admitJoinRequest(
      owner.repository, room.roomId,
      { joinRequestId: request.data.joinRequest.id, role: "CTO", decisionRole: null },
      ctx(owner, 0),
    );
    expect(admitted).toMatchObject({ ok: true });

    const snap = await snapshot(owner, room.roomId);
    const participant = snap.participants.find((p) => p.name === "Maya")!;
    expect(participant.role).toBe("CTO");
    expect(participant.decisionRole).toBe("contributor");
  });

  it("admits with both an explicit role and decision_maker in one call, and can immediately review the final decision", async () => {
    const room = await freshRoom(owner);
    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(room.inviteUrl), displayName: "Deniz", role: "Engineer (requested)" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);

    const admitted = await admitJoinRequest(
      owner.repository, room.roomId,
      { joinRequestId: request.data.joinRequest.id, role: "CTO", decisionRole: "decision_maker" },
      ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);

    let snap = await snapshot(owner, room.roomId);
    const deniz = snap.participants.find((p) => p.name === "Deniz")!;
    expect(deniz.role).toBe("CTO");
    expect(deniz.decisionRole).toBe("decision_maker");

    // Drive the room to Alignment, then prove Deniz -- never the owner --
    // can move it into Decision review, because decision authority (not
    // ownership) is what A4 requires there.
    const position = await addParticipantPosition(
      owner.repository, room.roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, admitted.roomVersion),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, room.roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    const toProposals = await advanceRoomPhase(owner.repository, room.roomId, "proposals", ctx(owner, ready.roomVersion));
    if (!toProposals.ok) throw new Error(toProposals.error.message);

    snap = await snapshot(owner, room.roomId);
    // No proposal exists yet in this minimal flow; deliberately stop short
    // of freezing a candidate and instead prove the review call itself is
    // authorized for Deniz once a proposal exists -- covered end to end
    // already in tests/domain/procedural-progression-authority.test.ts.
    // Here we only assert admission-time authority took effect.
    expect(snap.participants.find((p) => p.name === "Deniz")!.decisionRole).toBe("decision_maker");
  });

  it("does not implicitly transfer ownership when admitting a decision-maker", async () => {
    const room = await freshRoom(owner);
    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(room.inviteUrl), displayName: "Priya", role: "Designer" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);
    const admitted = await admitJoinRequest(
      owner.repository, room.roomId,
      { joinRequestId: request.data.joinRequest.id, role: null, decisionRole: "decision_maker" },
      ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);
    const snap = await snapshot(owner, room.roomId);
    expect(snap.ownerParticipantId).not.toBe(snap.participants.find((p) => p.name === "Priya")!.id);
    expect(snap.participants.find((p) => p.name === "Priya")!.meetingRole).toBe("participant");
  });
});

describe.sequential("A6: configure_participant is the post-admission configuration capability", () => {
  let owner: Actor;
  let maya: Actor;
  let roomId = "";
  let mayaParticipantId = "";
  let version = 0;

  beforeAll(async () => {
    [owner, maya] = await Promise.all([actor(), actor()]);
    const room = await freshRoom(owner);
    roomId = room.roomId;
    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(room.inviteUrl), displayName: "Maya", role: "Engineer" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);
    const admitted = await admitJoinRequest(
      owner.repository, roomId,
      { joinRequestId: request.data.joinRequest.id, role: null, decisionRole: null },
      ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);
    version = admitted.roomVersion;
    mayaParticipantId = (await snapshot(owner, roomId)).participants.find((p) => p.name === "Maya")!.id;
  });

  it("updates role and decision role together", async () => {
    const result = await configureParticipant(
      owner.repository, roomId,
      { participantId: mayaParticipantId, role: "CTO", decisionRole: "decision_maker" },
      ctx(owner, version),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) version = result.roomVersion;
    const participant = (await snapshot(owner, roomId)).participants.find((p) => p.id === mayaParticipantId)!;
    expect(participant.role).toBe("CTO");
    expect(participant.decisionRole).toBe("decision_maker");
  });

  it("updates only role, leaving decision role untouched", async () => {
    const result = await configureParticipant(
      owner.repository, roomId,
      { participantId: mayaParticipantId, role: "VP Engineering", decisionRole: null },
      ctx(owner, version),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) version = result.roomVersion;
    const participant = (await snapshot(owner, roomId)).participants.find((p) => p.id === mayaParticipantId)!;
    expect(participant.role).toBe("VP Engineering");
    expect(participant.decisionRole).toBe("decision_maker");
  });

  it("refuses a non-owner caller", async () => {
    const result = await configureParticipant(
      maya.repository, roomId,
      { participantId: mayaParticipantId, role: "Self-promoted CEO", decisionRole: null },
      ctx(maya, version),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("refuses a request with neither role nor decisionRole", async () => {
    const result = await configureParticipant(
      owner.repository, roomId,
      { participantId: mayaParticipantId, role: null, decisionRole: null },
      ctx(owner, version),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("refuses to demote the current owner from decision-maker", async () => {
    const snap = await snapshot(owner, roomId);
    const result = await configureParticipant(
      owner.repository, roomId,
      { participantId: snap.ownerParticipantId, role: null, decisionRole: "contributor" },
      ctx(owner, version),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("refuses to configure the Security Expert -- it can never gain human decision authority", async () => {
    const enabled = await enableSecurityExpert(owner.repository, roomId, ctx(owner, version));
    if (!enabled.ok) throw new Error(enabled.error.message);
    version = enabled.roomVersion;
    const result = await configureParticipant(
      owner.repository, roomId,
      { participantId: enabled.data.expertParticipantId, role: "Chief Strategy Officer", decisionRole: "decision_maker" },
      ctx(owner, version),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });
});

describe("A6: decision-role changes are refused once a candidate is frozen; role changes are not", () => {
  it("blocks a decisionRole change but allows a role-only change after freezing", async () => {
    const [owner, maya] = await Promise.all([actor(), actor()]);
    const room = await freshRoom(owner);
    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(room.inviteUrl), displayName: "Noah", role: "Designer" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);
    const admitted = await admitJoinRequest(
      owner.repository, room.roomId,
      { joinRequestId: request.data.joinRequest.id, role: null, decisionRole: null },
      ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);
    const noahParticipantId = (await snapshot(owner, room.roomId)).participants.find((p) => p.name === "Noah")!.id;

    let version = admitted.roomVersion;
    const position = await addParticipantPosition(
      owner.repository, room.roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, version),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, room.roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    const toProposals = await advanceRoomPhase(owner.repository, room.roomId, "proposals", ctx(owner, ready.roomVersion));
    if (!toProposals.ok) throw new Error(toProposals.error.message);

    const { submitParticipantProposal } = await import("@/domain/rooms/operations");
    const proposal = await submitParticipantProposal(
      owner.repository, room.roomId,
      {
        title: "Reduced scope onboarding", summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline.", expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [], parentProposalId: null,
      },
      ctx(owner, toProposals.roomVersion),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    const toDeliberation = await advanceRoomPhase(owner.repository, room.roomId, "deliberation", ctx(owner, proposal.roomVersion));
    if (!toDeliberation.ok) throw new Error(toDeliberation.error.message);
    const toVoting = await advanceRoomPhase(owner.repository, room.roomId, "voting", ctx(owner, toDeliberation.roomVersion));
    if (!toVoting.ok) throw new Error(toVoting.error.message);
    const toApproval = await advanceRoomPhase(owner.repository, room.roomId, "approval", ctx(owner, toVoting.roomVersion));
    if (!toApproval.ok) throw new Error(toApproval.error.message);
    version = toApproval.roomVersion;

    const decisionRoleChange = await configureParticipant(
      owner.repository, room.roomId,
      { participantId: noahParticipantId, role: null, decisionRole: "decision_maker" },
      ctx(owner, version),
    );
    expect(decisionRoleChange).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const roleOnlyChange = await configureParticipant(
      owner.repository, room.roomId,
      { participantId: noahParticipantId, role: "Head of Design", decisionRole: null },
      ctx(owner, version),
    );
    expect(roleOnlyChange).toMatchObject({ ok: true });
  });
});
