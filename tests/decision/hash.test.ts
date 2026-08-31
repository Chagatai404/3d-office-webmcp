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
      referencedSourceIds: ["source-2", "source-1"],
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
    alignments: [
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
    decisionPolicy: "owner_decides",
    owners: [],
    deadlines: [],
    actionItems: [],
    dissent: [],
    sourceProvenance: [
      {
        sourceId: "source-2",
        uploadedByParticipantId: "designer",
        visibility: "shared_room",
        sha256: "b".repeat(64),
        status: "ready",
      },
      {
        sourceId: "source-1",
        uploadedByParticipantId: "engineer",
        visibility: "shared_room",
        sha256: "a".repeat(64),
        status: "ready",
      },
    ],
    requiredApprovalParticipantIds: ["engineer", "designer"],
    expertAdvice: [],
  };
}

describe("canonical final decision hashing", () => {
  it("is stable across object construction and semantic-set ordering", async () => {
    const first = candidate();
    const second = {
      requiredApprovalParticipantIds: ["designer", "engineer"],
      dissent: [],
      sourceProvenance: [...first.sourceProvenance].reverse(),
      expertAdvice: [],
      actionItems: [],
      deadlines: [],
      owners: [],
      decisionPolicy: first.decisionPolicy,
      alignments: [...first.alignments].reverse(),
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
        referencedSourceIds: [...first.proposal.referencedSourceIds].reverse(),
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
    ["alignment data", (value: FinalDecisionCandidate) => {
      value.alignments[0]!.choice = "concern";
      value.dissent = ["Designer: concern"];
    }],
    ["decision policy", (value: FinalDecisionCandidate) => {
      value.decisionPolicy = "equal_authority_consensus";
    }],
    ["cited source ids", (value: FinalDecisionCandidate) => {
      value.proposal.referencedSourceIds = ["source-9"];
    }],
    ["source provenance hash", (value: FinalDecisionCandidate) => {
      value.sourceProvenance[0]!.sha256 = "f".repeat(64);
    }],
    ["source provenance membership", (value: FinalDecisionCandidate) => {
      value.sourceProvenance = value.sourceProvenance.slice(0, 1);
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
