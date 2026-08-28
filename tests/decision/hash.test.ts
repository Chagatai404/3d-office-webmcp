import { describe, expect, it } from "vitest";
import type { FinalDecisionCandidate } from "@/contracts/room";
import {
  hashDecisionCandidate,
  serializeDecisionCandidate,
} from "@/domain/rooms/decision";

const createdAt = "2026-08-28T12:00:00.000Z";

function candidate(): FinalDecisionCandidate {
  return {
    proposal: {
      id: "proposal-2",
      participantId: "engineer",
      title: "Accessible thin slice",
      summary: "Ship the focused onboarding hints.",
      rationale: "Fits capacity and accessibility constraints.",
      expectedOutcomes: ["Accessible navigation", "Faster first value"],
      referencedConstraintIds: ["constraint-2", "constraint-1"],
      parentProposalId: "proposal-1",
      status: "candidate",
      createdAt,
    },
    rationale: "Fits capacity and accessibility constraints.",
    acceptedTradeoffs: [{
      id: "tradeoff-1",
      conflictIds: ["conflict-2", "conflict-1"],
      createdByActorType: "participant",
      createdByActorId: "engineer",
      description: "Reduce scope and define focus order.",
      expectedEffect: "Addresses delivery and accessibility concerns.",
      resultingProposalId: "proposal-2",
      createdAt,
    }],
    unresolvedWarnings: [{
      id: "warning-1",
      proposalId: "proposal-2",
      constraintId: "constraint-3",
      raisedByActorType: "participant",
      raisedByActorId: "designer",
      severity: "warning",
      reason: "Validate with screen readers before launch.",
      status: "open",
      resolvedByActorType: null,
      resolvedByActorId: null,
      resolutionNote: null,
      createdAt,
      resolvedAt: null,
    }],
    votes: [
      {
        proposalId: "proposal-2",
        participantId: "designer",
        choice: "support",
        comment: "Accessibility validation is included.",
        updatedAt: createdAt,
      },
      {
        proposalId: "proposal-2",
        participantId: "engineer",
        choice: "support",
        comment: null,
        updatedAt: createdAt,
      },
    ],
    owners: [],
    deadlines: [],
    actionItems: [],
    dissent: [],
    requiredApprovalParticipantIds: ["engineer", "designer"],
  };
}

describe("canonical final decision hashing", () => {
  it("is stable across object construction and semantic-set ordering", async () => {
    const first = candidate();
    const second = {
      requiredApprovalParticipantIds: ["designer", "engineer"],
      dissent: [],
      actionItems: [],
      deadlines: [],
      owners: [],
      votes: [...first.votes].reverse(),
      unresolvedWarnings: first.unresolvedWarnings,
      acceptedTradeoffs: [{
        ...first.acceptedTradeoffs[0]!,
        conflictIds: [...first.acceptedTradeoffs[0]!.conflictIds].reverse(),
      }],
      rationale: first.rationale,
      proposal: {
        ...first.proposal,
        expectedOutcomes: [...first.proposal.expectedOutcomes].reverse(),
        referencedConstraintIds: [...first.proposal.referencedConstraintIds].reverse(),
      },
    } satisfies FinalDecisionCandidate;

    expect(serializeDecisionCandidate(second)).toBe(serializeDecisionCandidate(first));
    await expect(hashDecisionCandidate(second)).resolves.toBe(
      await hashDecisionCandidate(first),
    );
  });

  it.each([
    ["proposal summary", (value: FinalDecisionCandidate) => {
      value.proposal.summary = "A materially changed delivery plan.";
    }],
    ["accepted tradeoff", (value: FinalDecisionCandidate) => {
      value.acceptedTradeoffs[0]!.expectedEffect = "A different compromise.";
    }],
    ["unresolved warning", (value: FinalDecisionCandidate) => {
      value.unresolvedWarnings[0]!.reason = "A new warning.";
    }],
    ["vote data", (value: FinalDecisionCandidate) => {
      value.votes[0]!.choice = "abstain";
      value.dissent = ["Designer: abstain"];
    }],
  ])("changes when approval-sensitive %s changes", async (_name, mutate) => {
    const baseline = candidate();
    const changed = structuredClone(baseline);
    mutate(changed);
    expect(await hashDecisionCandidate(changed)).not.toBe(
      await hashDecisionCandidate(baseline),
    );
  });
});
