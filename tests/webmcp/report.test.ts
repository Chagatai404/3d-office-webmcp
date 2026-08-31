import { describe, expect, it } from "vitest";
import type { DecisionRecord } from "@/contracts/room";
import { computeMeetingReport } from "@/domain/rooms/report";
import { deriveRoomCapabilityContext, getAvailableWebMcpToolNames } from "@/webmcp/capability-context";
import { createRoomWebMcpTools } from "@/webmcp/room-tools";
import { buildRoomStateFixture, executeTool, fakeRoomWebMcpContext } from "./fake-context";

const owner = { id: "participant-owner", name: "Ata", role: "Founder", kind: "human" as const, meetingRole: "owner" as const, decisionRole: "decision_maker" as const, isClaimed: true, isReady: true, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:00.000Z" };
const engineer = { id: "participant-engineer", name: "Maya", role: "Engineer", kind: "human" as const, meetingRole: "participant" as const, decisionRole: "contributor" as const, isClaimed: true, isReady: true, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:01.000Z" };

const finalProposal = {
  id: "proposal-1", participantId: "participant-engineer", title: "Reduced scope onboarding",
  summary: "Ship the smallest complete onboarding scope.", rationale: "Fits the deadline.",
  expectedOutcomes: ["Launch on time"], referencedConstraintIds: [], referencedSourceIds: [], parentProposalId: null,
  status: "accepted" as const, createdAt: "2026-08-30T00:00:00.000Z",
};

function buildDecisionRecordFixture(overrides: Partial<DecisionRecord["decision"]> = {}): DecisionRecord {
  const decision = {
    proposal: finalProposal,
    rationale: "The reduced scope preserves the deadline and existing auth boundaries.",
    acceptedTradeoffs: [{
      id: "tradeoff-1", conflictIds: ["conflict-1"], createdByActorType: "participant" as const,
      createdByActorId: "participant-engineer", description: "Reduce scope.", expectedEffect: "Fits capacity.",
      resultingProposalId: "proposal-1", createdAt: "2026-08-30T00:00:00.000Z",
    }],
    unresolvedWarnings: [],
    alignments: [{ proposalId: "proposal-1", participantId: "participant-owner", choice: "support" as const, comment: null, updatedAt: "2026-08-30T00:00:00.000Z" }],
    decisionPolicy: "owner_decides" as const,
    owners: [{ participantId: "participant-owner", responsibility: "Ship the release." }],
    deadlines: [{ label: "Launch", dueAt: "2026-09-15T00:00:00.000Z" }],
    actionItems: [{ id: "action-1", text: "Update onboarding copy.", ownerParticipantId: "participant-engineer", dueAt: null }],
    dissent: ["Maya noted residual risk in the reduced timeline."],
    sourceProvenance: [],
    requiredApprovalParticipantIds: ["participant-owner"],
    expertAdvice: [{
      expertKey: "security" as const, findingId: "finding-1", proposalId: "proposal-1", category: "behavioral_tracking",
      title: "Behavioral tracking reviewed", status: "resolved" as const, resolutionRationale: "No tracking in the final scope.",
    }],
    decisionHash: "hash-final-1",
    approvals: [{ participantId: "participant-owner", decisionHash: "hash-final-1", approvedAt: "2026-08-30T02:00:00.000Z" }],
    missingApprovalParticipantIds: [],
    ...overrides,
  };
  return {
    roomId: "room-under-test",
    finalizedAt: "2026-08-30T02:00:01.000Z",
    decision,
    acceptedTradeoffs: decision.acceptedTradeoffs,
    alignments: decision.alignments,
    approvals: decision.approvals,
    provenance: [
      { id: "e1", actorType: "participant", actorId: "participant-owner", origin: "manual_ui", action: "room.created", entityType: "room", entityId: "room-under-test", sanitizedInput: {}, result: { ok: true }, previousRoomVersion: 0, resultingRoomVersion: 1, confirmationRequired: false, createdAt: "2026-08-30T00:00:00.000Z" },
      { id: "e2", actorType: "participant", actorId: "participant-engineer", origin: "webmcp", action: "proposal.submitted", entityType: "proposal", entityId: "proposal-1", sanitizedInput: {}, result: { ok: true }, previousRoomVersion: 1, resultingRoomVersion: 2, confirmationRequired: false, createdAt: "2026-08-30T00:01:00.000Z" },
      { id: "e3", actorType: "participant", actorId: "participant-owner", origin: "webmcp", action: "approval.recorded", entityType: "proposal", entityId: "proposal-1", sanitizedInput: {}, result: { ok: true }, previousRoomVersion: 2, resultingRoomVersion: 3, confirmationRequired: true, createdAt: "2026-08-30T02:00:00.000Z" },
      { id: "e4", actorType: "participant", actorId: "participant-owner", origin: "webmcp", action: "decision.finalized", entityType: "proposal", entityId: "proposal-1", sanitizedInput: {}, result: { ok: true }, previousRoomVersion: 3, resultingRoomVersion: 4, confirmationRequired: false, createdAt: "2026-08-30T02:00:01.000Z" },
    ],
  };
}

describe("computeMeetingReport", () => {
  it("carries every decision-shaped field over from the decision record unchanged", () => {
    const room = buildRoomStateFixture({ phase: "finalized", participants: [owner, engineer], proposals: [finalProposal] });
    const record = buildDecisionRecordFixture();
    const report = computeMeetingReport(room, record);

    expect(report.roomId).toBe(record.roomId);
    expect(report.finalDecision).toEqual({ title: finalProposal.title, summary: finalProposal.summary });
    expect(report.rationale).toBe(record.decision.rationale);
    expect(report.decisionPolicy).toBe(record.decision.decisionPolicy);
    expect(report.acceptedTradeoffs).toEqual(record.decision.acceptedTradeoffs);
    expect(report.alignment).toEqual(record.decision.alignments);
    expect(report.dissent).toEqual(record.decision.dissent);
    expect(report.unresolvedWarnings).toEqual(record.decision.unresolvedWarnings);
    expect(report.expertAdvice).toEqual(record.decision.expertAdvice);
    expect(report.actionItems).toEqual(record.decision.actionItems);
    expect(report.owners).toEqual(record.decision.owners);
    expect(report.deadlines).toEqual(record.decision.deadlines);
    expect(report.requiredApprovalParticipantIds).toEqual(record.decision.requiredApprovalParticipantIds);
    expect(report.approvals).toEqual(record.decision.approvals);
    expect(report.decisionHash).toBe(record.decision.decisionHash);
    expect(report.finalizedAt).toBe(record.finalizedAt);
  });

  it("reads room-level fields directly off canonical room state, never approximated", () => {
    const room = buildRoomStateFixture({
      phase: "finalized",
      title: "Should we ship AI onboarding?",
      brief: "Decide whether to ship AI-assisted onboarding.",
      participants: [owner, engineer],
      positions: [{ id: "position-1", participantId: "participant-engineer", summary: "Capacity is tight.", category: "capacity", priority: "high", referencedSourceIds: [], createdAt: "2026-08-30T00:00:00.000Z" }],
      constraints: [{ id: "constraint-1", participantId: "participant-engineer", category: "capacity", text: "No auth rewrite.", priority: "critical", referencedSourceIds: [], createdAt: "2026-08-30T00:00:00.000Z" }],
      proposals: [finalProposal],
      conflicts: [
        { id: "conflict-1", proposalId: "proposal-1", constraintId: "constraint-1", raisedByActorType: "participant", raisedByActorId: "participant-engineer", severity: "blocking", reason: "Too broad.", status: "resolved", resolvedByActorType: "participant", resolvedByActorId: "participant-engineer", resolutionNote: "Scope reduced.", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: "2026-08-30T00:05:00.000Z" },
        { id: "conflict-2", proposalId: "proposal-1", constraintId: null, raisedByActorType: "participant", raisedByActorId: "participant-owner", severity: "warning", reason: "Minor risk.", status: "open", resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null, createdAt: "2026-08-30T00:06:00.000Z", resolvedAt: null },
      ],
    });
    const report = computeMeetingReport(room, buildDecisionRecordFixture());

    expect(report.title).toBe("Should we ship AI onboarding?");
    expect(report.brief).toBe("Decide whether to ship AI-assisted onboarding.");
    expect(report.participants).toEqual(room.participants);
    expect(report.keyInputs).toEqual(room.positions);
    expect(report.constraints).toEqual(room.constraints);
    expect(report.proposalsConsidered).toEqual(room.proposals);
    expect(report.concernsRaised).toEqual(room.conflicts);
    expect(report.resolvedConcerns).toEqual([room.conflicts[0]]);
  });

  it("builds a deterministic executive summary from structured fields only", () => {
    const room = buildRoomStateFixture({ phase: "finalized", title: "Ship AI onboarding?", participants: [owner, engineer], proposals: [finalProposal] });
    const record = buildDecisionRecordFixture();
    const first = computeMeetingReport(room, record).executiveSummary;
    const second = computeMeetingReport(room, record).executiveSummary;
    expect(first).toBe(second);
    expect(first).toContain("Ship AI onboarding?");
    expect(first).toContain(finalProposal.title);
    expect(first).toContain("1 of 1 required approver confirmed");
    expect(first).toMatch(/1 accepted trade-off/);
    expect(first).toMatch(/1 recorded dissent note/);
  });

  it("summarizes provenance by action count instead of dumping the full trail", () => {
    const room = buildRoomStateFixture({ phase: "finalized", participants: [owner, engineer], proposals: [finalProposal] });
    const report = computeMeetingReport(room, buildDecisionRecordFixture());
    expect(report.provenanceSummary.totalEvents).toBe(4);
    expect(report.provenanceSummary.byAction).toEqual({
      "room.created": 1, "proposal.submitted": 1, "approval.recorded": 1, "decision.finalized": 1,
    });
  });
});

describe("get_final_report WebMCP tool", () => {
  it("is registered only once the room is finalized", () => {
    for (const phase of ["input", "proposals", "deliberation", "voting", "approval"] as const) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: "participant-owner" });
      expect(getAvailableWebMcpToolNames(deriveRoomCapabilityContext(room))).not.toContain("get_final_report");
    }
    const finalized = buildRoomStateFixture({ phase: "finalized", selfParticipantId: "participant-owner", finalizedAt: "2026-08-30T02:00:01.000Z" });
    expect(getAvailableWebMcpToolNames(deriveRoomCapabilityContext(finalized))).toContain("get_final_report");
  });

  it("forwards the underlying WRONG_PHASE refusal unchanged before finalization (stale-reference proof)", async () => {
    const context = fakeRoomWebMcpContext();
    const result = await executeTool(createRoomWebMcpTools(context).get_final_report!, {}) as {
      ok: boolean; error: { code: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("WRONG_PHASE");
  });

  it("returns the full report once finalized", async () => {
    const room = buildRoomStateFixture({ phase: "finalized", participants: [owner, engineer], proposals: [finalProposal], finalizedAt: "2026-08-30T02:00:01.000Z" });
    const record = buildDecisionRecordFixture();
    const context = fakeRoomWebMcpContext({ room, roomVersion: 4 });
    Object.assign(context, { getDecisionRecord: () => Promise.resolve({ ok: true, data: record, roomVersion: 4, message: "Loaded." }) });
    const result = await executeTool(createRoomWebMcpTools(context).get_final_report!, {}) as {
      ok: boolean; data: { decisionHash: string; participants: unknown[] }; roomVersion: number;
    };
    expect(result.ok).toBe(true);
    expect(result.roomVersion).toBe(4);
    expect(result.data.decisionHash).toBe("hash-final-1");
    expect(result.data.participants).toHaveLength(2);
  });

  it("returns the same report basis and decision hash regardless of which participant reads it", async () => {
    const room = buildRoomStateFixture({ phase: "finalized", participants: [owner, engineer], proposals: [finalProposal], finalizedAt: "2026-08-30T02:00:01.000Z" });
    const record = buildDecisionRecordFixture();
    const ownerContext = fakeRoomWebMcpContext({ room, roomVersion: 4, selfParticipantId: "participant-owner" });
    Object.assign(ownerContext, { getDecisionRecord: () => Promise.resolve({ ok: true, data: record, roomVersion: 4, message: "Loaded." }) });
    const engineerContext = fakeRoomWebMcpContext({ room, roomVersion: 4, selfParticipantId: "participant-engineer" });
    Object.assign(engineerContext, { getDecisionRecord: () => Promise.resolve({ ok: true, data: record, roomVersion: 4, message: "Loaded." }) });

    const ownerResult = await executeTool(createRoomWebMcpTools(ownerContext).get_final_report!, {}) as { data: unknown };
    const engineerResult = await executeTool(createRoomWebMcpTools(engineerContext).get_final_report!, {}) as { data: unknown };
    expect(ownerResult.data).toEqual(engineerResult.data);
  });
});
