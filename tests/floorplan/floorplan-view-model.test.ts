import { describe, expect, it } from "vitest";
import type { RoomState } from "@/contracts/room";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import {
  CONSTRAINT_CARD_CAPACITY,
  OFFICE_SLOT_COUNT,
  meetingSeats,
  officePlacements,
} from "@/floorplan/floorplan-layout";
import {
  createFloorPlanState,
  initialsOf,
  officeIndexOf,
  officeZoneId,
} from "@/floorplan/floorplan-view-model";

function withRoom(overrides: Partial<RoomState>): RoomState {
  return { ...structuredClone(demoRoom), ...overrides };
}

const candidate = {
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

describe("createFloorPlanState", () => {
  it("maps the seeded room deterministically", () => {
    const first = createFloorPlanState(demoRoom);
    const second = createFloorPlanState(structuredClone(demoRoom));

    expect(first).toEqual(second);
    expect(first.roomId).toBe("demo");
    expect(first.title).toBe(demoRoom.title);
    expect(first.phase).toBe("input");
    expect(first.version).toBe(demoRoom.version);
    expect(first.participants).toHaveLength(4);
    expect(first.meeting.activeProposal).toBeNull();
  });

  it("lays out ten offices and marks the empty ones reserved", () => {
    const view = createFloorPlanState(demoRoom);

    expect(view.offices).toHaveLength(OFFICE_SLOT_COUNT);
    expect(view.offices.filter((o) => o.status === "occupied")).toHaveLength(4);
    expect(view.offices.filter((o) => o.status === "reserved")).toHaveLength(6);
    expect(view.offices.map((o) => o.zoneId)).toEqual(
      Array.from({ length: OFFICE_SLOT_COUNT }, (_u, i) => officeZoneId(i)),
    );
  });

  it("identifies the browser session's own participant", () => {
    const view = createFloorPlanState(demoRoom);

    expect(view.self?.id).toBe("participant-engineering");
    expect(view.participants.filter((person) => person.isSelf)).toHaveLength(1);
  });

  it("labels a simulated participant as simulated", () => {
    const designer = createFloorPlanState(demoRoom).participants.find(
      (person) => person.id === "participant-design",
    );

    expect(designer?.kind).toBe("simulation");
  });

  it("stands people in their own office until they have published", () => {
    const view = createFloorPlanState(demoRoom);
    const engineer = view.participants.find((p) => p.id === "participant-engineering");
    const product = view.participants.find((p) => p.id === "participant-product");
    const placement = officePlacements()[engineer?.officeSlot ?? 0];

    // The Engineer seat is seeded without a position.
    expect(engineer?.place).toBe("office");
    expect(engineer?.at.x).toBeGreaterThan(placement?.rect.x ?? 0);
    expect(engineer?.at.x).toBeLessThan(
      (placement?.rect.x ?? 0) + (placement?.rect.width ?? 0),
    );

    expect(product?.place).toBe("corridor");
  });

  it("puts everybody at the table once the room convenes", () => {
    const view = createFloorPlanState(withRoom({ phase: "deliberation" }));
    const seats = meetingSeats();

    expect(view.meeting.seated).toHaveLength(4);
    for (const person of view.participants) {
      expect(person.place).toBe("meeting");
      expect(person.at).toEqual(seats[person.officeSlot]?.position);
    }
  });

  it("keeps every constraint card with the participant who published it", () => {
    const view = createFloorPlanState(demoRoom);

    expect(view.constraintCards).toHaveLength(demoRoom.constraints.length);
    for (const card of view.constraintCards) {
      const owner = view.participants.find((p) => p.id === card.participantId);
      expect(owner).toBeDefined();
      expect(card.ownerName).toBe(owner?.name);
      expect(card.color).toBe(owner?.color);
    }
  });

  it("overflows constraint cards off the board rather than off the plan", () => {
    const extra = Array.from({ length: CONSTRAINT_CARD_CAPACITY + 3 }, (_u, i) => ({
      id: `constraint-extra-${i}`,
      participantId: "participant-product",
      category: "scope",
      text: `Extra constraint ${i}`,
      priority: null,
      createdAt: demoTimestamp(9),
    }));
    const view = createFloorPlanState(withRoom({ constraints: extra }));

    expect(view.constraintCards).toHaveLength(extra.length);
    expect(view.constraintOverflow).toBe(3);
    expect(view.constraintCards.filter((card) => card.slot !== null)).toHaveLength(
      CONSTRAINT_CARD_CAPACITY,
    );
  });

  it("reports no vote progress while there is no candidate", () => {
    const view = createFloorPlanState(demoRoom);

    expect(view.consensus.voteProgress).toBe(0);
    expect(view.consensus.approvalProgress).toBe(0);
    expect(view.consensus.hasBlockingConflict).toBe(false);
  });

  it("counts votes only for the active proposal", () => {
    const view = createFloorPlanState(
      withRoom({
        phase: "voting",
        proposals: [candidate],
        activeProposalId: "proposal-1",
        votes: [
          {
            proposalId: "proposal-1",
            participantId: "participant-product",
            choice: "support",
            comment: null,
            updatedAt: demoTimestamp(5),
          },
          {
            proposalId: "proposal-other",
            participantId: "participant-marketing",
            choice: "oppose",
            comment: null,
            updatedAt: demoTimestamp(5),
          },
        ],
      }),
    );

    expect(view.consensus.voteProgress).toBeCloseTo(0.25);
    expect(
      view.participants.find((p) => p.id === "participant-product")?.vote,
    ).toBe("support");
    expect(
      view.participants.find((p) => p.id === "participant-marketing")?.vote,
    ).toBeNull();
  });

  it("never counts an approval of a superseded plan towards the current one", () => {
    const view = createFloorPlanState(
      withRoom({
        phase: "approval",
        proposals: [candidate],
        activeProposalId: "proposal-1",
        approvals: [
          {
            participantId: "participant-product",
            decisionHash: "hash-current",
            approvedAt: demoTimestamp(6),
          },
          {
            participantId: "participant-engineering",
            decisionHash: "hash-current",
            approvedAt: demoTimestamp(6),
          },
          {
            participantId: "participant-marketing",
            decisionHash: "hash-superseded",
            approvedAt: demoTimestamp(5),
          },
        ],
      }),
    );

    // Three participants require approval; only the two on the current hash count.
    expect(view.consensus.approvalProgress).toBeCloseTo(2 / 3);
    expect(
      view.participants.find((p) => p.id === "participant-marketing")
        ?.hasApprovedCurrentDecision,
    ).toBe(false);
  });

  it("surfaces open conflicts and blocking severity for the common area", () => {
    const view = createFloorPlanState(
      withRoom({
        phase: "deliberation",
        proposals: [candidate],
        activeProposalId: "proposal-1",
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
            constraintId: "constraint-2",
            raisedByActorType: "participant",
            raisedByActorId: "participant-design",
            severity: "warning",
            reason: "Accessibility review has not happened.",
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

    expect(view.common.openConflicts).toHaveLength(1);
    expect(view.common.blockingCount).toBe(1);
    expect(view.common.warningCount).toBe(0);
    expect(view.consensus.hasBlockingConflict).toBe(true);
  });

  it("resolves activity actor names for display", () => {
    const view = createFloorPlanState(demoRoom);
    const named = view.activity.filter((event) => event.actorId !== null);

    expect(view.activity).toHaveLength(demoRoom.activity.length);
    expect(named.every((event) => event.actorName !== "Unknown actor")).toBe(true);
    expect(
      view.activity.find((event) => event.actorType === "system")?.actorName,
    ).toBe("System");
  });
});

describe("zone ids", () => {
  it("round-trips an office index", () => {
    expect(officeIndexOf(officeZoneId(7))).toBe(7);
  });

  it("rejects anything that is not an office", () => {
    expect(officeIndexOf("meeting-room")).toBeNull();
    expect(officeIndexOf("common-area")).toBeNull();
    expect(officeIndexOf("office-99")).toBeNull();
  });
});

describe("initialsOf", () => {
  it("takes the first and last name", () => {
    expect(initialsOf("Maya Okonkwo")).toBe("MO");
    expect(initialsOf("Emre Yilmaz")).toBe("EY");
  });

  it("falls back to two letters of a single name", () => {
    expect(initialsOf("Ada")).toBe("AD");
  });
});
