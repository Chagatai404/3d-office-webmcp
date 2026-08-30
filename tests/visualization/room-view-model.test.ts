import { describe, expect, it } from "vitest";
import type { RoomState } from "@/contracts/room";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { createRoomVisualizationState } from "@/visualization/room-view-model";

function withDecision(overrides: Partial<RoomState>): RoomState {
  return { ...structuredClone(demoRoom), ...overrides };
}

const candidateProposal = {
  id: "proposal-1",
  participantId: "participant-product",
  title: "Rebuild onboarding as a custom multi-step flow",
  summary: "Replace the current onboarding with a multi-step flow.",
  rationale: "Completion should improve before the campaign.",
  expectedOutcomes: ["Higher completion"],
  referencedConstraintIds: ["constraint-1"],
  parentProposalId: null,
  status: "candidate" as const,
  createdAt: demoTimestamp(4),
};

describe("createRoomVisualizationState", () => {
  it("maps the seeded room deterministically", () => {
    const first = createRoomVisualizationState(demoRoom);
    const second = createRoomVisualizationState(structuredClone(demoRoom));

    expect(first).toEqual(second);
    expect(first.roomId).toBe("demo");
    expect(first.phase).toBe("input");
    expect(first.version).toBe(demoRoom.version);
    expect(first.participants).toHaveLength(4);
    expect(first.constraints).toHaveLength(demoRoom.constraints.length);
    expect(first.activeProposal).toBeNull();
  });

  it("gives every participant a stable seat", () => {
    const view = createRoomVisualizationState(demoRoom);

    expect(new Set(view.participants.map((participant) => participant.seatIndex)).size).toBe(
      view.participants.length,
    );

    // Seat assignment is stable, so a participant keeps their seat.
    const engineer = view.participants.find(
      (participant) => participant.id === "participant-engineering",
    );
    expect(engineer?.seatIndex).toBe(1);
  });

  it("marks the seated participant as self and labels simulations", () => {
    const view = createRoomVisualizationState(demoRoom);

    expect(
      view.participants.filter((participant) => participant.isSelf),
    ).toHaveLength(1);
    expect(
      view.participants.find((participant) => participant.isSelf)?.id,
    ).toBe(demoRoom.selfParticipantId);
    expect(
      view.participants.find((participant) => participant.kind === "simulation")
        ?.role,
    ).toBe("Designer");
  });

  it("resolves actor names for the ledger without changing the contract", () => {
    const view = createRoomVisualizationState(demoRoom);
    const created = view.recentActivity.find(
      (event) => event.action === "room.created",
    );
    const positionAdded = view.recentActivity.find(
      (event) => event.actorId === "participant-marketing",
    );

    expect(created?.actorName).toBe("System");
    expect(positionAdded?.actorName).toBe("Tomas Reyes");
    expect(positionAdded?.origin).toBe("webmcp");
  });

  it("reports no consensus progress while the room is gathering input", () => {
    const view = createRoomVisualizationState(demoRoom);

    expect(view.consensus).toEqual({
      alignmentProgress: 0,
      approvalProgress: 0,
      hasBlockingConflict: false,
    });
  });

  it("derives alignment progress only for the active proposal", () => {
    const view = createRoomVisualizationState(
      withDecision({
        phase: "voting",
        activeProposalId: "proposal-1",
        proposals: [candidateProposal],
        alignments: [
          {
            proposalId: "proposal-1",
            participantId: "participant-product",
            choice: "support",
            comment: null,
            updatedAt: demoTimestamp(5),
          },
          {
            proposalId: "proposal-0",
            participantId: "participant-design",
            choice: "concern",
            comment: null,
            updatedAt: demoTimestamp(5),
          },
        ],
      }),
    );

    expect(view.activeProposal?.id).toBe("proposal-1");
    expect(view.consensus.alignmentProgress).toBeCloseTo(0.25);
    expect(
      view.participants.find(
        (participant) => participant.id === "participant-design",
      )?.alignment,
    ).toBeNull();
  });

  it("counts approvals only against one decision hash", () => {
    const requiredApprovalParticipantIds = [
      "participant-product",
      "participant-engineering",
      "participant-marketing",
    ];
    const currentApprovals = [
      {
        participantId: "participant-product",
        decisionHash: "hash-current",
        approvedAt: demoTimestamp(6),
      },
      {
        participantId: "participant-engineering",
        decisionHash: "hash-current",
        approvedAt: demoTimestamp(7),
      },
    ];
    const view = createRoomVisualizationState(
      withDecision({
        phase: "approval",
        activeProposalId: "proposal-1",
        proposals: [candidateProposal],
        approvals: [
          ...currentApprovals,
          // An approval of a superseded plan must not count towards consensus.
          {
            participantId: "participant-marketing",
            decisionHash: "hash-superseded",
            approvedAt: demoTimestamp(8),
          },
        ],
        finalDecisionPreview: {
          proposal: candidateProposal,
          rationale: candidateProposal.rationale,
          acceptedTradeoffs: [],
          unresolvedWarnings: [],
          alignments: [],
          decisionPolicy: "equal_authority_consensus",
          owners: [],
          deadlines: [],
          actionItems: [],
          dissent: [],
          requiredApprovalParticipantIds,
          decisionHash: "hash-current",
          approvals: currentApprovals,
          missingApprovalParticipantIds: ["participant-marketing"],
        },
      }),
    );

    // Two of the three required approvers approved the current candidate.
    expect(view.consensus.approvalProgress).toBeCloseTo(2 / 3);
    expect(
      view.participants.find(
        (participant) => participant.id === "participant-marketing",
      )?.hasApprovedCurrentDecision,
    ).toBe(false);
  });

  it("flags an open blocking conflict", () => {
    const view = createRoomVisualizationState(
      withDecision({
        phase: "deliberation",
        activeProposalId: "proposal-1",
        proposals: [candidateProposal],
        conflicts: [
          {
            id: "conflict-1",
            proposalId: "proposal-1",
            constraintId: "constraint-1",
            raisedByActorType: "participant",
            raisedByActorId: "participant-engineering",
            severity: "blocking",
            reason: "The scope does not fit the available capacity.",
            status: "open",
            resolvedByActorType: null,
            resolvedByActorId: null,
            resolutionNote: null,
            createdAt: demoTimestamp(5),
            resolvedAt: null,
          },
          {
            id: "conflict-2",
            proposalId: "proposal-1",
            constraintId: "constraint-3",
            raisedByActorType: "participant",
            raisedByActorId: "participant-design",
            severity: "blocking",
            reason: "No accessibility review is scheduled.",
            status: "resolved",
            resolvedByActorType: "participant",
            resolvedByActorId: "participant-design",
            resolutionNote: "The revised proposal addresses the objection.",
            createdAt: demoTimestamp(5),
            resolvedAt: demoTimestamp(6),
          },
        ],
      }),
    );

    expect(view.consensus.hasBlockingConflict).toBe(true);
    expect(view.conflicts).toHaveLength(2);
  });
});
