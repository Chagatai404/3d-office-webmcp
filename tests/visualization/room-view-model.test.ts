import { describe, expect, it } from "vitest";
import type { RoomState } from "@/contracts/room";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { deriveCoordinationStatus } from "@/components/room/coordination";
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
  referencedSourceIds: [],
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
          sourceProvenance: [],
          expertAdvice: [],
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
    // The objection text is projected so the Issues board can echo it.
    expect(view.conflicts[0]?.reason).toBe(
      "The scope does not fit the available capacity.",
    );
  });

  it("carries the room title and brief for the Brief board", () => {
    const view = createRoomVisualizationState(demoRoom);

    expect(view.title).toBe(demoRoom.title);
    expect(view.brief).toBe(demoRoom.brief);
  });
});

/**
 * B8: what a seat in the 3D room is allowed to say.
 *
 * The scene marks the people the room is waiting on, and it reads that from
 * the same derivation the DOM roster and the coordination strip read — so a
 * marker on a chair can never disagree with the sentence printed above it.
 * A seat is also not a place to invent pressure: where the room is short of a
 * thing rather than a person, no chair is marked at all.
 */
describe("seat state", () => {
  function waitedOnIds(room: RoomState): string[] {
    return createRoomVisualizationState(room)
      .participants.filter((participant) => participant.isWaitedOn)
      .map((participant) => participant.id);
  }

  it("marks the humans who have not marked their input ready", () => {
    expect(waitedOnIds(demoRoom)).toEqual([
      "participant-product",
      "participant-engineering",
      "participant-marketing",
    ]);
  });

  it("clears a seat as soon as that person is ready", () => {
    const room = structuredClone(demoRoom);
    room.participants = room.participants.map((participant) =>
      participant.id === "participant-engineering"
        ? { ...participant, isReady: true }
        : participant,
    );

    const view = createRoomVisualizationState(room);
    const engineer = view.participants.find(
      (participant) => participant.id === "participant-engineering",
    );
    expect(engineer?.isReady).toBe(true);
    expect(engineer?.isWaitedOn).toBe(false);
  });

  it("never marks a simulated teammate as somebody the room waits on", () => {
    expect(waitedOnIds(demoRoom)).not.toContain("participant-design");
  });

  it("marks nobody while the room is short of an option rather than a person", () => {
    expect(
      waitedOnIds(withDecision({ phase: "proposals", proposals: [candidateProposal] })),
    ).toEqual([]);
    expect(waitedOnIds(withDecision({ phase: "deliberation" }))).toEqual([]);
    expect(waitedOnIds(withDecision({ phase: "finalized" }))).toEqual([]);
  });

  it("marks the people who have not said where they stand", () => {
    const room = withDecision({
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
      ],
    });

    expect(waitedOnIds(room)).toEqual([
      "participant-engineering",
      "participant-marketing",
    ]);
  });

  it("says exactly what the coordination status says, in every phase", () => {
    for (const phase of ["input", "proposals", "deliberation", "voting", "finalized"] as const) {
      const room = withDecision({ phase });
      expect(waitedOnIds(room)).toEqual(
        deriveCoordinationStatus(room).waitingParticipantIds,
      );
    }
  });
});
