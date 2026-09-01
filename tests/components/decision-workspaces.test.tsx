// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlignmentWorkspace } from "@/components/room/alignment-workspace";
import { DecisionWorkspace } from "@/components/room/decision-workspace";
import { IssuesWorkspace } from "@/components/room/issues-workspace";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { RoomProvider } from "@/components/room/room-provider";
import {
  MeetingShellProvider,
  useShell,
  type ShellContextValue,
} from "@/components/shell/shell-provider";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { setRoomClientForTests } from "@/room-client/room-client";
import type {
  ActionResult,
  Alignment,
  Approval,
  Conflict,
  DecisionRecord,
  MeetingReport,
  FinalDecisionPreview,
  Proposal,
  RoomClient,
  RoomPhase,
  RoomState,
  Tradeoff,
} from "@/contracts/room";
import { computeMeetingReport } from "@/domain/rooms/report";

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let shell: ShellContextValue;

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
  reportCalls = 0;
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

  getMeetingReport: RoomClient["getMeetingReport"] = async () => {
    this.reportCalls += 1;
    return this.ok<MeetingReport>(
      "Final meeting report loaded.",
      computeMeetingReport(this.state, decisionRecord(this.state)),
    );
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
    referencedSourceIds: [],
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
    sourceProvenance: [],
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

/* Mounted inside the shell, because that is where these live: the Decision
   surface reads the shell to know whether an agent handed the last step back
   to a person, and the room is the only place that ever mounts it. */
async function mount(client: FakeRoomClient, ui: React.ReactElement) {
  setRoomClientForTests(client);
  await act(async () => {
    root.render(
      <MeetingShellProvider>
        <RoomProvider roomId={client.state.id}>
          <ShellProbe />
          {ui}
        </RoomProvider>
      </MeetingShellProvider>,
    );
  });
  await act(async () => {});
}

/* Publishes the shell after each commit so a test can do what the WebMCP
   confirmation bridge does — hand the last step back to a person — without
   mounting the 3D canvas that normally subscribes to it. */
function ShellProbe() {
  const value = useShell();
  useEffect(() => {
    shell = value;
  }, [value]);
  return null;
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
  // jsdom has no matchMedia; MeetingShellProvider's reduced-motion
  // subscription needs a MediaQueryList-shaped stub.
  window.matchMedia = window.matchMedia ?? ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList));
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
    // The active proposal belongs to participant-product.
    await mount(client, <ProposalsWorkspace tab="participant-product" />);

    expect(container.textContent).toContain("On the table");
    expect(container.textContent).toContain("candidate board");

    await mount(client, <ProposalsWorkspace tab="input" />);

    // B1: the primary surface is one description. Title and rationale are
    // taken from the proposer's own words unless they refine them.
    setValue(
      byTestId<HTMLFormElement>("proposal-form").querySelector<HTMLTextAreaElement>(
        'textarea[name="description"]',
      )!,
      "Ship a two-week accessible onboarding scope. Accessibility review stays in scope.",
    );
    await submit("proposal-form");

    expect(client.submitProposalCalls).toHaveLength(1);
    expect(client.submitProposalCalls[0]).toMatchObject({
      title: "Ship a two-week accessible onboarding scope",
      summary:
        "Ship a two-week accessible onboarding scope. Accessibility review stays in scope.",
      rationale:
        "Ship a two-week accessible onboarding scope. Accessibility review stays in scope.",
      parentProposalId: null,
    });
    expect(client.submitProposalCalls[0]?.referencedConstraintIds).toContain(
      "constraint-3",
    );
  });

  it("prefers an explicitly refined title and rationale over the derived ones", async () => {
    const client = new FakeRoomClient(roomInPhase("proposals"));
    await mount(client, <ProposalsWorkspace tab="input" />);

    const form = byTestId<HTMLFormElement>("proposal-form");
    setValue(
      form.querySelector<HTMLTextAreaElement>('textarea[name="description"]')!,
      "Cut the release down to the single highest-impact onboarding step.",
    );
    setValue(form.querySelector<HTMLInputElement>('input[name="title"]')!, "Narrow first release");
    setValue(
      form.querySelector<HTMLTextAreaElement>('textarea[name="rationale"]')!,
      "It fits the delivery window without dropping the accessibility review.",
    );
    setValue(
      form.querySelector<HTMLTextAreaElement>('textarea[name="expectedOutcomes"]')!,
      "Faster first value\nAccessibility review completed",
    );
    await submit("proposal-form");

    expect(client.submitProposalCalls[0]).toMatchObject({
      title: "Narrow first release",
      summary: "Cut the release down to the single highest-impact onboarding step.",
      rationale: "It fits the delivery window without dropping the accessibility review.",
      expectedOutcomes: ["Faster first value", "Accessibility review completed"],
    });
  });
});

describe("issues workspace", () => {
  it("keeps objection and tradeoff records behind optional disclosures", async () => {
    const client = new FakeRoomClient(roomInPhase("deliberation"));
    await mount(client, <IssuesWorkspace tab="input" />);

    const objectionForm = byTestId<HTMLFormElement>("objection-form");
    const tradeoffForm = byTestId<HTMLFormElement>("tradeoff-form");
    const visibleObjectionControls = [
      ...objectionForm.querySelectorAll("input, select, textarea"),
    ].filter((element) => element.closest("details") === null);
    const visibleTradeoffControls = [
      ...tradeoffForm.querySelectorAll("input, select, textarea"),
    ].filter((element) => element.closest("details") === null);

    expect(visibleObjectionControls).toHaveLength(1);
    expect((visibleObjectionControls[0] as HTMLTextAreaElement).name).toBe("reason");
    expect(visibleTradeoffControls).toHaveLength(1);
    expect((visibleTradeoffControls[0] as HTMLTextAreaElement).name).toBe("description");
    expect(objectionForm.querySelector("details")?.open).toBe(false);
    expect(tradeoffForm.querySelector("details")?.open).toBe(false);

    const objectionDetailNames = [
      ...objectionForm.querySelectorAll("details input, details select, details textarea"),
    ].map((element) => (element as HTMLInputElement).name);
    const tradeoffDetailNames = [
      ...tradeoffForm.querySelectorAll("details input, details select, details textarea"),
    ].map((element) => (element as HTMLInputElement).name);
    expect(objectionDetailNames).toEqual(expect.arrayContaining(["constraintId", "severity"]));
    expect(tradeoffDetailNames).toEqual(
      expect.arrayContaining([
        "expectedEffect",
        "revisedTitle",
        "revisedSummary",
        "revisedRationale",
        "revisedOutcomes",
      ]),
    );
  });

  it("keeps objections, tradeoffs, and explicit resolutions as separate actions", async () => {
    const client = new FakeRoomClient(roomInPhase("deliberation"));
    await mount(client, <IssuesWorkspace tab="input" />);

    setValue(
      byTestId<HTMLFormElement>("objection-form").querySelector<HTMLTextAreaElement>(
        'textarea[name="reason"]',
      )!,
      "The proposal still weakens accessibility review.",
    );
    await submit("objection-form");
    setValue(
      byTestId<HTMLFormElement>("tradeoff-form").querySelector<HTMLTextAreaElement>(
        'textarea[name="description"]',
      )!,
      "Keep the accessibility review and narrow the first release instead.",
    );
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
      description: "Keep the accessibility review and narrow the first release instead.",
      expectedEffect: "Keep the accessibility review and narrow the first release instead.",
      revisedProposal: expect.objectContaining({
        summary: "Keep the accessibility review and narrow the first release instead.",
        rationale: "Keep the accessibility review and narrow the first release instead.",
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
    // B2: blockers and warnings are counted separately and named in words,
    // so "1 blocking" can never be read as "1 issue, unspecified". The tally
    // is part of the per-participant view, not the input tab just used.
    await mount(client, <IssuesWorkspace tab="participant-engineering" />);
    expect(byTestId("issues-tally").textContent).toContain("1 blocking objection");
    expect(byTestId("issues-tally").textContent).toContain("no open warnings");
    expect(container.textContent).toContain(
      "Alignment opens once every blocking objection is settled.",
    );
  });

  it("names a warning as a warning and says the room is not blocked by it", async () => {
    const seed = roomInPhase("deliberation");
    for (const conflict of seed.conflicts) {
      conflict.severity = "warning";
    }
    const client = new FakeRoomClient(seed);
    await mount(client, <IssuesWorkspace tab="participant-engineering" />);

    expect(byTestId("issues-tally").textContent).toContain("Nothing blocking");
    expect(byTestId("issues-tally").textContent).toContain("1 open warning, not blocking");
    expect(container.textContent).toContain(
      "Warnings travel with the decision instead of stopping it.",
    );
  });
});

describe("alignment workspace", () => {
  it("shares only the current participant's alignment and states it is not a vote", async () => {
    const client = new FakeRoomClient(roomInPhase("voting"));
    await mount(client, <AlignmentWorkspace tab="input" />);

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
    await mount(client, <AlignmentWorkspace tab="input" />);

    expect(byTestId("owner-alignment-summary")).toBeTruthy();
    expect(container.textContent).not.toContain("Winner");
    expect(container.textContent).not.toContain("Majority");
    expect(container.textContent).not.toContain("Passed vote");
  });
});

describe("decision workspace", () => {
  it("binds approval to the exact current decision hash and resets on hash change", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace tab="input" />);

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

  /*
   * B7: once the room is finalized, the decision surface stops being a review
   * and becomes the report. Same place in the room, one artifact — and the
   * artifact is the server's record, never a local reconstruction.
   */
  it("becomes the shared report once the room is finalized, without being asked", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace tab="input" />);

    expect(client.reportCalls).toBe(1);
    expect(client.recordCalls).toBe(1);
    expect(byTestId("final-report")).toBeTruthy();
    expect(container.querySelector('[data-testid="approval-panel"]')).toBeNull();
    expect(container.textContent).toContain("Decision report");
    expect(container.textContent).toContain("Why we chose it");
    expect(container.textContent).toContain("Trade-offs");
    expect(container.textContent).toContain("Provenance");
  });

  /*
   * Regression: `isOwner` used to be gated on `room.demoMode === null`, which
   * made it permanently false for every demo room (demoMode is never null
   * there) -- the confirm checkbox and "Make final decision" button never
   * rendered for the demo room's owner, at any phase. This asserts the owner
   * confirmation control renders and works under `owner_decides` with a
   * non-null demoMode, exactly the state the demo room is always in.
   */
  it("still lets the owner make the final decision when the room is a demo room (demoMode !== null)", async () => {
    const room = roomInPhase("approval");
    room.demoMode = "solo_judge";
    room.decisionPolicy = "owner_decides";
    room.selfParticipantId = room.ownerParticipantId;
    room.finalDecisionPreview = {
      ...finalPreview(),
      decisionPolicy: "owner_decides",
      requiredApprovalParticipantIds: [room.ownerParticipantId],
      approvals: [],
      missingApprovalParticipantIds: [room.ownerParticipantId],
    };
    const client = new FakeRoomClient(room);
    await mount(client, <DecisionWorkspace tab="input" />);

    await click(buttonNamed("Refresh exact server preview"));

    const approvalButton = buttonNamed("Make final decision");
    const checkbox = byTestId<HTMLElement>("approval-panel").querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(approvalButton.disabled).toBe(true);

    await click(checkbox);
    expect(approvalButton.disabled).toBe(false);

    await click(approvalButton);
    expect(client.approveFinalDecisionCalls).toEqual([
      { decisionHash: room.finalDecisionPreview!.decisionHash },
    ]);
  });
});

/**
 * B6: the last step is a person's, and the room says so.
 *
 * `request_final_decision_confirmation` deliberately never approves. It
 * prepares the exact decision, returns `HUMAN_CONFIRMATION_REQUIRED`, and asks
 * the shell to bring the person to the Decision surface. What is under test
 * here is that arriving that way reads as a hand-off rather than as a failure,
 * and that nothing about it shortens the confirmation a person still owes.
 */
describe("human final approval", () => {
  it("explains the hand-off when an agent prepared the decision, without implying the agent failed", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace tab="input" />);

    expect(container.querySelector('[data-testid="agent-decision-handoff"]')).toBeNull();

    // Exactly what the confirmation bridge does when the tool refuses.
    await act(async () => {
      shell.openDecisionReviewForHuman();
    });

    expect(shell.activeWorkspace).toBe("decision");
    const handoff = byTestId("agent-decision-handoff");
    expect(handoff.textContent).toContain("Your agent prepared the final decision");
    expect(handoff.textContent).toContain("Review this exact decision before approving");
    for (const blame of ["failed", "error", "could not", "unable", "denied"]) {
      expect(handoff.textContent?.toLowerCase()).not.toContain(blame);
    }
  });

  it("still requires the person's own confirmation after an agent hand-off", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace tab="input" />);
    await act(async () => {
      shell.openDecisionReviewForHuman();
    });

    // The hand-off changes what the room says, never what it asks for.
    const approve = byTestId<HTMLButtonElement>("confirm-approval");
    expect(approve.disabled).toBe(true);
    expect(client.approveFinalDecisionCalls).toHaveLength(0);
    expect(byTestId("human-confirmation-note").textContent).toContain(
      "takes your own confirmation",
    );

    const checkbox = byTestId<HTMLElement>("approval-panel").querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    await click(checkbox);
    await click(approve);

    expect(client.approveFinalDecisionCalls).toEqual([{ decisionHash: "hash-v1" }]);
    // Answered: the notice does not linger over a decision already confirmed.
    expect(container.querySelector('[data-testid="agent-decision-handoff"]')).toBeNull();
  });

  it("names the exact decision the tick is bound to", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace tab="input" />);

    expect(byTestId("approval-panel").textContent).toContain("Bound to hash-v1");
    expect(byTestId("approval-panel").textContent).toContain("this confirmation is void");
  });

  it("drops the hand-off notice when the person walks somewhere else", async () => {
    const client = new FakeRoomClient(roomInPhase("approval"));
    await mount(client, <DecisionWorkspace tab="input" />);
    await act(async () => {
      shell.openDecisionReviewForHuman();
    });
    expect(shell.agentPreparedDecision).toBe(true);

    await act(async () => {
      shell.goToWorkspace("issues");
    });

    expect(shell.agentPreparedDecision).toBe(false);
  });
});

/**
 * B7: a finalized meeting ends in one shared artifact.
 *
 * Everything on the report is read out of the server's own `DecisionRecord`,
 * so two participants comparing screens are comparing one server-side record
 * down to the hash — not two local reconstructions that agree today.
 */
describe("final decision report", () => {
  it("lays out the decision in reading order, not as a state dump", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace tab="input" />);

    const report = byTestId("final-report");
    for (const heading of [
      "Decision",
      "Why we chose it",
      "Key constraints",
      "Concerns addressed",
      "Trade-offs",
      "Team alignment",
      "Owners & actions",
      "Security advice",
    ]) {
      expect(report.textContent).toContain(heading);
    }

    expect(report.textContent).toContain("Two-week accessible onboarding scope");
    expect(report.textContent).toContain("Schedule accessibility review.");
    expect(report.textContent).toContain("Own launch scope.");
  });

  it("keeps dissent and warnings in the record rather than tidying them away", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace tab="input" />);

    expect(byTestId("final-report").textContent).toContain(
      "Marketing raised a concern until launch copy is reviewed.",
    );
    expect(byTestId("final-report").textContent).toContain("Concern");
  });

  it("offers the PDF from the authenticated server endpoint", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace tab="input" />);

    const pdf = [...container.querySelectorAll("a")].find((anchor) =>
      anchor.textContent?.includes("Download PDF"),
    );
    // Same-origin and session-authenticated: no credential is ever in reach of
    // this component, and the server decides who may have the file.
    expect(pdf?.getAttribute("href")).toBe(`/api/rooms/${client.state.id}/report.pdf`);
  });

  it("keeps provenance available without letting it crowd the report", async () => {
    const client = new FakeRoomClient(roomInPhase("finalized"));
    await mount(client, <DecisionWorkspace tab="input" />);

    const provenance = byTestId<HTMLDetailsElement>("report-provenance");
    expect(provenance.open).toBe(false);
    expect(provenance.textContent).toContain("Provenance");
    expect(provenance.textContent).toContain("hash-v1");
  });

  it("shows every participant the same decision hash", async () => {
    const first = new FakeRoomClient(roomInPhase("finalized"));
    await mount(first, <DecisionWorkspace tab="input" />);
    const seenByEngineer = byTestId("report-hash").textContent;

    await act(async () => {
      root.unmount();
    });
    root = createRoot(container);

    const other = roomInPhase("finalized");
    other.selfParticipantId = "participant-marketing";
    await mount(new FakeRoomClient(other), <DecisionWorkspace tab="input" />);

    expect(byTestId("report-hash").textContent).toBe(seenByEngineer);
    expect(seenByEngineer).toContain("hash-v1");
  });
});
