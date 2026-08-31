import { describe, expect, it } from "vitest";
import { computeCoordinationStatus } from "@/domain/rooms/coordination";
import { deriveRoomCapabilityContext, getAvailableWebMcpToolNames } from "@/webmcp/capability-context";
import { createRoomWebMcpTools } from "@/webmcp/room-tools";
import { buildRoomStateFixture, executeTool, fakeRoomWebMcpContext } from "./fake-context";

const owner = { id: "participant-owner", name: "Ata", role: "Founder", kind: "human" as const, meetingRole: "owner" as const, decisionRole: "decision_maker" as const, isClaimed: true, isReady: true, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:00.000Z" };
const engineer = { id: "participant-engineer", name: "Maya", role: "Engineer", kind: "human" as const, meetingRole: "participant" as const, decisionRole: "contributor" as const, isClaimed: true, isReady: false, status: "active" as const, removedAt: null, createdAt: "2026-08-30T00:00:01.000Z" };
const removedDesigner = { id: "participant-designer", name: "Noah", role: "Designer", kind: "human" as const, meetingRole: "participant" as const, decisionRole: "contributor" as const, isClaimed: true, isReady: false, status: "removed" as const, removedAt: "2026-08-30T01:00:00.000Z", createdAt: "2026-08-30T00:00:02.000Z" };

describe("computeCoordinationStatus", () => {
  it("carries the room id, version, phase, and phase goal through unchanged", () => {
    const room = buildRoomStateFixture({ phase: "deliberation", version: 42, participants: [owner, engineer] });
    const status = computeCoordinationStatus(room);
    expect(status.roomId).toBe(room.id);
    expect(status.roomVersion).toBe(42);
    expect(status.phase).toBe("deliberation");
    expect(status.phaseGoal.length).toBeGreaterThan(10);
  });

  describe("input phase", () => {
    it("reports each active human's readiness and whether they have shared input", () => {
      const room = buildRoomStateFixture({
        phase: "input",
        participants: [owner, engineer],
        positions: [{ id: "position-1", participantId: "participant-engineer", summary: "s", category: null, priority: null, referencedSourceIds: [], createdAt: "2026-08-30T00:00:00.000Z" }],
      });
      const status = computeCoordinationStatus(room);
      expect(status.input).not.toBeNull();
      expect(status.input!.totalActiveHumans).toBe(2);
      expect(status.input!.readyCount).toBe(1);
      const engineerEntry = status.input!.readiness.find((entry) => entry.participantId === "participant-engineer")!;
      expect(engineerEntry.hasSharedInput).toBe(true);
      expect(engineerEntry.isReady).toBe(false);
      expect(status.proposals).toBeNull();
    });

    it("cannot advance while any active human is not ready, and names them in waitingFor", () => {
      const room = buildRoomStateFixture({ phase: "input", participants: [owner, engineer] });
      const status = computeCoordinationStatus(room);
      expect(status.canAdvance).toBe(false);
      expect(status.waitingFor).toEqual([expect.stringContaining("Maya")]);
    });

    it("can advance once every active human is ready", () => {
      const room = buildRoomStateFixture({ phase: "input", participants: [owner, { ...engineer, isReady: true }] });
      const status = computeCoordinationStatus(room);
      expect(status.canAdvance).toBe(true);
      expect(status.waitingFor).toEqual([]);
    });

    it("excludes a removed participant from readiness and waitingFor", () => {
      const room = buildRoomStateFixture({ phase: "input", participants: [owner, removedDesigner] });
      const status = computeCoordinationStatus(room);
      expect(status.input!.totalActiveHumans).toBe(1);
      expect(status.waitingFor).toEqual([]);
      expect(status.canAdvance).toBe(true);
    });
  });

  describe("proposals phase", () => {
    it("cannot advance without an active proposal", () => {
      const room = buildRoomStateFixture({ phase: "proposals", participants: [owner, engineer], activeProposalId: null });
      const status = computeCoordinationStatus(room);
      expect(status.proposals!.hasActiveProposal).toBe(false);
      expect(status.canAdvance).toBe(false);
      expect(status.deliberation).toBeNull();
    });

    it("can advance and identifies the proposer once a candidate exists", () => {
      const room = buildRoomStateFixture({
        phase: "proposals",
        participants: [owner, engineer],
        activeProposalId: "proposal-1",
        proposals: [{ id: "proposal-1", participantId: "participant-engineer", title: "Reduced scope", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], referencedSourceIds: [], parentProposalId: null, status: "candidate", createdAt: "2026-08-30T00:00:00.000Z" }],
      });
      const status = computeCoordinationStatus(room);
      expect(status.proposals).toEqual({
        hasActiveProposal: true,
        activeProposalId: "proposal-1",
        activeProposalTitle: "Reduced scope",
        proposedByParticipantId: "participant-engineer",
        proposalCount: 1,
      });
      expect(status.canAdvance).toBe(true);
    });
  });

  describe("deliberation phase", () => {
    const conflict = {
      id: "conflict-1", proposalId: "proposal-1", constraintId: null,
      raisedByActorType: "participant" as const, raisedByActorId: "participant-engineer",
      status: "open" as const, resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
      createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
    };

    it("cannot advance while a blocking concern is open, and attributes it by name", () => {
      const room = buildRoomStateFixture({
        phase: "deliberation", participants: [owner, engineer],
        conflicts: [{ ...conflict, severity: "blocking", reason: "Breaks capacity" }],
      });
      const status = computeCoordinationStatus(room);
      expect(status.deliberation!.blockingCount).toBe(1);
      expect(status.deliberation!.warningCount).toBe(0);
      expect(status.canAdvance).toBe(false);
      expect(status.waitingFor).toEqual([expect.stringContaining("Maya")]);
    });

    it("can advance when only warning-severity concerns remain open", () => {
      const room = buildRoomStateFixture({
        phase: "deliberation", participants: [owner, engineer],
        conflicts: [{ ...conflict, severity: "warning", reason: "Might slip" }],
      });
      const status = computeCoordinationStatus(room);
      expect(status.deliberation!.blockingCount).toBe(0);
      expect(status.canAdvance).toBe(true);
      expect(status.waitingFor).toEqual([]);
    });
  });

  describe("voting (alignment) phase", () => {
    it("lists who has not shared alignment but does not treat that as blocking canAdvance", () => {
      const room = buildRoomStateFixture({
        phase: "voting", participants: [owner, engineer], activeProposalId: "proposal-1",
        alignments: [{ proposalId: "proposal-1", participantId: "participant-owner", choice: "support", comment: null, updatedAt: "2026-08-30T00:00:00.000Z" }],
      });
      const status = computeCoordinationStatus(room);
      expect(status.alignment!.missingParticipantIds).toEqual(["participant-engineer"]);
      expect(status.waitingFor).toEqual(["Maya"]);
      // Alignment is informative only -- it never mechanically gates the phase transition.
      expect(status.canAdvance).toBe(true);
    });

    it("still respects an (unexpected) open blocking conflict as a real gate", () => {
      const room = buildRoomStateFixture({
        phase: "voting", participants: [owner, engineer], activeProposalId: "proposal-1",
        conflicts: [{
          id: "conflict-1", proposalId: "proposal-1", constraintId: null,
          raisedByActorType: "participant", raisedByActorId: "participant-engineer",
          severity: "blocking", reason: "x", status: "open",
          resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
          createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
        }],
      });
      expect(computeCoordinationStatus(room).canAdvance).toBe(false);
    });
  });

  describe("approval phase", () => {
    const preview = {
      proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], referencedSourceIds: [], parentProposalId: null, status: "candidate" as const, createdAt: "2026-08-30T00:00:00.000Z" },
      rationale: "r", acceptedTradeoffs: [], unresolvedWarnings: [], alignments: [],
      decisionPolicy: "owner_decides" as const, owners: [], deadlines: [], actionItems: [], dissent: [],
      expertAdvice: [], sourceProvenance: [], decisionHash: "hash-1", approvals: [],
    };

    it("names missing required approvers and cannot advance until every one approves", () => {
      const room = buildRoomStateFixture({
        phase: "approval", participants: [owner, engineer], activeProposalId: "proposal-1",
        finalDecisionPreview: { ...preview, requiredApprovalParticipantIds: ["participant-owner"], missingApprovalParticipantIds: ["participant-owner"] },
      });
      const status = computeCoordinationStatus(room);
      expect(status.approval!.decisionHash).toBe("hash-1");
      expect(status.waitingFor).toEqual(["Ata"]);
      expect(status.canAdvance).toBe(false);
      expect(status.approval!.humanConfirmationRequired).toBe(true);
    });

    it("can advance once every required approver has approved", () => {
      const room = buildRoomStateFixture({
        phase: "approval", participants: [owner, engineer], activeProposalId: "proposal-1",
        finalDecisionPreview: {
          ...preview,
          requiredApprovalParticipantIds: ["participant-owner"],
          missingApprovalParticipantIds: [],
          approvals: [{ participantId: "participant-owner", decisionHash: "hash-1", approvedAt: "2026-08-30T02:00:00.000Z" }],
        },
      });
      const status = computeCoordinationStatus(room);
      expect(status.approval!.completedApproverIds).toEqual(["participant-owner"]);
      expect(status.canAdvance).toBe(true);
      expect(status.waitingFor).toEqual([]);
    });
  });

  it("finalized: cannot advance further and points to the immutable record", () => {
    const room = buildRoomStateFixture({ phase: "finalized", participants: [owner, engineer], finalizedAt: "2026-08-30T03:00:00.000Z" });
    const status = computeCoordinationStatus(room);
    expect(status.isFinalized).toBe(true);
    expect(status.canAdvance).toBe(false);
    expect(status.recommendedNextAction).toMatch(/get_decision_record/);
    expect(status.input).toBeNull();
    expect(status.approval).toBeNull();
  });
});

describe("get_coordination_status WebMCP tool", () => {
  it("is available in every phase, including before a seat is claimed", () => {
    for (const phase of ["input", "proposals", "deliberation", "voting", "approval", "finalized"] as const) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: null });
      const names = getAvailableWebMcpToolNames(deriveRoomCapabilityContext(room));
      expect(names, phase).toContain("get_coordination_status");
    }
  });

  it("returns the room version and a phase-appropriate section", async () => {
    const room = buildRoomStateFixture({ phase: "deliberation", version: 7 });
    const context = fakeRoomWebMcpContext({ room, roomVersion: 7 });
    const result = await executeTool(createRoomWebMcpTools(context).get_coordination_status!, {}) as {
      ok: boolean;
      data: { roomVersion: number; phase: string; deliberation: unknown; input: unknown };
      roomVersion: number;
    };
    expect(result.ok).toBe(true);
    expect(result.roomVersion).toBe(7);
    expect(result.data.phase).toBe("deliberation");
    expect(result.data.deliberation).not.toBeNull();
    expect(result.data.input).toBeNull();
  });
});
