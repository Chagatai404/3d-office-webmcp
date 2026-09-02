import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  previewFinalDecision,
  removeParticipant,
  requestJoinByInvite,
  setDecisionPolicy,
  setParticipantDecisionRole,
  submitParticipantProposal,
  transferOwnership,
} from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * Proves the core Slice 4 product rule end to end against real Postgres:
 * "Agents deliberate. Humans intervene. Leaders decide." Alignment informs
 * the responsible decision authority; it never mechanically decides the
 * outcome. See tests/domain/owner-lifecycle.test.ts for the shared actor/
 * room-scaffolding pattern this file follows.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, client, repository: new SupabaseRoomRepository(client) };
}

type Actor = Awaited<ReturnType<typeof actor>>;

function mutation(userId: string, expectedRoomVersion: number) {
  return { actor: { authUserId: userId, origin: "manual_ui" as const }, expectedRoomVersion };
}

function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

const roomInput: CreateRoomInput = {
  title: "Alignment and decision-policy scenario",
  brief: "Should we ship the reduced-scope onboarding revision?",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("policy-aware alignment and finalization", () => {
  let owner: Actor;
  let alice: Actor;
  let bob: Actor;
  let admin: SupabaseClient;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    [owner, alice, bob] = await Promise.all([actor(), actor(), actor()]);
  });

  /**
   * Creates a fresh room with the same three actors (owner, alice, bob)
   * admitted every time. Each call creates a brand-new room id, so the three
   * actors can be reused as consistent, recognizable humans across many
   * independent rooms within this file -- exactly like
   * tests/domain/owner-lifecycle.test.ts's shared-actor pattern.
   */
  async function createRoomWithTwoParticipants() {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
      baseUrl: "https://app.example",
    });
    if (!created.ok) throw new Error(created.error.message);

    const aliceRequest = await requestJoinByInvite(
      alice.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Alice", role: "Engineer" },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    if (!aliceRequest.ok) throw new Error(aliceRequest.error.message);
    const aliceAdmitted = await admitJoinRequest(owner.repository, created.data.roomId, {
      joinRequestId: aliceRequest.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    if (!aliceAdmitted.ok) throw new Error(aliceAdmitted.error.message);

    const bobRequest = await requestJoinByInvite(
      bob.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Bob", role: "Designer" },
      { authUserId: bob.userId, origin: "manual_ui" },
    );
    if (!bobRequest.ok) throw new Error(bobRequest.error.message);
    const bobAdmitted = await admitJoinRequest(owner.repository, created.data.roomId, {
      joinRequestId: bobRequest.data.joinRequest.id,
    }, mutation(owner.userId, 1));
    if (!bobAdmitted.ok) throw new Error(bobAdmitted.error.message);

    const room = await getMeetingContext(owner.repository, owner.userId, created.data.roomId);
    if (!room) throw new Error("Room not readable after admission.");
    const aliceParticipantId = room.participants.find((p) => p.name === "Alice")!.id;
    const bobParticipantId = room.participants.find((p) => p.name === "Bob")!.id;

    return {
      ...created.data,
      aliceParticipantId,
      bobParticipantId,
      version: room.version,
    };
  }

  /** Drives an admitted-participants room from input through to a frozen proposal, ready for voting. */
  async function advanceToVoting(roomId: string, startVersion: number) {
    let version = startVersion;

    const position = await addParticipantPosition(
      owner.repository, roomId,
      { summary: "Ship a reduced onboarding scope on time.", category: "outcome", priority: "high", constraints: [] },
      mutation(owner.userId, version),
    );
    if (!position.ok) throw new Error(position.error.message);
    version = position.roomVersion;

    const ready = await markMyInputReady(owner.repository, roomId, mutation(owner.userId, version));
    if (!ready.ok) throw new Error(ready.error.message);
    version = ready.roomVersion;

    const toProposals = await advanceRoomPhase(owner.repository, roomId, "proposals", mutation(owner.userId, version));
    if (!toProposals.ok) throw new Error(toProposals.error.message);
    version = toProposals.roomVersion;

    const proposal = await submitParticipantProposal(
      owner.repository, roomId,
      {
        title: "Reduced scope onboarding",
        summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline without an authentication rewrite.",
        expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [],
        parentProposalId: null,
      },
      mutation(owner.userId, version),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    version = proposal.roomVersion;

    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    const proposalId = room!.activeProposalId!;

    const toDeliberation = await advanceRoomPhase(owner.repository, roomId, "deliberation", mutation(owner.userId, version));
    if (!toDeliberation.ok) throw new Error(toDeliberation.error.message);
    version = toDeliberation.roomVersion;

    const toVoting = await advanceRoomPhase(owner.repository, roomId, "voting", mutation(owner.userId, version));
    if (!toVoting.ok) throw new Error(toVoting.error.message);
    version = toVoting.roomVersion;

    return { proposalId, version };
  }

  describe("Alignment domain", () => {
    it("lets an active participant express alignment, and an update replaces the previous choice", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      const first = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "concern", comment: "Capacity is tight." },
        mutation(alice.userId, version),
      );
      expect(first).toMatchObject({ ok: true, roomVersion: version + 1 });

      const updated = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "support", comment: "Resolved after review." },
        mutation(alice.userId, version + 1),
      );
      expect(updated).toMatchObject({ ok: true, roomVersion: version + 2 });

      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      const aliceAlignments = room!.alignments.filter((a) => a.participantId === created.aliceParticipantId);
      expect(aliceAlignments).toHaveLength(1);
      expect(aliceAlignments[0]).toMatchObject({ choice: "support", comment: "Resolved after review." });

      const events = await admin.from("audit_events").select("action")
        .eq("room_id", created.roomId).like("action", "alignment.%");
      expect(events.data?.map((e) => e.action).sort()).toEqual(["alignment.expressed", "alignment.updated"]);
    });

    it("cannot align for another participant, and survives refetch", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      const result = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "support", comment: null,
          // @ts-expect-error -- the strict schema itself refuses this field
          participantId: created.bobParticipantId,
        },
        mutation(alice.userId, version),
      );
      expect(result.ok).toBe(false);

      const shared = await expressMyAlignment(
        bob.repository, created.roomId,
        { proposalId, choice: "strong_objection", comment: "This risks the launch date." },
        mutation(bob.userId, version),
      );
      expect(shared).toMatchObject({ ok: true, roomVersion: version + 1 });

      const refetched = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(refetched!.alignments).toContainEqual(
        expect.objectContaining({ participantId: created.bobParticipantId, choice: "strong_objection" }),
      );
    });

    it("rejects a removed participant, a cross-room proposal, and a stale room version", async () => {
      const created = await createRoomWithTwoParticipants();
      const otherRoom = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      const stale = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(alice.userId, version - 1),
      );
      expect(stale).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" } });

      const crossRoom = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId: otherRoom.roomId, choice: "support", comment: null },
        mutation(alice.userId, version),
      );
      expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const removed = await removeParticipant(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, version),
      );
      expect(removed.ok).toBe(true);
      const afterRemoval = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(alice.userId, removed.ok ? removed.roomVersion : 0),
      );
      expect(afterRemoval).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });

    it("never lets a simulated (non-human) participant use the human alignment path", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);
      const simulationId = `simulation-${created.roomId}`;
      await admin.from("participants").insert({
        id: simulationId, room_id: created.roomId, name: "Simulated Advisor", role: "Advisor",
        kind: "simulation", meeting_role: "participant", decision_role: "advisor",
        required_for_approval: false,
      } as never);

      // No auth session backs the simulation row (it has no user_id), so
      // there is no browser session that could ever call expressMyAlignment
      // "as" it -- every real actor's own auth.uid() resolves to their own
      // human participant row, never to the simulation's.
      const attempt = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, version),
      );
      // The owner's own alignment succeeds -- it is never attributed to the
      // simulation regardless of the simulation's presence in the room.
      expect(attempt.ok).toBe(true);
      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room!.alignments.some((a) => a.participantId === simulationId)).toBe(false);
    });
  });

  describe("owner_decides finalization", () => {
    it("Case A: preserves strong objections and concerns as dissent, and the owner alone finalizes", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      const aliceAlignment = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "strong_objection", comment: "We cannot safely ship this tracking scope." },
        mutation(alice.userId, version),
      );
      expect(aliceAlignment.ok).toBe(true);
      const bobAlignment = await expressMyAlignment(
        bob.repository, created.roomId,
        { proposalId, choice: "concern", comment: "Timeline is tight." },
        mutation(bob.userId, aliceAlignment.ok ? aliceAlignment.roomVersion : 0),
      );
      expect(bobAlignment.ok).toBe(true);
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, bobAlignment.ok ? bobAlignment.roomVersion : 0),
      );
      expect(ownerAlignment.ok).toBe(true);

      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      expect(toApproval.ok).toBe(true);

      const preview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!preview.ok) throw new Error(preview.error.message);
      expect(preview.data.decisionPolicy).toBe("owner_decides");
      expect(preview.data.requiredApprovalParticipantIds).toEqual([created.ownerParticipantId]);
      expect(preview.data.dissent.some((line) => line.includes("Strong objection"))).toBe(true);
      expect(preview.data.dissent.some((line) => line.includes("Concern"))).toBe(true);

      const requested = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: preview.data.decisionHash },
        mutation(owner.userId, toApproval.ok ? toApproval.roomVersion : 0),
      );
      expect(requested).toMatchObject({ ok: false, error: { code: "HUMAN_CONFIRMATION_REQUIRED" } });

      const approved = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(owner.userId, toApproval.ok ? toApproval.roomVersion : 0), humanConfirmed: true },
      );
      expect(approved.ok).toBe(true);

      const record = await getFinalDecisionRecord(owner.repository, owner.userId, created.roomId);
      if (!record.ok) throw new Error(record.error.message);
      expect(record.data.decision.dissent.length).toBeGreaterThan(0);
      expect(record.data.alignments.some((a) => a.choice === "strong_objection")).toBe(true);
    });

    it("Case B: the owner may proceed while alignment is incomplete; missing alignment is non-blocking", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      // Only the owner aligns; Alice and Bob never share alignment.
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, version),
      );
      expect(ownerAlignment.ok).toBe(true);

      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      expect(toApproval).toMatchObject({ ok: true });

      const preview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!preview.ok) throw new Error(preview.error.message);
      expect(preview.data.alignments).toHaveLength(1);

      const approved = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(owner.userId, toApproval.ok ? toApproval.roomVersion : 0), humanConfirmed: true },
      );
      expect(approved.ok).toBe(true);
      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room?.phase).toBe("finalized");
    });

    it("Case C: an unresolved blocking conflict prevents entering decision review", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);

      await admin.from("conflicts").insert({
        id: `blocking-${created.roomId}`, room_id: created.roomId, proposal_id: proposalId,
        constraint_id: null, raised_by_actor_type: "system", raised_by_actor_id: null,
        severity: "blocking", reason: "Injected blocking risk for this test.", status: "open",
      } as never);

      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval", mutation(owner.userId, version),
      );
      expect(toApproval).toMatchObject({ ok: false, error: { code: "UNRESOLVED_BLOCKING_CONFLICT" } });
    });

    it("Case D: a non-owner cannot confirm the final decision", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, version),
      );
      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);
      const preview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!preview.ok) throw new Error(preview.error.message);

      const attempt = await approveParticipantFinalDecision(
        alice.repository, created.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(alice.userId, toApproval.roomVersion), humanConfirmed: true },
      );
      expect(attempt).toMatchObject({
        ok: false,
        error: { code: "NOT_AUTHORIZED" },
      });
    });

    it("Case E: an approval bound to one hash can never finalize a changed candidate", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);
      const aliceAlignment = await expressMyAlignment(
        alice.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(alice.userId, version),
      );
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, aliceAlignment.ok ? aliceAlignment.roomVersion : 0),
      );
      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);

      const staleHashPreview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!staleHashPreview.ok) throw new Error(staleHashPreview.error.message);
      const staleHash = staleHashPreview.data.decisionHash;

      // Removing Alice materially changes the candidate's embedded alignment
      // and recomputes the hash, since the candidate is already frozen.
      const removed = await removeParticipant(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, toApproval.roomVersion),
      );
      expect(removed.ok).toBe(true);

      const staleApproval = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: staleHash },
        { ...mutation(owner.userId, removed.ok ? removed.roomVersion : 0), humanConfirmed: true },
      );
      expect(staleApproval).toMatchObject({ ok: false, error: { code: "DECISION_CHANGED" } });

      const freshPreview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!freshPreview.ok) throw new Error(freshPreview.error.message);
      expect(freshPreview.data.decisionHash).not.toBe(staleHash);
      const freshApproval = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: freshPreview.data.decisionHash },
        { ...mutation(owner.userId, removed.ok ? removed.roomVersion : 0), humanConfirmed: true },
      );
      expect(freshApproval.ok).toBe(true);
    });
  });

  describe("equal_authority_consensus finalization", () => {
    async function setUpConsensusRoom() {
      const created = await createRoomWithTwoParticipants();
      const policy = await setDecisionPolicy(
        owner.repository, created.roomId,
        { decisionPolicy: "equal_authority_consensus" },
        mutation(owner.userId, created.version),
      );
      if (!policy.ok) throw new Error(policy.error.message);
      const promoteAlice = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, policy.roomVersion),
      );
      if (!promoteAlice.ok) throw new Error(promoteAlice.error.message);

      // Alice is now a required approver (see `derive_owner_participant_authority`),
      // so -- like the owner -- she must publish a position and mark ready
      // before Input can advance.
      const alicePosition = await addParticipantPosition(
        alice.repository, created.roomId,
        { summary: "Support a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
        mutation(alice.userId, promoteAlice.roomVersion),
      );
      if (!alicePosition.ok) throw new Error(alicePosition.error.message);
      const aliceReady = await markMyInputReady(alice.repository, created.roomId, mutation(alice.userId, alicePosition.roomVersion));
      if (!aliceReady.ok) throw new Error(aliceReady.error.message);

      const { proposalId, version } = await advanceToVoting(created.roomId, aliceReady.roomVersion);
      return { ...created, proposalId, version };
    }

    it("requires every active decision-maker's approval; contributor alignment never counts", async () => {
      const room = await setUpConsensusRoom();

      const toApproval = await advanceRoomPhase(
        owner.repository, room.roomId, "approval", mutation(owner.userId, room.version),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);
      const preview = await previewFinalDecision(owner.repository, owner.userId, room.roomId);
      if (!preview.ok) throw new Error(preview.error.message);
      expect(preview.data.requiredApprovalParticipantIds.sort()).toEqual(
        [room.ownerParticipantId, room.aliceParticipantId].sort(),
      );
      expect(preview.data.requiredApprovalParticipantIds).not.toContain(room.bobParticipantId);

      const bobAttempt = await approveParticipantFinalDecision(
        bob.repository, room.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(bob.userId, toApproval.roomVersion), humanConfirmed: true },
      );
      expect(bobAttempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const ownerApproval = await approveParticipantFinalDecision(
        owner.repository, room.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(owner.userId, toApproval.roomVersion), humanConfirmed: true },
      );
      expect(ownerApproval.ok).toBe(true);
      const afterOwner = await getMeetingContext(owner.repository, owner.userId, room.roomId);
      expect(afterOwner?.phase).toBe("approval");

      const aliceApproval = await approveParticipantFinalDecision(
        alice.repository, room.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(alice.userId, ownerApproval.ok ? ownerApproval.roomVersion : 0), humanConfirmed: true },
      );
      expect(aliceApproval.ok).toBe(true);
      const finalRoom = await getMeetingContext(owner.repository, owner.userId, room.roomId);
      expect(finalRoom?.phase).toBe("finalized");
    });

    it("requires a decision-maker promoted before freeze, but never a simulation", async () => {
      const room = await setUpConsensusRoom();
      const promoteBob = await setParticipantDecisionRole(
        owner.repository, room.roomId,
        { participantId: room.bobParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, room.version),
      );
      if (!promoteBob.ok) throw new Error(promoteBob.error.message);

      await admin.from("participants").insert({
        id: `simulation-${room.roomId}`, room_id: room.roomId, name: "Advisor", role: "Advisor",
        kind: "simulation", meeting_role: "participant", decision_role: "decision_maker",
        required_for_approval: false,
      } as never);

      const toApproval = await advanceRoomPhase(
        owner.repository, room.roomId, "approval", mutation(owner.userId, promoteBob.roomVersion),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);
      const preview = await previewFinalDecision(owner.repository, owner.userId, room.roomId);
      if (!preview.ok) throw new Error(preview.error.message);
      expect(preview.data.requiredApprovalParticipantIds.sort()).toEqual(
        [room.ownerParticipantId, room.aliceParticipantId, room.bobParticipantId].sort(),
      );
    });

    it("excludes a removed decision-maker after safe recomputation", async () => {
      const room = await setUpConsensusRoom();
      const toApproval = await advanceRoomPhase(
        owner.repository, room.roomId, "approval", mutation(owner.userId, room.version),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);

      const removed = await removeParticipant(
        owner.repository, room.roomId,
        { participantId: room.aliceParticipantId },
        mutation(owner.userId, toApproval.roomVersion),
      );
      expect(removed.ok).toBe(true);

      const preview = await previewFinalDecision(owner.repository, owner.userId, room.roomId);
      if (!preview.ok) throw new Error(preview.error.message);
      expect(preview.data.requiredApprovalParticipantIds).toEqual([room.ownerParticipantId]);

      const ownerApproval = await approveParticipantFinalDecision(
        owner.repository, room.roomId,
        { decisionHash: preview.data.decisionHash },
        { ...mutation(owner.userId, removed.ok ? removed.roomVersion : 0), humanConfirmed: true },
      );
      expect(ownerApproval.ok).toBe(true);
      const finalRoom = await getMeetingContext(owner.repository, owner.userId, room.roomId);
      expect(finalRoom?.phase).toBe("finalized");
    });

    it("invalidates a stale approval when the required decision-maker set changes", async () => {
      const room = await setUpConsensusRoom();
      const toApproval = await advanceRoomPhase(
        owner.repository, room.roomId, "approval", mutation(owner.userId, room.version),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);
      const staleHashPreview = await previewFinalDecision(owner.repository, owner.userId, room.roomId);
      if (!staleHashPreview.ok) throw new Error(staleHashPreview.error.message);
      const staleHash = staleHashPreview.data.decisionHash;

      const promoteBob = await setParticipantDecisionRole(
        owner.repository, room.roomId,
        { participantId: room.bobParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, toApproval.roomVersion),
      );
      // Promoting a decision-maker while a candidate is frozen is rejected --
      // structural authority changes are blocked once frozen, per the same
      // invariant setDecisionPolicy uses.
      expect(promoteBob).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      // Removing Alice (a required decision-maker) is still permitted while
      // frozen, and safely recomputes the candidate/hash.
      const removed = await removeParticipant(
        owner.repository, room.roomId,
        { participantId: room.aliceParticipantId },
        mutation(owner.userId, toApproval.roomVersion),
      );
      expect(removed.ok).toBe(true);

      const staleApproval = await approveParticipantFinalDecision(
        owner.repository, room.roomId,
        { decisionHash: staleHash },
        { ...mutation(owner.userId, removed.ok ? removed.roomVersion : 0), humanConfirmed: true },
      );
      expect(staleApproval).toMatchObject({ ok: false, error: { code: "DECISION_CHANGED" } });
    });
  });

  describe("decision policy change", () => {
    it("lets only the owner change the policy, rejects an invalid value, and audits the change", async () => {
      const created = await createRoomWithTwoParticipants();

      const nonOwner = await setDecisionPolicy(
        alice.repository, created.roomId,
        { decisionPolicy: "equal_authority_consensus" },
        mutation(alice.userId, created.version),
      );
      expect(nonOwner).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const invalid = await setDecisionPolicy(
        owner.repository, created.roomId,
        // @ts-expect-error -- deliberately invalid at the domain boundary
        { decisionPolicy: "majority" },
        mutation(owner.userId, created.version),
      );
      expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const changed = await setDecisionPolicy(
        owner.repository, created.roomId,
        { decisionPolicy: "equal_authority_consensus" },
        mutation(owner.userId, created.version),
      );
      expect(changed).toMatchObject({ ok: true, roomVersion: created.version + 1 });

      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room?.decisionPolicy).toBe("equal_authority_consensus");

      const events = await admin.from("audit_events").select("action")
        .eq("room_id", created.roomId).eq("action", "decision_policy.changed");
      expect(events.data).toHaveLength(1);
    });

    it("rejects a policy change once the candidate is frozen, keeping candidate/approval state consistent", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, version),
      );
      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);

      const attempt = await setDecisionPolicy(
        owner.repository, created.roomId,
        { decisionPolicy: "equal_authority_consensus" },
        mutation(owner.userId, toApproval.roomVersion),
      );
      expect(attempt).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room?.decisionPolicy).toBe("owner_decides");
      expect(room?.finalDecisionPreview?.decisionPolicy).toBe("owner_decides");
    });
  });

  describe("decision-role management", () => {
    it("promotes and demotes an active human participant, and audits both changes", async () => {
      const created = await createRoomWithTwoParticipants();

      const promoted = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, created.version),
      );
      expect(promoted).toMatchObject({ ok: true, roomVersion: created.version + 1 });

      const demoted = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId, decisionRole: "contributor" },
        mutation(owner.userId, promoted.roomVersion),
      );
      expect(demoted).toMatchObject({ ok: true, roomVersion: promoted.roomVersion + 1 });

      const events = await admin.from("audit_events").select("action")
        .eq("room_id", created.roomId).eq("action", "participant.decision_role_changed");
      expect(events.data).toHaveLength(2);
    });

    it("never lets the owner cease being a decision maker, even targeting themselves", async () => {
      const created = await createRoomWithTwoParticipants();
      const selfDemote = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: created.ownerParticipantId, decisionRole: "contributor" },
        mutation(owner.userId, created.version),
      );
      expect(selfDemote).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
    });

    it("rejects a non-owner, a removed target, a simulation target, and a cross-room target", async () => {
      const created = await createRoomWithTwoParticipants();
      const otherRoom = await createRoomWithTwoParticipants();

      const nonOwner = await setParticipantDecisionRole(
        alice.repository, created.roomId,
        { participantId: created.bobParticipantId, decisionRole: "decision_maker" },
        mutation(alice.userId, created.version),
      );
      expect(nonOwner).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const crossRoom = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: otherRoom.aliceParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, created.version),
      );
      expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const removed = await removeParticipant(
        owner.repository, created.roomId,
        { participantId: created.bobParticipantId },
        mutation(owner.userId, created.version),
      );
      if (!removed.ok) throw new Error(removed.error.message);
      const toRemoved = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: created.bobParticipantId, decisionRole: "decision_maker" },
        mutation(owner.userId, removed.roomVersion),
      );
      expect(toRemoved).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const simulationId = `simulation-${created.roomId}`;
      await admin.from("participants").insert({
        id: simulationId, room_id: created.roomId, name: "Advisor", role: "Advisor",
        kind: "simulation", meeting_role: "participant", decision_role: "advisor",
        required_for_approval: false,
      } as never);
      const toSimulation = await setParticipantDecisionRole(
        owner.repository, created.roomId,
        { participantId: simulationId, decisionRole: "decision_maker" },
        mutation(owner.userId, removed.roomVersion),
      );
      expect(toSimulation).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });
  });

  describe("ownership transfer while a candidate is frozen", () => {
    it("invalidates the old owner's authority and requires the new owner's confirmation", async () => {
      const created = await createRoomWithTwoParticipants();
      const { proposalId, version } = await advanceToVoting(created.roomId, created.version);
      const ownerAlignment = await expressMyAlignment(
        owner.repository, created.roomId,
        { proposalId, choice: "support", comment: null },
        mutation(owner.userId, version),
      );
      const toApproval = await advanceRoomPhase(
        owner.repository, created.roomId, "approval",
        mutation(owner.userId, ownerAlignment.ok ? ownerAlignment.roomVersion : 0),
      );
      if (!toApproval.ok) throw new Error(toApproval.error.message);

      const stalePreview = await previewFinalDecision(owner.repository, owner.userId, created.roomId);
      if (!stalePreview.ok) throw new Error(stalePreview.error.message);
      const staleHash = stalePreview.data.decisionHash;
      expect(stalePreview.data.requiredApprovalParticipantIds).toEqual([created.ownerParticipantId]);

      const transferred = await transferOwnership(
        owner.repository, created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, toApproval.roomVersion),
      );
      expect(transferred.ok).toBe(true);

      // The old owner's approval attempt with the pre-transfer hash cannot
      // finalize the recomputed candidate.
      const oldOwnerStaleAttempt = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: staleHash },
        { ...mutation(owner.userId, transferred.ok ? transferred.roomVersion : 0), humanConfirmed: true },
      );
      expect(oldOwnerStaleAttempt).toMatchObject({ ok: false, error: { code: "DECISION_CHANGED" } });

      const freshPreview = await previewFinalDecision(alice.repository, alice.userId, created.roomId);
      if (!freshPreview.ok) throw new Error(freshPreview.error.message);
      expect(freshPreview.data.decisionHash).not.toBe(staleHash);
      expect(freshPreview.data.requiredApprovalParticipantIds).toEqual([created.aliceParticipantId]);

      // The old owner is no longer required, even with the current hash.
      const oldOwnerFreshAttempt = await approveParticipantFinalDecision(
        owner.repository, created.roomId,
        { decisionHash: freshPreview.data.decisionHash },
        { ...mutation(owner.userId, transferred.ok ? transferred.roomVersion : 0), humanConfirmed: true },
      );
      expect(oldOwnerFreshAttempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const newOwnerApproval = await approveParticipantFinalDecision(
        alice.repository, created.roomId,
        { decisionHash: freshPreview.data.decisionHash },
        { ...mutation(alice.userId, transferred.ok ? transferred.roomVersion : 0), humanConfirmed: true },
      );
      expect(newOwnerApproval.ok).toBe(true);
      const finalRoom = await getMeetingContext(alice.repository, alice.userId, created.roomId);
      expect(finalRoom?.phase).toBe("finalized");
    });
  });
});
