// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlignmentWorkspace } from "@/components/room/alignment-workspace";
import { DecisionWorkspace } from "@/components/room/decision-workspace";
import { IssuesWorkspace } from "@/components/room/issues-workspace";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { RoomProvider } from "@/components/room/room-provider";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { setRoomClientForTests } from "@/room-client/room-client";
import type {
  ActionResult,
  Alignment,
  Approval,
  Conflict,
  DecisionRecord,
  FinalDecisionPreview,
  Proposal,
  RoomClient,
  RoomPhase,
  RoomState,
  Tradeoff,
} from "@/contracts/room";

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

type Listener = (state: RoomState) => void;

class FakeRoomClient implements RoomClient {
  state: RoomState;
  readonly submitProposalCalls: Parameters<RoomClient["submitProposal"]>[1][] = [];
  readonly raiseObjectionCalls: Parameters<RoomClient["raiseObjection"]>[1][] = [];
  readonly proposeTradeoffCalls: Parameters<RoomClient["proposeTradeoff"]>[1][] = [];
  readonly resolveObjectionCalls: Parameters<RoomClient["resolveObjection"]>[1][] = [];
  readonly expressMyAlignmentCalls: Parameters<RoomClient["expressMyAlignment"]>[1][] = [];
  readonly approveFinalDecisionCalls: Parameters<RoomClient["approveFinalDecision"]>[1][] = [];
  readonly setDecisionPolicyCalls: Parameters<RoomClient["setDecisionPolicy"]>[1][] = [];
  readonly setParticipantDecisionRoleCalls: Parameters<RoomClient["setParticipantDecisionRole"]>[1][] = [];
  previewCalls = 0;
  recordCalls = 0;
  private readonly listeners = new Set<Listener>();

  constructor(seed: RoomState) {
    this.state = structuredClone(seed);
  }

  async getRoom(roomId: string): Promise<RoomState> {
    if (roomId !== this.state.id) throw new Error(`Unknown room: ${roomId}`);
    return this.snapshot();
  }

  subscribe(roomId: string, callback: Listener): () => void {
    if (roomId !== this.state.id) return () => {};

    this.listeners.add(callback);
    queueMicrotask(() => {
      if (this.listeners.has(callback)) callback(this.snapshot());
    });
    return () => {
      this.listeners.delete(callback);
    };
  }

  claimSeat: RoomClient["claimSeat"] = async () => this.ok("Seat claimed.");
  addMyPosition: RoomClient["addMyPosition"] = async () =>
    this.ok("Position added.");

  submitProposal: RoomClient["submitProposal"] = async (_roomId, input) => {
    this.submitProposalCalls.push(input);
    return this.ok("Proposal submitted.");
  };

  raiseObjection: RoomClient["raiseObjection"] = async (_roomId, input) => {
    this.raiseObjectionCalls.push(input);
    return this.ok("Objection raised.");
  };

  resolveObjection: RoomClient["resolveObjection"] = async (_roomId, input) => {
    this.resolveObjectionCalls.push(input);
    return this.ok("Objection resolved.");
  };

  proposeTradeoff: RoomClient["proposeTradeoff"] = async (_roomId, input) => {
    this.proposeTradeoffCalls.push(input);
    return this.ok("Tradeoff proposed.");
  };

  expressMyAlignment: RoomClient["expressMyAlignment"] = async (_roomId, input) => {
    this.expressMyAlignmentCalls.push(input);
    return this.ok("Alignment shared.");
  };

  previewFinalDecision: RoomClient["previewFinalDecision"] = async () => {
    this.previewCalls += 1;
    const preview = this.state.finalDecisionPreview;
    if (!preview) {
      return {
        ok: false,
        error: {
          code: "WRONG_PHASE",
          message: "No preview is available.",
        },
        roomVersion: this.state.version,
      };
    }
    return this.ok("Exact final decision loaded.", preview);
  };

  approveFinalDecision: RoomClient["approveFinalDecision"] = async (_roomId, input) => {
    this.approveFinalDecisionCalls.push(input);
    return this.ok("Approval recorded.");
  };

  getDecisionRecord: RoomClient["getDecisionRecord"] = async () => {
    this.recordCalls += 1;
    return this.ok("Immutable decision record loaded.", decisionRecord(this.state));
  };

  startDemoScenario: RoomClient["startDemoScenario"] = async () =>
    this.ok("Scenario started.");
  advanceDemoPhase: RoomClient["advanceDemoPhase"] = async () =>
    this.ok("Demo phase advanced.");
  markMyInputReady: RoomClient["markMyInputReady"] = async () =>
    this.ok("Ready recorded.");
  advanceRoomPhase: RoomClient["advanceRoomPhase"] = async (
    _roomId,
    phase: RoomPhase,
  ) => {
    this.publish((draft) => {
      draft.phase = phase;
    });
    return this.ok(`Room phase advanced to ${phase}.`);
  };

  listJoinRequests: RoomClient["listJoinRequests"] = async () =>
    this.ok("Waiting room loaded.", []);
  admitJoinRequest: RoomClient["admitJoinRequest"] = async () => {
    throw new Error("Not used by this test.");
  };
  rejectJoinRequest: RoomClient["rejectJoinRequest"] = async () => {
    throw new Error("Not used by this test.");
  };
  lockMeeting: RoomClient["lockMeeting"] = async () => {
    throw new Error("Not used by this test.");
  };
  unlockMeeting: RoomClient["unlockMeeting"] = async () => {
    throw new Error("Not used by this test.");
  };
  removeParticipant: RoomClient["removeParticipant"] = async () => {
    throw new Error("Not used by this test.");
  };
  transferOwnership: RoomClient["transferOwnership"] = async () => {
    throw new Error("Not used by this test.");
  };
  setDecisionPolicy: RoomClient["setDecisionPolicy"] = async (_roomId, input) => {
    this.setDecisionPolicyCalls.push(input);
    return this.ok("Decision policy updated.");
  };
  setParticipantDecisionRole: RoomClient["setParticipantDecisionRole"] = async (_roomId, input) => {
    this.setParticipantDecisionRoleCalls.push(input);
    return this.ok("Decision authority updated.");
  };
  configureParticipant: RoomClient["configureParticipant"] = async () => this.ok("Participant configured.");

  publish(apply: (draft: RoomState) => void) {
    const draft = this.snapshot();
    apply(draft);
    draft.version += 1;
    this.state = draft;
    for (const listener of this.listeners) listener(this.snapshot());
  }

  private snapshot(): RoomState {
    return structuredClone(this.state);
  }

  private ok<T = null>(message: string, data: T = null as T): ActionResult<T> {
    return {
      ok: true,
      data,
      roomVersion: this.state.version,
      message,
    };
  }
}

function proposal(id = "proposal-1", parentProposalId: string | null = null): Proposal {
  return {
    id,
    participantId: "participant-product",
    title:
      id === "proposal-1"
        ? "Two-week accessible onboarding scope"
        : "Revised two-week accessible onboarding scope",
    summary:
      "Focus the release on a smaller onboarding step with accessibility review kept in scope.",
    rationale:
      "This protects launch timing, product impact, and implementation capacity.",
    expectedOutcomes: ["Faster first value", "Accessibility review completed"],
    referencedConstraintIds: ["constraint-1", "constraint-3", "constraint-5"],
    parentProposalId,
    status: "candidate",
    createdAt: demoTimestamp(id === "proposal-1" ? 5 : 7),
  };
}

function conflict(status: Conflict["status"] = "open"): Conflict {
  return {
    id: "conflict-1",
    proposalId: "proposal-1",
    constraintId: "constraint-3",
    raisedByActorType: "participant",
    raisedByActorId: "participant-engineering",
    severity: "blocking",
    reason: "The accessibility review cannot be dropped.",
    status,
    resolvedByActorType: status === "resolved" ? "participant" : null,
    resolvedByActorId: status === "resolved" ? "participant-engineering" : null,
    resolutionNote: status === "resolved" ? "Accessibility review stays in scope." : null,
    createdAt: demoTimestamp(6),
    resolvedAt: status === "resolved" ? demoTimestamp(8) : null,
  };
}

function tradeoff(): Tradeoff {
  return {
    id: "tradeoff-1",
    conflictIds: ["conflict-1"],
    createdByActorType: "participant",
    createdByActorId: "participant-engineering",
    description: "Reduce release scope instead of removing accessibility review.",
    expectedEffect: "The blocking concern is handled without moving the launch.",
    resultingProposalId: "proposal-2",
    createdAt: demoTimestamp(7),
  };
}

function alignmentEntry(participantId: string, choice: Alignment["choice"] = "support"): Alignment {
  return {
    proposalId: "proposal-1",
    participantId,
    choice,
    comment: null,
    updatedAt: demoTimestamp(9),
  };
}

function approval(participantId: string): Approval {
  return {
    participantId,
    decisionHash: "hash-v1",
    approvedAt: demoTimestamp(10),
  };
}

function finalPreview(hash = "hash-v1"): FinalDecisionPreview {
  const baseProposal = proposal();
  return {
    proposal: baseProposal,
    rationale: baseProposal.rationale,
    acceptedTradeoffs: [tradeoff()],
    unresolvedWarnings: [],
    alignments: [
      alignmentEntry("participant-product"),
      alignmentEntry("participant-engineering"),
      alignmentEntry("participant-marketing", "concern"),
    ],
    decisionPolicy: "equal_authority_consensus",
    owners: [
      {
        participantId: "participant-product",
        responsibility: "Own launch scope.",
      },
    ],
    deadlines: [
      {
        label: "Campaign cutoff",
        dueAt: demoTimestamp(20),
      },
    ],
    actionItems: [
      {
        id: "action-1",
        text: "Schedule accessibility review.",
        ownerParticipantId: "participant-design",
        dueAt: null,
      },
    ],
    dissent: ["Marketing raised a concern until launch copy is reviewed."],
    expertAdvice: [],
    requiredApprovalParticipantIds: [
      "participant-product",
      "participant-engineering",
      "participant-marketing",
    ],
    decisionHash: hash,
    approvals: hash === "hash-v1" ? [approval("participant-product")] : [],
    missingApprovalParticipantIds:
      hash === "hash-v1"
        ? ["participant-engineering", "participant-marketing"]
        : ["participant-product", "participant-engineering", "participant-marketing"],
  };
}

function decisionRecord(room: RoomState): DecisionRecord {
  const decision = room.finalDecisionPreview ?? finalPreview();
  return {
    roomId: room.id,
    finalizedAt: room.finalizedAt ?? demoTimestamp(11),
    decision,
    acceptedTradeoffs: decision.acceptedTradeoffs,
    alignments: decision.alignments,
    approvals: decision.approvals,
    provenance: room.activity,
  };
}

function roomInPhase(phase: RoomPhase): RoomState {
  const room = structuredClone(demoRoom);
  room.demoMode = null;
  room.phase = phase;
  room.version = 20;
  room.selfParticipantId = "participant-engineering";
  room.participants = room.participants.map((participant) => ({
    ...participant,
    isClaimed: participant.kind === "human" ? true : participant.isClaimed,
    isReady: true,
  }));
  room.proposals = [proposal()];
  room.activeProposalId = "proposal-1";

  if (phase === "deliberation") room.conflicts = [conflict()];
  if (phase === "approval" || phase === "finalized") {
    room.conflicts = [conflict("resolved")];
    room.tradeoffs = [tradeoff()];
    room.alignments = finalPreview().alignments;
    room.finalDecisionPreview = finalPreview();
  }
  if (phase === "finalized") {
    room.finalizedAt = demoTimestamp(11);
    room.approvals = finalPreview().approvals;
  }

  return room;
}

async function mount(client: FakeRoomClient, ui: React.ReactElement) {
  setRoomClientForTests(client);
  await act(async () => {
    root.render(<RoomProvider roomId={client.state.id}>{ui}</RoomProvider>);
  });
  await act(async () => {});
}

function byTestId<T extends HTMLElement>(testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`Missing [data-testid="${testId}"].`);
  return element;
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`No button including "${label}".`);
  return button;
}

function setValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

async function submit(testId: string) {
  await act(async () => {
    byTestId<HTMLFormElement>(testId).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setRoomClientForTests(null);
});

describe("proposals workspace", () => {
  it("shows the active candidate and submits proposals in the proposals phase", async () => {
    const client = new FakeRoomClient(roomInPhase("proposals"));
    await mount(client, <ProposalsWorkspace />);

    expect(container.textContent).toContain("Active proposal");
    expect(container.textContent).toContain("candidate board");

    await submit("proposal-form");

    expect(client.submitProposalCalls).toHaveLength(1);
    expect(client.submitProposalCalls[0]).toMatchObject({
      title: "Two-week accessible onboarding scope",
      parentProposalId: null,
    });
    expect(client.submitProposalCalls[0]?.referencedConstraintIds).toContain(
      "constraint-3",
    );
  });
});

describe("issues workspace", () => {
  it("keeps objections, tradeoffs, and explicit resolutions as separate actions", async () => {
    const client = new FakeRoomClient(roomInPhase("deliberation"));
    await mount(client, <IssuesWorkspace />);

    setValue(
      byTestId<HTMLFormElement>("objection-form").querySelector<HTMLTextAreaElement>(
        'textarea[name="reason"]',
      )!,
      "The proposal still weakens accessibility review.",
    );
    await submit("objection-form");
    await submit("tradeoff-form");
    setValue(
      byTestId<HTMLElement>("resolution-panel").querySelector<HTMLTextAreaElement>(
        "textarea",
      )!,
      "The revised proposal keeps the accessibility review.",
    );
    await click(buttonNamed("Resolve explicitly"));

    expect(client.raiseObjectionCalls).toEqual([
      expect.objectContaining({
        proposalId: "proposal-1",
        reason: "The proposal still weakens accessibility review.",
        severity: "blocking",
      }),
    ]);
    expect(client.proposeTradeoffCalls[0]).toMatchObject({
      conflictIds: ["conflict-1"],
      revisedProposal: expect.objectContaining({
        referencedConstraintIds: ["constraint-1", "constraint-3", "constraint-5"],
      }),
    });
    expect(
      "parentProposalId" in client.proposeTradeoffCalls[0]!.revisedProposal!,
    ).toBe(false);
    expect(client.resolveObjectionCalls).toEqual([
      {
        conflictId: "conflict-1",
        resolutionNote: "The revised proposal keeps the accessibility review.",
      },
    ]);
    expect(container.textContent).toContain(
      "Alignment cannot open until they are settled.",
    );
  });
});

describe("alignment workspace", () => {
  it("shares only the current participant's alignment and states it is not a vote", async () => {
    const client = new FakeRoomClient(roomInPhase("voting"));
    await mount(client, <AlignmentWorkspace />);

    await click(byTestId<HTMLButtonElement>("alignment-choice-strong_objection"));

    expect(client.expressMyAlignmentCalls).toEqual([
      {
        proposalId: "proposal-1",
        choice: "strong_objection",
        comment: null,
      },
    ]);
    expect("participantId" in client.expressMyAlignmentCalls[0]!).toBe(false);
    expect(container.textContent).toContain("It is not a vote");
  });

  it("shows the owner a compact alignment summary without implying a vote count decides anything", async () => {
    const room = roomInPhase("voting");
    room.selfParticipantId = room.ownerParticipantId;
    const client = new FakeRoomClient(room);
    await mount(client, <AlignmentWorkspace />);

    expect(byTestId("owner-alignment-summary")).toBeTruthy();
    expect(container.textContent).not.toContain("Winner");
    expect(container.textContent).not.toContain("Majority");
    expect(container.textContent).not.toContain("Passed vote");
  });
});

describe("decision workspace", () => {
  it("binds approval to the exact current decision hash and resets on hash change", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace />);

    await click(buttonNamed("Refresh exact server preview"));
    expect(client.previewCalls).toBe(1);
    expect(container.textContent).toContain("hash-v1");

    const approvalButton = buttonNamed("Approve this decision");
    const checkbox = byTestId<HTMLElement>("approval-panel").querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;

    expect(approvalButton.disabled).toBe(true);
    await click(checkbox);
    expect(approvalButton.disabled).toBe(false);

    await act(async () => {
      client.publish((draft) => {
        draft.finalDecisionPreview = finalPreview("hash-v2");
      });
    });

    expect(container.textContent).toContain("hash-v2");
    expect(checkbox.checked).toBe(false);
    expect(approvalButton.disabled).toBe(true);
  });

  it("loads the immutable final decision record instead of reconstructing it locally", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace />);

    await click(buttonNamed("Load persisted final record"));

    expect(client.recordCalls).toBe(1);
    expect(container.textContent).toContain("Immutable decision record loaded.");
    expect(container.textContent).toContain("Accepted tradeoffs");
    expect(container.textContent).toContain("Provenance");
  });
});
