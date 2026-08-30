import { describe, expect, it } from "vitest";
import { computeAttentionItems } from "@/domain/rooms/attention";
import { buildRoomStateFixture } from "./fake-context";

const owner = { id: "participant-owner", name: "Ata", role: "Founder", kind: "human" as const, meetingRole: "owner" as const, decisionRole: "decision_maker" as const, isClaimed: true, isReady: true, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:00.000Z" };
const engineer = { id: "participant-engineer", name: "Maya", role: "Engineer", kind: "human" as const, meetingRole: "participant" as const, decisionRole: "contributor" as const, isClaimed: true, isReady: false, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:01.000Z" };

describe("computeAttentionItems", () => {
  it("flags input_required only for a human who has not published a position", () => {
    const room = buildRoomStateFixture({ phase: "input", participants: [owner, { ...engineer, isReady: false }] });
    const items = computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] });
    expect(items.map((item) => item.type)).toEqual(["input_required"]);
  });

  it("does not flag input_required once ready", () => {
    const room = buildRoomStateFixture({ phase: "input", participants: [owner, { ...engineer, isReady: true }] });
    const items = computeAttentionItems({ room, self: { ...engineer, isReady: true }, pendingJoinRequests: [] });
    expect(items.map((item) => item.type)).toEqual([]);
  });

  it("flags one admission_request per waiting join request, owner only", () => {
    const room = buildRoomStateFixture({ phase: "input", participants: [owner, engineer] });
    const requests = [
      { id: "jr-1", roomId: room.id, displayName: "Noah", role: "Designer", status: "waiting" as const, createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null },
      { id: "jr-2", roomId: room.id, displayName: "Priya", role: "Marketing", status: "waiting" as const, createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null },
    ];
    const ownerItems = computeAttentionItems({ room, self: owner, pendingJoinRequests: requests });
    const engineerItems = computeAttentionItems({ room, self: engineer, pendingJoinRequests: requests });
    expect(ownerItems.filter((item) => item.type === "admission_request")).toHaveLength(2);
    expect(engineerItems.filter((item) => item.type === "admission_request")).toHaveLength(0);
  });

  it("flags conflict_requires_human only for the human who raised the open blocking conflict", () => {
    const room = buildRoomStateFixture({
      phase: "deliberation",
      participants: [owner, engineer],
      conflicts: [{
        id: "conflict-1", proposalId: "proposal-1", constraintId: null,
        raisedByActorType: "participant", raisedByActorId: "participant-engineer",
        severity: "blocking", reason: "Breaks the two-week capacity.", status: "open",
        resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
        createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
      }],
    });
    expect(computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] }).map((i) => i.type)).toContain("conflict_requires_human");
    expect(computeAttentionItems({ room, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).not.toContain("conflict_requires_human");
  });

  it("does not flag conflict_requires_human for a warning-severity conflict", () => {
    const room = buildRoomStateFixture({
      phase: "deliberation",
      participants: [owner, engineer],
      conflicts: [{
        id: "conflict-1", proposalId: "proposal-1", constraintId: null,
        raisedByActorType: "participant", raisedByActorId: "participant-engineer",
        severity: "warning", reason: "Might slip the date.", status: "open",
        resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
        createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
      }],
    });
    expect(computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] })).toEqual([]);
  });

  it("flags alignment_required only when self has not shared alignment on the active candidate", () => {
    const room = buildRoomStateFixture({
      phase: "voting", participants: [owner, engineer], activeProposalId: "proposal-1",
      alignments: [{ proposalId: "proposal-1", participantId: "participant-owner", choice: "support", comment: null, updatedAt: "2026-08-30T00:00:00.000Z" }],
    });
    expect(computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] }).map((i) => i.type)).toContain("alignment_required");
    expect(computeAttentionItems({ room, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).not.toContain("alignment_required");
  });

  function frozenPreview(requiredIds: string[], missingIds: string[], policy: "owner_decides" | "equal_authority_consensus") {
    return {
      proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null, status: "candidate" as const, createdAt: "2026-08-30T00:00:00.000Z" },
      rationale: "r", acceptedTradeoffs: [], unresolvedWarnings: [], alignments: [],
      decisionPolicy: policy, owners: [], deadlines: [], actionItems: [], dissent: [],
      expertAdvice: [],
      requiredApprovalParticipantIds: requiredIds, decisionHash: "hash-1", approvals: [],
      missingApprovalParticipantIds: missingIds,
    };
  }

  it("flags owner_decision_required for the owner under owner_decides when missing approval", () => {
    const room = buildRoomStateFixture({
      phase: "approval", participants: [owner, engineer], activeProposalId: "proposal-1",
      finalDecisionPreview: frozenPreview(["participant-owner"], ["participant-owner"], "owner_decides"),
    });
    expect(computeAttentionItems({ room, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).toEqual(["owner_decision_required"]);
  });

  it("flags consensus_approval_required for a missing decision-maker under equal_authority_consensus", () => {
    const room = buildRoomStateFixture({
      phase: "approval", participants: [owner, { ...engineer, decisionRole: "decision_maker" }], activeProposalId: "proposal-1",
      decisionPolicy: "equal_authority_consensus",
      finalDecisionPreview: frozenPreview(["participant-owner", "participant-engineer"], ["participant-engineer"], "equal_authority_consensus"),
    });
    expect(computeAttentionItems({ room, self: { ...engineer, decisionRole: "decision_maker" }, pendingJoinRequests: [] }).map((i) => i.type)).toEqual(["consensus_approval_required"]);
  });

  it("never double-flags an owner who has already satisfied their own required approval", () => {
    const room = buildRoomStateFixture({
      phase: "approval", participants: [owner, engineer], activeProposalId: "proposal-1",
      finalDecisionPreview: frozenPreview(["participant-owner"], [], "owner_decides"),
    });
    expect(computeAttentionItems({ room, self: owner, pendingJoinRequests: [] })).toEqual([]);
  });

  it("flags owner_progress_required only when the next step would actually succeed", () => {
    const readyRoom = buildRoomStateFixture({ phase: "proposals", participants: [owner, engineer], activeProposalId: "proposal-1" });
    const notReadyRoom = buildRoomStateFixture({ phase: "proposals", participants: [owner, engineer], activeProposalId: null });
    expect(computeAttentionItems({ room: readyRoom, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).toContain("owner_progress_required");
    expect(computeAttentionItems({ room: notReadyRoom, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).not.toContain("owner_progress_required");
  });

  it("withholds owner_progress_required while a blocking conflict is open", () => {
    const room = buildRoomStateFixture({
      phase: "deliberation", participants: [owner, engineer], activeProposalId: "proposal-1",
      conflicts: [{
        id: "conflict-1", proposalId: "proposal-1", constraintId: null,
        raisedByActorType: "participant", raisedByActorId: "participant-engineer",
        severity: "blocking", reason: "x", status: "open",
        resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
        createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
      }],
    });
    expect(computeAttentionItems({ room, self: owner, pendingJoinRequests: [] }).map((i) => i.type)).not.toContain("owner_progress_required");
  });

  it("returns no items for a removed participant", () => {
    const room = buildRoomStateFixture({ phase: "input", participants: [owner, { ...engineer, status: "removed" }] });
    expect(computeAttentionItems({ room, self: { ...engineer, status: "removed" }, pendingJoinRequests: [] })).toEqual([]);
  });

  it("produces deterministic, non-duplicated IDs across two identical calls", () => {
    const room = buildRoomStateFixture({ phase: "input", participants: [owner, engineer] });
    const first = computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] });
    const second = computeAttentionItems({ room, self: engineer, pendingJoinRequests: [] });
    expect(first).toEqual(second);
    expect(new Set(first.map((item) => item.id)).size).toBe(first.length);
  });
});
