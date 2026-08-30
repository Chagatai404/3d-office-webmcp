import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  approveParticipantFinalDecision,
  advanceDemoRoomPhase,
  castParticipantVote,
  claimParticipantSeat,
  getFinalDecisionRecord,
  getMeetingContext,
  proposeParticipantTradeoff,
  raiseParticipantObjection,
  resolveParticipantObjection,
  startDemoScenario,
  previewFinalDecision,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import {
  decisionCandidateFromPreview,
  hashDecisionCandidate,
} from "@/domain/rooms/decision";
import { getOpenIssues } from "@/domain/rooms/queries";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function anonymousActor() {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const authenticatedClient = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    client: authenticatedClient,
    userId: data.user.id,
    repository: new SupabaseRoomRepository(authenticatedClient),
  };
}

function context(
  userId: string,
  expectedRoomVersion: number,
  origin: MutationContext["actor"]["origin"] = "manual_ui",
): MutationContext {
  return { actor: { authUserId: userId, origin }, expectedRoomVersion };
}

describe.sequential("Supabase-backed room domain operations", () => {
  let engineer: Awaited<ReturnType<typeof anonymousActor>>;
  let designer: Awaited<ReturnType<typeof anonymousActor>>;
  let product: Awaited<ReturnType<typeof anonymousActor>>;
  let demoAdminRepository: SupabaseRoomRepository;
  let demoAdminClient: ReturnType<typeof createClient>;
  let engineerConstraintId = "";
  let proposalId = "";
  let conflictId = "";

  beforeAll(async () => {
    if (!serviceRoleKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for guarded demo reset tests.");
    }
    demoAdminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    demoAdminRepository = new SupabaseRoomRepository(demoAdminClient);
    engineer = await anonymousActor();
    designer = await anonymousActor();
    product = await anonymousActor();
  });

  it("rejects unauthenticated mutations before repository writes", async () => {
    const result = await claimParticipantSeat(
      engineer.repository,
      "demo",
      { seatId: "demo-engineer" },
      context("", 0),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 0 });
  });

  it("enforces one owner per room at the database boundary", async () => {
    const duplicateOwner = await demoAdminClient.from("participants").insert({
      id: "demo-duplicate-owner",
      room_id: "demo",
      name: "Duplicate owner",
      role: "Fixture",
      kind: "simulation",
      meeting_role: "owner",
      decision_role: "decision_maker",
      required_for_approval: false,
    } as never);
    expect(duplicateOwner.error).toBeTruthy();

    const owners = await demoAdminClient
      .from("participants")
      .select("id")
      .eq("room_id", "demo")
      .eq("meeting_role", "owner");
    expect(owners.error).toBeNull();
    expect(owners.data).toEqual([{ id: "demo-product" }]);
  });

  it("allows two anonymous sessions to claim different seats", async () => {
    const engineerClaim = await claimParticipantSeat(
      engineer.repository, "demo", { seatId: "demo-engineer" }, context(engineer.userId, 0),
    );
    expect(engineerClaim).toMatchObject({ ok: true, roomVersion: 1 });

    const isolationAttempt = await claimParticipantSeat(
      engineer.repository, "demo", { seatId: "demo-designer" }, context(engineer.userId, 1),
    );
    expect(isolationAttempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 1 });

    const designerClaim = await claimParticipantSeat(
      designer.repository, "demo", { seatId: "demo-designer" }, context(designer.userId, 1),
    );
    expect(designerClaim).toMatchObject({ ok: true, roomVersion: 2 });

    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room?.selfParticipantId).toBe("demo-engineer");
    expect(room?.participants.find((participant) => participant.id === "demo-designer")?.isClaimed).toBe(true);
  });

  it("atomically creates a position, stable constraints, version, and audit event", async () => {
    const result = await addParticipantPosition(
      engineer.repository,
      "demo",
      {
        summary: "Ship a thin vertical slice using the existing auth flow.",
        category: "delivery",
        priority: "critical",
        constraints: [{ category: "capacity", text: "No authentication rewrite.", priority: "critical" }],
      },
      context(engineer.userId, 2),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: 3 });
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    engineerConstraintId = room!.constraints.find((item) => item.text === "No authentication rewrite.")!.id;
    expect(engineerConstraintId).toBeTruthy();
    expect(room?.activity.at(-1)).toMatchObject({
      action: "position.added",
      actorType: "participant",
      actorId: "demo-engineer",
      origin: "manual_ui",
      previousRoomVersion: 2,
      resultingRoomVersion: 3,
    });
  });

  it("rejects invalid input, stale writes, and wrong-phase writes without incrementing", async () => {
    const invalid = await addParticipantPosition(
      engineer.repository,
      "demo",
      { summary: "", category: null, priority: null, constraints: [] },
      context(engineer.userId, 3),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 3 });

    const stale = await addParticipantPosition(
      engineer.repository,
      "demo",
      { summary: "Stale", category: null, priority: null, constraints: [] },
      context(engineer.userId, 2),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" }, roomVersion: 3 });

    const wrongPhase = await submitParticipantProposal(
      engineer.repository,
      "demo",
      { title: "Too early", summary: "Too early", rationale: "Too early", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null },
      context(engineer.userId, 3),
    );
    expect(wrongPhase).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" }, roomVersion: 3 });
  });

  it("rejects cross-room references and creates an authorized proposal", async () => {
    const earlyTradeoff = await proposeParticipantTradeoff(
      engineer.repository,
      "demo",
      {
        conflictIds: ["not-yet-created"],
        description: "Too early",
        expectedEffect: "Too early",
        revisedProposal: {
          title: "Too early",
          summary: "Too early",
          rationale: "Too early",
          expectedOutcomes: [],
          referencedConstraintIds: [],
        },
      },
      context(engineer.userId, 3, "webmcp"),
    );
    expect(earlyTradeoff).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" }, roomVersion: 3 });

    const advanced = await advanceDemoRoomPhase(
      engineer.repository, "demo", "proposals", context(engineer.userId, 3),
    );
    expect(advanced).toMatchObject({ ok: true, roomVersion: 4 });

    const crossRoom = await submitParticipantProposal(
      engineer.repository,
      "demo",
      {
        title: "Invalid reference", summary: "Invalid", rationale: "Invalid",
        expectedOutcomes: [], referencedConstraintIds: ["authorization-constraint"], parentProposalId: null,
      },
      context(engineer.userId, 4),
    );
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 4 });

    const created = await submitParticipantProposal(
      engineer.repository,
      "demo",
      {
        title: "Progressive onboarding hints",
        summary: "Add two accessible hints to the existing onboarding flow.",
        rationale: "Fits capacity without an auth rewrite.",
        expectedOutcomes: ["Faster first value"], referencedConstraintIds: [engineerConstraintId], parentProposalId: null,
      },
      context(engineer.userId, 4),
    );
    expect(created).toMatchObject({ ok: true, roomVersion: 5 });
    const room = await getMeetingContext(designer.repository, designer.userId, "demo");
    proposalId = room!.activeProposalId!;
    expect(room?.proposals.find((proposal) => proposal.id === proposalId)?.participantId).toBe("demo-engineer");
  });

  it("validates objection references and records the designer as actor", async () => {
    const advanced = await advanceDemoRoomPhase(
      designer.repository, "demo", "deliberation", context(designer.userId, 5),
    );
    expect(advanced).toMatchObject({ ok: true, roomVersion: 6 });

    const crossRoom = await raiseParticipantObjection(
      designer.repository,
      "demo",
      { proposalId: "authorization-proposal", constraintId: engineerConstraintId, reason: "Cross-room", severity: "blocking" },
      context(designer.userId, 6),
    );
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 6 });

    const objection = await raiseParticipantObjection(
      designer.repository,
      "demo",
      { proposalId, constraintId: engineerConstraintId, reason: "The hint focus order needs accessibility review.", severity: "blocking" },
      context(designer.userId, 6),
    );
    expect(objection).toMatchObject({ ok: true, roomVersion: 7 });
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    conflictId = room!.conflicts.find((conflict) => conflict.reason.includes("focus order"))!.id;
    expect(room?.conflicts.find((conflict) => conflict.id === conflictId)).toMatchObject({ raisedByActorId: "demo-designer", constraintId: engineerConstraintId });
    expect(room?.activity.at(-1)).toMatchObject({ action: "objection.raised", resultingRoomVersion: 7 });
  });

  it("derives only open issues with useful proposal, constraint, and actor context", async () => {
    const issues = await getOpenIssues(engineer.repository, engineer.userId, "demo");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      conflictId,
      proposal: { id: proposalId, title: "Progressive onboarding hints" },
      constraint: { id: engineerConstraintId, text: "No authentication rewrite." },
      raisedBy: { actorType: "participant", actorId: "demo-designer", displayName: "Lina" },
      severity: "blocking",
      status: "open",
      latestRelatedProposalId: null,
    });
    expect(JSON.stringify(issues)).not.toContain(engineer.userId);
    expect(JSON.stringify(issues)).not.toContain("user_id");
  });

  it("rejects stale, unknown, closed, cross-room, unclaimed, and invalid-reference trade-offs atomically", async () => {
    const input = {
      conflictIds: [conflictId],
      description: "Keep the hints, but make focus order explicit.",
      expectedEffect: "Addresses the accessibility objection without expanding scope.",
      revisedProposal: {
        title: "Accessible progressive onboarding hints",
        summary: "Add two hints with documented keyboard and screen-reader order.",
        rationale: "Preserves the thin slice while addressing the blocking issue.",
        expectedOutcomes: ["Faster first value", "Accessible navigation"],
        referencedConstraintIds: [engineerConstraintId],
      },
    };
    const before = await getMeetingContext(engineer.repository, engineer.userId, "demo");

    const stale = await proposeParticipantTradeoff(
      engineer.repository, "demo", input, context(engineer.userId, 6, "webmcp"),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" }, roomVersion: 7 });

    for (const invalidConflictId of ["missing-conflict", "seed-conflict-resolved", "authorization-conflict"]) {
      const invalid = await proposeParticipantTradeoff(
        engineer.repository,
        "demo",
        { ...input, conflictIds: [invalidConflictId] },
        context(engineer.userId, 7, "webmcp"),
      );
      expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 7 });
    }

    const invalidReference = await proposeParticipantTradeoff(
      engineer.repository,
      "demo",
      {
        ...input,
        revisedProposal: {
          ...input.revisedProposal,
          referencedConstraintIds: ["authorization-constraint"],
        },
      },
      context(engineer.userId, 7, "webmcp"),
    );
    expect(invalidReference).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 7 });

    const unclaimed = await anonymousActor();
    const unauthorized = await proposeParticipantTradeoff(
      unclaimed.repository, "demo", input, context(unclaimed.userId, 7, "webmcp"),
    );
    expect(unauthorized).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 7 });

    const after = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(after?.version).toBe(7);
    expect(after?.activeProposalId).toBe(before?.activeProposalId);
    expect(after?.proposals).toHaveLength(before!.proposals.length);
    expect(after?.tradeoffs).toHaveLength(before!.tradeoffs.length);
  });

  it("atomically records a webmcp trade-off and a revised child proposal without closing conflicts", async () => {
    const result = await proposeParticipantTradeoff(
      engineer.repository,
      "demo",
      {
        conflictIds: [conflictId],
        description: "Keep the hints, but make focus order explicit.",
        expectedEffect: "Addresses the accessibility objection without expanding scope.",
        revisedProposal: {
          title: "Accessible progressive onboarding hints",
          summary: "Add two hints with documented keyboard and screen-reader order.",
          rationale: "Preserves the thin slice while addressing the blocking issue.",
          expectedOutcomes: ["Faster first value", "Accessible navigation"],
          referencedConstraintIds: [engineerConstraintId],
        },
      },
      context(engineer.userId, 7, "webmcp"),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: 8 });

    const room = await getMeetingContext(designer.repository, designer.userId, "demo");
    const child = room!.proposals.find((proposal) => proposal.id === room!.activeProposalId)!;
    expect(child).toMatchObject({
      title: "Accessible progressive onboarding hints",
      participantId: "demo-engineer",
      parentProposalId: proposalId,
      status: "candidate",
    });
    expect(room?.proposals.find((proposal) => proposal.id === proposalId)?.status).toBe("superseded");
    expect(room?.tradeoffs).toHaveLength(1);
    expect(room?.tradeoffs[0]).toMatchObject({
      conflictIds: [conflictId],
      createdByActorType: "participant",
      createdByActorId: "demo-engineer",
      resultingProposalId: child.id,
    });
    expect(room?.conflicts.find((conflict) => conflict.id === conflictId)?.status).toBe("open");
    expect(room?.activity.at(-1)).toMatchObject({
      action: "tradeoff.proposed",
      actorType: "participant",
      actorId: "demo-engineer",
      origin: "webmcp",
      previousRoomVersion: 7,
      resultingRoomVersion: 8,
    });

    const issues = await getOpenIssues(designer.repository, designer.userId, "demo");
    expect(issues[0]?.latestRelatedProposalId).toBe(child.id);
  });

  it("requires explicit conflict resolution before voting", async () => {
    const wrongPhaseVote = await castParticipantVote(
      engineer.repository,
      "demo",
      { proposalId: "not-active", choice: "support", comment: null },
      context(engineer.userId, 8, "webmcp"),
    );
    expect(wrongPhaseVote).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" }, roomVersion: 8 });

    const blocked = await advanceDemoRoomPhase(
      engineer.repository, "demo", "voting", context(engineer.userId, 8),
    );
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "UNRESOLVED_BLOCKING_CONFLICT" },
      roomVersion: 8,
    });
  });

  it("resolves an open conflict explicitly with participant provenance", async () => {
    const stale = await resolveParticipantObjection(
      designer.repository,
      "demo",
      { conflictId, resolutionNote: "Stale resolution" },
      context(designer.userId, 7),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" }, roomVersion: 8 });

    for (const invalidConflictId of ["seed-conflict-resolved", "authorization-conflict"]) {
      const invalid = await resolveParticipantObjection(
        designer.repository,
        "demo",
        { conflictId: invalidConflictId, resolutionNote: "Invalid resolution" },
        context(designer.userId, 8),
      );
      expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 8 });
    }

    const resolved = await resolveParticipantObjection(
      designer.repository,
      "demo",
      {
        conflictId,
        resolutionNote: "The revised proposal now specifies accessible focus order.",
      },
      context(designer.userId, 8),
    );
    expect(resolved).toMatchObject({ ok: true, roomVersion: 9 });
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room?.conflicts.find((conflict) => conflict.id === conflictId)).toMatchObject({
      status: "resolved",
      resolvedByActorType: "participant",
      resolvedByActorId: "demo-designer",
      resolutionNote: "The revised proposal now specifies accessible focus order.",
    });
    expect(room?.activity.at(-1)).toMatchObject({
      action: "conflict.resolved",
      actorType: "participant",
      actorId: "demo-designer",
      origin: "manual_ui",
      previousRoomVersion: 8,
      resultingRoomVersion: 9,
    });
  });

  it("supports participant-scoped vote creation and same-row updates", async () => {
    const voting = await advanceDemoRoomPhase(
      engineer.repository, "demo", "voting", context(engineer.userId, 9),
    );
    expect(voting).toMatchObject({ ok: true, roomVersion: 10 });
    const roomAtVoting = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    const activeProposalId = roomAtVoting!.activeProposalId!;

    const staleVote = await castParticipantVote(
      engineer.repository,
      "demo",
      { proposalId: activeProposalId, choice: "support", comment: null },
      context(engineer.userId, 9, "webmcp"),
    );
    expect(staleVote).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" }, roomVersion: 10 });

    const crossRoom = await castParticipantVote(
      engineer.repository,
      "demo",
      { proposalId: "authorization-proposal", choice: "support", comment: null },
      context(engineer.userId, 10, "webmcp"),
    );
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 10 });

    for (const forbiddenOrigin of ["expert_service", "simulation"] as const) {
      const forbidden = await castParticipantVote(
        engineer.repository,
        "demo",
        { proposalId: activeProposalId, choice: "support", comment: null },
        context(engineer.userId, 10, forbiddenOrigin),
      );
      expect(forbidden).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 10 });
    }

    const unclaimed = await anonymousActor();
    const noMembership = await castParticipantVote(
      unclaimed.repository,
      "demo",
      { proposalId: activeProposalId, choice: "support", comment: null },
      context(unclaimed.userId, 10, "webmcp"),
    );
    expect(noMembership).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 10 });

    const firstVote = await castParticipantVote(
      engineer.repository,
      "demo",
      { proposalId: activeProposalId, choice: "support", comment: null },
      context(engineer.userId, 10, "webmcp"),
    );
    expect(firstVote).toMatchObject({ ok: true, roomVersion: 11 });

    const missingVote = await advanceDemoRoomPhase(
      engineer.repository, "demo", "approval", context(engineer.userId, 11),
    );
    expect(missingVote).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 11 });

    const updatedVote = await castParticipantVote(
      engineer.repository,
      "demo",
      { proposalId: activeProposalId, choice: "support", comment: "Confirmed feasible." },
      context(engineer.userId, 11, "webmcp"),
    );
    expect(updatedVote).toMatchObject({ ok: true, roomVersion: 12 });
    const designerVote = await castParticipantVote(
      designer.repository,
      "demo",
      { proposalId: activeProposalId, choice: "support", comment: "Accessibility is addressed." },
      context(designer.userId, 12),
    );
    expect(designerVote).toMatchObject({ ok: true, roomVersion: 13 });

    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room?.votes).toHaveLength(2);
    expect(room?.votes.filter((vote) => vote.participantId === "demo-engineer")).toHaveLength(1);
    expect(room?.votes.find((vote) => vote.participantId === "demo-engineer")?.comment).toBe("Confirmed feasible.");
    expect(room?.approvals).toHaveLength(0);
    expect(room?.activity.at(-2)).toMatchObject({ action: "vote.updated", origin: "webmcp" });
    expect(room?.activity.at(-1)).toMatchObject({ action: "vote.cast", origin: "manual_ui" });
  });

  it("builds one deterministic exact approval candidate and hash", async () => {
    const approval = await advanceDemoRoomPhase(
      engineer.repository, "demo", "approval", context(engineer.userId, 13),
    );
    expect(approval).toMatchObject({ ok: true, roomVersion: 14 });

    const engineerPreview = await previewFinalDecision(
      engineer.repository, engineer.userId, "demo",
    );
    const designerPreview = await previewFinalDecision(
      designer.repository, designer.userId, "demo",
    );
    expect(engineerPreview.ok).toBe(true);
    expect(designerPreview.ok).toBe(true);
    if (!engineerPreview.ok || !designerPreview.ok) throw new Error("Preview unavailable.");
    expect(engineerPreview.data).toEqual(designerPreview.data);
    expect(engineerPreview.data.approvals).toEqual([]);
    expect(engineerPreview.data.missingApprovalParticipantIds).toEqual([
      "demo-designer",
      "demo-engineer",
    ]);
    expect(await hashDecisionCandidate(
      decisionCandidateFromPreview(engineerPreview.data),
    )).toBe(engineerPreview.data.decisionHash);

    const room = await getMeetingContext(designer.repository, designer.userId, "demo");
    expect(room?.finalDecisionPreview?.decisionHash).toBe(engineerPreview.data.decisionHash);
    expect(room?.approvals).toHaveLength(0);
  });

  it("enforces exact participant approval and human confirmation", async () => {
    const initialPreview = await previewFinalDecision(
      engineer.repository, engineer.userId, "demo",
    );
    if (!initialPreview.ok) throw new Error("Preview unavailable.");
    const decisionHash = initialPreview.data.decisionHash;

    const product = await anonymousActor();
    const productClaim = await claimParticipantSeat(
      product.repository,
      "demo",
      { seatId: "demo-product" },
      context(product.userId, 14),
    );
    expect(productClaim).toMatchObject({ ok: true, roomVersion: 15 });
    const nonRequired = await approveParticipantFinalDecision(
      product.repository,
      "demo",
      { decisionHash },
      { ...context(product.userId, 15), humanConfirmed: true },
    );
    expect(nonRequired).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 15 });

    const changed = await approveParticipantFinalDecision(
      engineer.repository,
      "demo",
      { decisionHash: `stale-${decisionHash}` },
      { ...context(engineer.userId, 15), humanConfirmed: true },
    );
    expect(changed).toMatchObject({
      ok: false,
      error: { code: "DECISION_CHANGED" },
      roomVersion: 15,
    });

    const requested = await approveParticipantFinalDecision(
      engineer.repository,
      "demo",
      { decisionHash },
      context(engineer.userId, 15, "webmcp"),
    );
    expect(requested).toMatchObject({
      ok: false,
      error: { code: "HUMAN_CONFIRMATION_REQUIRED" },
      roomVersion: 15,
    });
    let room = await getMeetingContext(designer.repository, designer.userId, "demo");
    expect(room?.approvals).toHaveLength(0);
    expect(room?.activity.at(-1)).toMatchObject({
      action: "approval.requested",
      actorId: "demo-engineer",
      origin: "webmcp",
      confirmationRequired: true,
      previousRoomVersion: 15,
      resultingRoomVersion: 15,
    });

    const engineerApproval = await approveParticipantFinalDecision(
      engineer.repository,
      "demo",
      { decisionHash },
      { ...context(engineer.userId, 15), humanConfirmed: true },
    );
    expect(engineerApproval).toMatchObject({ ok: true, roomVersion: 16 });
    room = await getMeetingContext(designer.repository, designer.userId, "demo");
    expect(room?.phase).toBe("approval");
    expect(room?.approvals).toHaveLength(1);
    expect(room?.finalDecisionPreview?.missingApprovalParticipantIds).toEqual(["demo-designer"]);

    const designerApproval = await approveParticipantFinalDecision(
      designer.repository,
      "demo",
      { decisionHash },
      { ...context(designer.userId, 16), humanConfirmed: true },
    );
    expect(designerApproval).toMatchObject({ ok: true, roomVersion: 17 });
  });

  it("atomically finalizes, persists an immutable record, and rejects later mutations", async () => {
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room).toMatchObject({ phase: "finalized", version: 17 });
    expect(room?.finalizedAt).toBeTruthy();
    expect(room?.proposals.find((proposal) => proposal.id === room.activeProposalId)?.status).toBe("accepted");
    expect(room?.approvals).toHaveLength(2);
    expect(room?.activity.at(-1)).toMatchObject({
      action: "decision.finalized",
      previousRoomVersion: 16,
      resultingRoomVersion: 17,
    });

    const engineerRecord = await getFinalDecisionRecord(
      engineer.repository, engineer.userId, "demo",
    );
    const designerRecord = await getFinalDecisionRecord(
      designer.repository, designer.userId, "demo",
    );
    expect(engineerRecord.ok).toBe(true);
    expect(designerRecord).toEqual(engineerRecord);
    if (!engineerRecord.ok) throw new Error("Decision record unavailable.");
    expect(engineerRecord.data.roomId).toBe("demo");
    expect(engineerRecord.data.approvals).toHaveLength(2);
    expect(engineerRecord.data.decision.missingApprovalParticipantIds).toEqual([]);
    expect(engineerRecord.data.provenance.at(-1)?.action).toBe("decision.finalized");

    const previewAfterFinalization = await previewFinalDecision(
      engineer.repository, engineer.userId, "demo",
    );
    expect(previewAfterFinalization).toMatchObject({ ok: false, error: { code: "ALREADY_FINALIZED" }, roomVersion: 17 });

    const mutationResults = await Promise.all([
      addParticipantPosition(engineer.repository, "demo", {
        summary: "Too late", category: null, priority: null, constraints: [],
      }, context(engineer.userId, 17)),
      submitParticipantProposal(engineer.repository, "demo", {
        title: "Too late", summary: "Too late", rationale: "Too late",
        expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null,
      }, context(engineer.userId, 17)),
      raiseParticipantObjection(engineer.repository, "demo", {
        proposalId: room!.activeProposalId!, constraintId: engineerConstraintId,
        reason: "Too late", severity: "warning",
      }, context(engineer.userId, 17)),
      resolveParticipantObjection(engineer.repository, "demo", {
        conflictId, resolutionNote: "Too late",
      }, context(engineer.userId, 17)),
      proposeParticipantTradeoff(engineer.repository, "demo", {
        conflictIds: [conflictId], description: "Too late", expectedEffect: "Too late",
        revisedProposal: {
          title: "Too late", summary: "Too late", rationale: "Too late",
          expectedOutcomes: [], referencedConstraintIds: [],
        },
      }, context(engineer.userId, 17)),
      castParticipantVote(engineer.repository, "demo", {
        proposalId: room!.activeProposalId!, choice: "oppose", comment: "Too late",
      }, context(engineer.userId, 17, "webmcp")),
      approveParticipantFinalDecision(engineer.repository, "demo", {
        decisionHash: room!.finalDecisionPreview!.decisionHash,
      }, { ...context(engineer.userId, 17), humanConfirmed: true }),
      advanceDemoRoomPhase(engineer.repository, "demo", "approval", context(engineer.userId, 17)),
    ]);
    for (const result of mutationResults) {
      expect(result).toMatchObject({ ok: false, error: { code: "ALREADY_FINALIZED" }, roomVersion: 17 });
    }
    const unchanged = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(unchanged?.version).toBe(17);
  });

  it("does not expose or permit reads from an unrelated room", async () => {
    await expect(getMeetingContext(engineer.repository, engineer.userId, "authorization-fixture")).resolves.toBeNull();
  });

  it("runs an idempotent solo-judge scenario with simulation authority and replayable reset", async () => {
    const browserResetAttempt = await product.client.rpc("start_demo_scenario", {
      p_room_id: "demo",
      p_mode: "solo_judge",
      p_human_role: "product",
    });
    expect(browserResetAttempt.error?.message).toContain("permission denied");

    const reset = await startDemoScenario(
      demoAdminRepository,
      "demo",
      { mode: "solo_judge", humanRole: "product" },
      product.userId,
    );
    expect(reset).toMatchObject({ ok: true, roomVersion: 3 });

    let room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ demoMode: "solo_judge", phase: "input", version: 3 });
    expect(room?.participants.filter((participant) => participant.kind === "human").map((participant) => participant.id)).toEqual(["demo-product"]);
    expect(room?.participants.filter((participant) => participant.kind === "simulation")).toHaveLength(3);
    expect(room?.participants.filter((participant) => participant.decisionRole === "decision_maker").map((participant) => participant.id)).toEqual(["demo-product"]);
    expect(room?.positions).toHaveLength(3);
    expect(room?.activity.filter((event) => event.action === "position.added" && event.origin === "simulation")).toHaveLength(3);

    const privateSimulationAttempt = await product.client.rpc(
      "demo_add_simulation_position",
      {
        p_room_id: "demo",
        p_participant_id: "demo-product",
        p_summary: "Authority attack",
        p_category: "attack",
        p_priority: "critical",
        p_reaction_key: "attack:human-position",
      },
    );
    expect(privateSimulationAttempt.error).toBeTruthy();

    const simulationSeatAttack = await claimParticipantSeat(
      product.repository,
      "demo",
      { seatId: "demo-engineer" },
      context(product.userId, 3),
    );
    expect(simulationSeatAttack).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 3 });

    const claim = await claimParticipantSeat(
      product.repository,
      "demo",
      { seatId: "demo-product" },
      context(product.userId, 3),
    );
    expect(claim).toMatchObject({ ok: true, roomVersion: 4 });

    const position = await addParticipantPosition(
      product.repository,
      "demo",
      {
        summary: "Improve onboarding completion and time to first value.",
        category: "outcome",
        priority: "high",
        constraints: [],
      },
      context(product.userId, 4, "webmcp"),
    );
    expect(position).toMatchObject({ ok: true, roomVersion: 6 });
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ phase: "proposals", version: 6 });

    const ambitious = await submitParticipantProposal(
      product.repository,
      "demo",
      {
        title: "Custom personalized onboarding rebuild",
        summary: "Rebuild onboarding as a custom multi-step flow with new event tracking and expanded personalization before campaign launch.",
        rationale: "The broad rebuild aims to improve onboarding completion and first value.",
        expectedOutcomes: ["Higher completion"],
        referencedConstraintIds: ["constraint-product-completion", "constraint-product-value"],
        parentProposalId: null,
      },
      context(product.userId, 6, "webmcp"),
    );
    expect(ambitious).toMatchObject({ ok: true, roomVersion: 10 });
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ phase: "deliberation", version: 10 });
    const blockers = room!.conflicts.filter((item) => item.status === "open" && item.severity === "blocking");
    expect(blockers).toHaveLength(2);
    expect(blockers.map((item) => item.raisedByActorId).sort()).toEqual(["demo-designer", "demo-engineer"]);
    for (const blocker of blockers) {
      expect(room?.activity.find((event) => event.entityId === blocker.id)).toMatchObject({
        actorType: "participant",
        actorId: blocker.raisedByActorId,
        origin: "simulation",
        action: "objection.raised",
      });
    }

    const concurrentReads = await Promise.all([
      getMeetingContext(product.repository, product.userId, "demo"),
      getMeetingContext(product.repository, product.userId, "demo"),
      getMeetingContext(product.repository, product.userId, "demo"),
    ]);
    expect(concurrentReads.every((snapshot) => snapshot?.version === 10)).toBe(true);
    expect(concurrentReads[0]?.conflicts.filter((item) => item.status === "open")).toHaveLength(2);

    const compromise = await proposeParticipantTradeoff(
      product.repository,
      "demo",
      {
        conflictIds: blockers.map((item) => item.id),
        description: "Reduce scope and reuse the existing authentication and onboarding flow.",
        expectedEffect: "Keep the two-week campaign launch while validating accessibility.",
        revisedProposal: {
          title: "Accessible incremental onboarding",
          summary: "Reuse the existing authentication and onboarding flow, limit scope to two accessible steps, and keep the campaign launch date.",
          rationale: "A thin two-week scope preserves existing auth while validating keyboard and screen reader accessibility and improving first value.",
          expectedOutcomes: ["Improve onboarding completion", "Faster first value"],
          referencedConstraintIds: [
            "constraint-engineering-auth",
            "constraint-engineering-capacity",
            "constraint-design-accessibility",
            "constraint-marketing-date",
          ],
        },
      },
      context(product.userId, 10, "webmcp"),
    );
    expect(compromise).toMatchObject({ ok: true, roomVersion: 17 });
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ phase: "voting", version: 17 });
    expect(room?.conflicts.filter((item) => item.status === "open" && item.severity === "blocking")).toHaveLength(0);
    expect(room?.conflicts.every((item) => item.status !== "resolved" || item.resolvedByActorId === item.raisedByActorId)).toBe(true);
    expect(room?.votes).toHaveLength(3);
    expect(room?.votes.every((vote) => vote.participantId !== "demo-product" && vote.choice === "support")).toBe(true);
    expect(room?.activity.filter((event) => event.action === "vote.cast" && event.origin === "simulation")).toHaveLength(3);

    const simulatedApproval = await approveParticipantFinalDecision(
      product.repository,
      "demo",
      { decisionHash: "not-yet-available" },
      context(product.userId, 17, "simulation"),
    );
    expect(simulatedApproval).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 17 });

    const humanVote = await castParticipantVote(
      product.repository,
      "demo",
      { proposalId: room!.activeProposalId!, choice: "support", comment: "Ready for exact human review." },
      context(product.userId, 17, "webmcp"),
    );
    expect(humanVote).toMatchObject({ ok: true, roomVersion: 19 });
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ phase: "approval", version: 19 });
    expect(room?.approvals).toHaveLength(0);
    expect(room?.finalDecisionPreview?.requiredApprovalParticipantIds).toEqual(["demo-product"]);

    const decisionHash = room!.finalDecisionPreview!.decisionHash;
    const humanApproval = await approveParticipantFinalDecision(
      product.repository,
      "demo",
      { decisionHash },
      { ...context(product.userId, 19), humanConfirmed: true },
    );
    expect(humanApproval).toMatchObject({ ok: true, roomVersion: 20 });
    const record = await getFinalDecisionRecord(product.repository, product.userId, "demo");
    expect(record.ok).toBe(true);
    if (!record.ok) throw new Error("Solo decision record unavailable.");
    expect(record.data.approvals.map((approval) => approval.participantId)).toEqual(["demo-product"]);
    expect(record.data.provenance.some((event) => event.origin === "simulation" && event.action === "objection.raised")).toBe(true);
    expect(record.data.provenance.some((event) => event.origin === "simulation" && event.action === "conflict.resolved")).toBe(true);
    expect(record.data.provenance.filter((event) => event.origin === "simulation" && event.action === "vote.cast")).toHaveLength(3);

    const replayReset = await startDemoScenario(
      demoAdminRepository,
      "demo",
      { mode: "solo_judge", humanRole: "product" },
      product.userId,
    );
    expect(replayReset).toMatchObject({ ok: true, roomVersion: 3 });
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room).toMatchObject({ phase: "input", version: 3, finalizedAt: null, activeProposalId: null });
    expect(room?.conflicts).toHaveLength(0);
    expect(room?.tradeoffs).toHaveLength(0);
    expect(room?.votes).toHaveLength(0);
    expect(room?.approvals).toHaveLength(0);
    expect(room?.finalDecisionPreview).toBeNull();
    expect(room?.selfParticipantId).toBeNull();

    const replayClaim = await claimParticipantSeat(
      product.repository,
      "demo",
      { seatId: "demo-product" },
      context(product.userId, 3),
    );
    expect(replayClaim).toMatchObject({ ok: true, roomVersion: 4 });
    const replayPosition = await addParticipantPosition(
      product.repository,
      "demo",
      { summary: "Replay onboarding outcome.", category: "outcome", priority: "high", constraints: [] },
      context(product.userId, 4),
    );
    expect(replayPosition).toMatchObject({ ok: true, roomVersion: 6 });
  });

  it("transactionally resets input, deliberation, voting, and approval state", async () => {
    async function resetSolo() {
      const result = await startDemoScenario(
        demoAdminRepository,
        "demo",
        { mode: "solo_judge", humanRole: "product" },
        product.userId,
      );
      expect(result).toMatchObject({ ok: true, roomVersion: 3 });
      const snapshot = await getMeetingContext(product.repository, product.userId, "demo");
      expect(snapshot).toMatchObject({ phase: "input", version: 3, finalizedAt: null });
      expect(snapshot?.conflicts).toHaveLength(0);
      expect(snapshot?.tradeoffs).toHaveLength(0);
      expect(snapshot?.votes).toHaveLength(0);
      expect(snapshot?.approvals).toHaveLength(0);
      expect(snapshot?.finalDecisionPreview).toBeNull();
      return snapshot!;
    }

    async function reachDeliberation() {
      await resetSolo();
      await claimParticipantSeat(
        product.repository,
        "demo",
        { seatId: "demo-product" },
        context(product.userId, 3),
      );
      await addParticipantPosition(
        product.repository,
        "demo",
        { summary: "Improve onboarding completion.", category: "outcome", priority: "high", constraints: [] },
        context(product.userId, 4),
      );
      await submitParticipantProposal(
        product.repository,
        "demo",
        {
          title: "Custom onboarding rebuild",
          summary: "Rebuild onboarding as a custom multi-step flow with new event tracking.",
          rationale: "Improve onboarding completion and first value before campaign launch.",
          expectedOutcomes: ["Higher completion"],
          referencedConstraintIds: ["constraint-product-completion"],
          parentProposalId: null,
        },
        context(product.userId, 6),
      );
      const snapshot = await getMeetingContext(product.repository, product.userId, "demo");
      expect(snapshot).toMatchObject({ phase: "deliberation", version: 10 });
      return snapshot!;
    }

    async function reachVoting() {
      const deliberation = await reachDeliberation();
      const blockers = deliberation.conflicts.filter((item) => item.status === "open");
      await proposeParticipantTradeoff(
        product.repository,
        "demo",
        {
          conflictIds: blockers.map((item) => item.id),
          description: "Reuse existing authentication and reduce scope.",
          expectedEffect: "Preserve launch and accessibility.",
          revisedProposal: {
            title: "Accessible incremental onboarding",
            summary: "Reuse the existing authentication and onboarding flow, limit scope, and keep the campaign launch date.",
            rationale: "A thin two-week scope validates keyboard and screen reader accessibility and improves first value.",
            expectedOutcomes: ["Improve onboarding completion"],
            referencedConstraintIds: [
              "constraint-engineering-auth",
              "constraint-design-accessibility",
              "constraint-marketing-date",
            ],
          },
        },
        context(product.userId, 10),
      );
      const snapshot = await getMeetingContext(product.repository, product.userId, "demo");
      expect(snapshot).toMatchObject({ phase: "voting", version: 17 });
      return snapshot!;
    }

    await resetSolo();
    await resetSolo();

    await reachDeliberation();
    await resetSolo();

    await reachVoting();
    await resetSolo();

    const voting = await reachVoting();
    await castParticipantVote(
      product.repository,
      "demo",
      { proposalId: voting.activeProposalId!, choice: "support", comment: null },
      context(product.userId, 17),
    );
    const approval = await getMeetingContext(product.repository, product.userId, "demo");
    expect(approval).toMatchObject({ phase: "approval", version: 19 });
    await resetSolo();

    const multiReset = await startDemoScenario(
      demoAdminRepository,
      "demo",
      { mode: "multi_user", humanRole: null },
      product.userId,
    );
    expect(multiReset).toMatchObject({ ok: true, roomVersion: 0 });
    const multiRoom = await getMeetingContext(product.repository, product.userId, "demo");
    expect(multiRoom).toMatchObject({ demoMode: "multi_user", phase: "input", version: 0 });
    expect(multiRoom?.participants.every((participant) => participant.kind === "human")).toBe(true);
    expect(multiRoom?.participants.filter((participant) => participant.decisionRole === "decision_maker").map((participant) => participant.id).sort()).toEqual(["demo-designer", "demo-engineer", "demo-product"]);
    expect(multiRoom?.positions).toHaveLength(4);
  });
});
