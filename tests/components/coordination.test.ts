import { describe, expect, it } from "vitest";
import {
  deriveCoordinationStatus,
  shortDecisionHash,
} from "@/components/room/coordination";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import type { RoomState } from "@/contracts/room";

/**
 * B2: the visible coordination story.
 *
 * Every case here is the screen's answer to a question an agent also asks
 * through WebMCP — where are we, who are we waiting for, can we move on. The
 * two must agree, so this pins the wording and, more importantly, the
 * semantics: silence is never agreement, removed people are never pending
 * work, and a warning is never counted as a blocker.
 */

function room(apply: (draft: RoomState) => void): RoomState {
  const draft = structuredClone(demoRoom);
  draft.demoMode = null;
  apply(draft);
  return draft;
}

const PROPOSAL = {
  id: "proposal-1",
  participantId: "participant-product",
  title: "Two-week accessible onboarding scope",
  summary: "Ship a narrower onboarding update.",
  rationale: "It balances scope, quality, and launch timing.",
  expectedOutcomes: ["Faster first value"],
  referencedConstraintIds: [],
  referencedSourceIds: [],
  parentProposalId: null,
  status: "candidate" as const,
  createdAt: demoTimestamp(10),
};

describe("coordination status", () => {
  it("names every human who has not marked input ready", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        for (const participant of draft.participants) {
          if (participant.kind !== "human") continue;
          participant.isClaimed = true;
          participant.isReady = participant.id !== "participant-engineering";
        }
      }),
    );

    expect(status.phaseLabel).toBe("Input");
    expect(status.progressLabel).toBe("2 / 3 ready");
    expect(status.waitingFor).toEqual(["Emre Yilmaz"]);
    expect(status.waitingLine).toBe(
      "Waiting for Emre Yilmaz to mark input ready.",
    );
    expect(status.advanceHint).toContain("Input stays open");
  });

  it("distinguishes not joined, shared but not ready, and ready", () => {
    const status = deriveCoordinationStatus(demoRoom);
    const detail = new Map(status.people.map((person) => [person.name, person.detail]));

    // Maya has published a position but has not claimed her seat; Emre has
    // claimed his and shared nothing.
    expect(detail.get("Maya Okonkwo")).toBe("Has not joined yet");
    expect(detail.get("Emre Yilmaz")).toBe("Nothing shared yet");
  });

  it("does not count a removed participant as pending work", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        for (const participant of draft.participants) {
          if (participant.kind !== "human") continue;
          participant.isClaimed = true;
          participant.isReady = true;
        }
        const removed = draft.participants.find(
          (participant) => participant.id === "participant-marketing",
        )!;
        removed.status = "removed";
        removed.isReady = false;
        removed.removedAt = demoTimestamp(9);
      }),
    );

    expect(status.people.map((person) => person.name)).not.toContain("Tomas Reyes");
    expect(status.waitingFor).toEqual([]);
    expect(status.waitingLine).toBe("Everyone has marked their input ready.");
  });

  it("says who put the active option on the table", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "proposals";
        draft.proposals = [PROPOSAL];
        draft.activeProposalId = "proposal-1";
      }),
    );

    expect(status.facts).toContainEqual({
      label: "On the table",
      value: "Two-week accessible onboarding scope",
      warn: false,
    });
    expect(status.facts).toContainEqual({ label: "Proposed by", value: "Maya Okonkwo" });
    expect(status.advanceHint).toContain("Deliberation can open");
  });

  it("counts blockers and warnings separately, and only blockers hold the room", () => {
    const base = (severity: "blocking" | "warning") =>
      room((draft) => {
        draft.phase = "deliberation";
        draft.proposals = [PROPOSAL];
        draft.activeProposalId = "proposal-1";
        draft.conflicts = [
          {
            id: "conflict-1",
            proposalId: "proposal-1",
            constraintId: null,
            raisedByActorType: "participant",
            raisedByActorId: "participant-engineering",
            severity,
            reason: "The accessibility review cannot be dropped.",
            status: "open",
            resolvedByActorType: null,
            resolvedByActorId: null,
            resolutionNote: null,
            createdAt: demoTimestamp(11),
            resolvedAt: null,
          },
        ];
      });

    const blocked = deriveCoordinationStatus(base("blocking"));
    expect(blocked.progressLabel).toBe("1 blocking · 0 warnings");
    expect(blocked.waitingFor).toEqual(["Emre Yilmaz’s blocking objection"]);
    expect(blocked.advanceHint).toContain("Alignment opens once");

    const warned = deriveCoordinationStatus(base("warning"));
    expect(warned.progressLabel).toBe("0 blocking · 1 warning");
    expect(warned.waitingFor).toEqual([]);
    expect(warned.waitingLine).toContain("none of them block the room");
    expect(warned.advanceHint).toBe("Nothing blocking. Alignment can open.");
  });

  it("reads a missing alignment as Waiting, never as neutrality or support", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "voting";
        draft.proposals = [PROPOSAL];
        draft.activeProposalId = "proposal-1";
        draft.alignments = [
          {
            proposalId: "proposal-1",
            participantId: "participant-product",
            choice: "support",
            comment: null,
            updatedAt: demoTimestamp(12),
          },
        ];
      }),
    );

    const detail = new Map(status.people.map((person) => [person.name, person.detail]));
    expect(detail.get("Maya Okonkwo")).toBe("Support");
    expect(detail.get("Emre Yilmaz")).toBe("Waiting");
    expect(status.progressLabel).toBe("1 / 3 shared");
    expect(status.waitingLine).toBe("Not heard from Emre Yilmaz and Tomas Reyes yet.");
    expect(status.advanceHint).toContain("not a vote");
  });

  it("names the missing approvers of the exact frozen decision", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "approval";
        draft.proposals = [PROPOSAL];
        draft.activeProposalId = "proposal-1";
        draft.finalDecisionPreview = {
          proposal: PROPOSAL,
          rationale: "It balances scope, quality, and launch timing.",
          acceptedTradeoffs: [],
          unresolvedWarnings: [],
          alignments: [],
          decisionPolicy: "equal_authority_consensus",
          owners: [],
          deadlines: [],
          actionItems: [],
          dissent: [],
          sourceProvenance: [],
          requiredApprovalParticipantIds: ["participant-product", "participant-engineering"],
          expertAdvice: [],
          decisionHash: "0123456789abcdef0123456789abcdef",
          approvals: [],
          missingApprovalParticipantIds: [
            "participant-product",
            "participant-engineering",
          ],
        };
        draft.approvals = [
          {
            participantId: "participant-product",
            decisionHash: "0123456789abcdef0123456789abcdef",
            approvedAt: demoTimestamp(13),
          },
        ];
      }),
    );

    expect(status.progressLabel).toBe("1 / 2 approved");
    expect(status.waitingFor).toEqual(["Emre Yilmaz"]);
    expect(status.waitingParticipantIds).toEqual(["participant-engineering"]);
    expect(status.facts).toContainEqual({
      label: "Frozen as",
      value: "0123456789ab…",
    });
    expect(status.facts).toContainEqual({
      label: "Confirmation",
      value: "A person confirms, never an agent",
    });
    expect(status.advanceHint).toContain("Only the approver's own confirmation");
  });

  it("says nothing can be approved before a decision is frozen", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "approval";
      }),
    );

    expect(status.people).toEqual([]);
    expect(status.facts).toContainEqual({ label: "Decision", value: "Not frozen yet", warn: true });
    expect(status.waitingLine).toContain("open the exact decision for review");
  });

  it("shortens a decision hash without pretending it is the whole one", () => {
    expect(shortDecisionHash("0123456789abcdef")).toBe("0123456789ab…");
    expect(shortDecisionHash("short")).toBe("short");
  });
});

/**
 * B8: the ids the 3D room marks a seat with.
 *
 * Narrower than `waitingFor` on purpose. A chair can honestly say "the room is
 * waiting on you"; it cannot say "the room is waiting for an option to exist",
 * and marking somebody's seat for that would invent pressure the coordination
 * story never claimed.
 */
describe("waitingParticipantIds", () => {
  it("holds the people who have not marked input ready", () => {
    expect(deriveCoordinationStatus(demoRoom).waitingParticipantIds).toEqual([
      "participant-product",
      "participant-engineering",
      "participant-marketing",
    ]);
  });

  it("is empty where the room is short of a thing rather than a person", () => {
    const proposals = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "proposals";
      }),
    );
    const deliberation = deriveCoordinationStatus(
      room((draft) => {
        draft.phase = "deliberation";
      }),
    );

    expect(proposals.waitingFor).toEqual(["an option on the table"]);
    expect(proposals.waitingParticipantIds).toEqual([]);
    expect(deliberation.waitingParticipantIds).toEqual([]);
  });

  it("never names a removed participant as pending work", () => {
    const status = deriveCoordinationStatus(
      room((draft) => {
        draft.participants = draft.participants.map((participant) =>
          participant.id === "participant-marketing"
            ? { ...participant, status: "removed" as const }
            : participant,
        );
      }),
    );

    expect(status.waitingParticipantIds).not.toContain("participant-marketing");
  });
});
