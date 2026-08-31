import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  approveParticipantFinalDecision,
  createRoom,
  expressMyAlignment,
  getFinalDecisionRecord,
  getMeetingContext,
  markMyInputReady,
  raiseParticipantObjection,
  requestJoinByInvite,
  resolveParticipantObjection,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import { computeMeetingReport } from "@/domain/rooms/report";
import type { CreateRoomInput } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A8: `computeMeetingReport` against a real, finalized Postgres-backed
 * room -- not just the fixture-level unit tests in
 * tests/webmcp/report.test.ts. Proves the report cannot be produced before
 * finalization, includes dissent and approvals/authority correctly, and
 * -- the A8 exit gate -- is byte-for-byte identical whichever finalized
 * participant computes it.
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
  title: "Meeting report end-to-end",
  brief: "Prove the canonical final report against a real finalized room.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("A8: computeMeetingReport against a real finalized room", () => {
  let owner: Actor;
  let maya: Actor;
  let roomId = "";

  beforeAll(async () => {
    [owner, maya] = await Promise.all([actor(), actor()]);

    const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
    if (!created.ok) throw new Error(created.error.message);
    roomId = created.data.roomId;

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

    // A concern that gets raised and resolved, so the report's
    // resolvedConcerns and concernsRaised are both provably non-trivial.
    const concern = await raiseParticipantObjection(
      maya.repository, roomId,
      { proposalId, constraintId: null, reason: "Needs a rollback plan.", severity: "warning" },
      ctx(maya, toDeliberation.roomVersion),
    );
    if (!concern.ok) throw new Error(concern.error.message);
    const roomWithConcern = await getMeetingContext(owner.repository, owner.userId, roomId);
    const conflictId = roomWithConcern!.conflicts[0]!.id;
    const resolved = await resolveParticipantObjection(
      maya.repository, roomId,
      { conflictId, resolutionNote: "Rollback plan documented separately." },
      ctx(maya, concern.roomVersion),
    );
    if (!resolved.ok) throw new Error(resolved.error.message);

    const toVoting = await advanceRoomPhase(owner.repository, roomId, "voting", ctx(owner, resolved.roomVersion));
    if (!toVoting.ok) throw new Error(toVoting.error.message);

    // Maya's own dissent: a concern alignment choice, so the frozen
    // candidate's deterministic `dissent` array is non-empty.
    const mayaAlignment = await expressMyAlignment(
      maya.repository, roomId,
      { proposalId, choice: "concern", comment: "Still slightly worried about the timeline." },
      ctx(maya, toVoting.roomVersion),
    );
    if (!mayaAlignment.ok) throw new Error(mayaAlignment.error.message);
    const ownerAlignment = await expressMyAlignment(
      owner.repository, roomId,
      { proposalId, choice: "support", comment: null },
      ctx(owner, mayaAlignment.roomVersion),
    );
    if (!ownerAlignment.ok) throw new Error(ownerAlignment.error.message);

    const toApproval = await advanceRoomPhase(owner.repository, roomId, "approval", ctx(owner, ownerAlignment.roomVersion));
    if (!toApproval.ok) throw new Error(toApproval.error.message);
    const preview = await getMeetingContext(owner.repository, owner.userId, roomId);
    const decisionHash = preview!.finalDecisionPreview!.decisionHash;

    const approval = await approveParticipantFinalDecision(
      owner.repository, roomId, { decisionHash },
      { ...ctx(owner, toApproval.roomVersion), humanConfirmed: true },
    );
    if (!approval.ok) throw new Error(approval.error.message);
  });

  it("refuses to compute a report before finalization -- the record itself is unavailable, so there is nothing to build a report from", async () => {
    const notYetFinalized = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
    if (!notYetFinalized.ok) throw new Error(notYetFinalized.error.message);
    const record = await getFinalDecisionRecord(owner.repository, owner.userId, notYetFinalized.data.roomId);
    expect(record).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
  });

  it("includes dissent, approvals/authority, and resolved concerns once finalized", async () => {
    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    const record = await getFinalDecisionRecord(owner.repository, owner.userId, roomId);
    if (!record.ok) throw new Error("Expected a finalized decision record.");
    const report = computeMeetingReport(room!, record.data);

    expect(report.dissent.length).toBeGreaterThan(0);
    expect(report.requiredApprovalParticipantIds).toEqual([room!.ownerParticipantId]);
    expect(report.approvals.map((a) => a.participantId)).toEqual([room!.ownerParticipantId]);
    expect(report.resolvedConcerns).toHaveLength(1);
    expect(report.resolvedConcerns[0]!.resolutionNote).toBe("Rollback plan documented separately.");
    expect(report.concernsRaised.length).toBeGreaterThanOrEqual(1);
    expect(report.decisionHash).toBe(record.data.decision.decisionHash);
  });

  it("is byte-for-byte identical whichever finalized participant computes it", async () => {
    const [ownerRoom, mayaRoom] = await Promise.all([
      getMeetingContext(owner.repository, owner.userId, roomId),
      getMeetingContext(maya.repository, maya.userId, roomId),
    ]);
    const [ownerRecord, mayaRecord] = await Promise.all([
      getFinalDecisionRecord(owner.repository, owner.userId, roomId),
      getFinalDecisionRecord(maya.repository, maya.userId, roomId),
    ]);
    if (!ownerRecord.ok || !mayaRecord.ok) throw new Error("Expected both to read the finalized record.");

    const ownerReport = computeMeetingReport(ownerRoom!, ownerRecord.data);
    const mayaReport = computeMeetingReport(mayaRoom!, mayaRecord.data);
    expect(ownerReport).toEqual(mayaReport);
    expect(ownerReport.decisionHash).toBe(mayaReport.decisionHash);
  });
});
