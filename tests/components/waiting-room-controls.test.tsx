// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoRoom, demoTimestamp } from "@/fixtures/demo-room";
import { PositionsPanel } from "@/components/room/positions-panel";
import { RoomProvider } from "@/components/room/room-provider";
import { RoomStatusPanel } from "@/components/room/room-status";
import { setRoomClientForTests } from "@/room-client/room-client";
import type {
  ActionResult,
  Position,
  RoomClient,
  RoomPhase,
  RoomState,
} from "@/contracts/room";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

type Listener = (state: RoomState) => void;

class B3RoomClient implements RoomClient {
  state: RoomState;
  readyCalls = 0;
  updateReadyFromAction = true;
  phaseResult: ActionResult | null = null;
  readonly advanceRoomPhaseCalls: RoomPhase[] = [];
  readonly advanceDemoPhaseCalls: RoomPhase[] = [];
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

  claimSeat: RoomClient["claimSeat"] = async () => this.unavailable();
  addMyPosition: RoomClient["addMyPosition"] = async () => this.unavailable();
  submitProposal: RoomClient["submitProposal"] = async () => this.unavailable();
  raiseObjection: RoomClient["raiseObjection"] = async () => this.unavailable();
  resolveObjection: RoomClient["resolveObjection"] = async () =>
    this.unavailable();
  proposeTradeoff: RoomClient["proposeTradeoff"] = async () =>
    this.unavailable();
  expressMyAlignment: RoomClient["expressMyAlignment"] = async () => this.unavailable();
  previewFinalDecision: RoomClient["previewFinalDecision"] = async () =>
    this.unavailable();
  approveFinalDecision: RoomClient["approveFinalDecision"] = async () =>
    this.unavailable();
  getDecisionRecord: RoomClient["getDecisionRecord"] = async () =>
    this.unavailable();
  startDemoScenario: RoomClient["startDemoScenario"] = async () =>
    this.unavailable();
  listJoinRequests: RoomClient["listJoinRequests"] = async () =>
    this.unavailable();
  admitJoinRequest: RoomClient["admitJoinRequest"] = async () =>
    this.unavailable();
  rejectJoinRequest: RoomClient["rejectJoinRequest"] = async () =>
    this.unavailable();
  lockMeeting: RoomClient["lockMeeting"] = async () => this.unavailable();
  unlockMeeting: RoomClient["unlockMeeting"] = async () => this.unavailable();
  removeParticipant: RoomClient["removeParticipant"] = async () =>
    this.unavailable();
  transferOwnership: RoomClient["transferOwnership"] = async () =>
    this.unavailable();
  setDecisionPolicy: RoomClient["setDecisionPolicy"] = async () => this.unavailable();
  setParticipantDecisionRole: RoomClient["setParticipantDecisionRole"] = async () => this.unavailable();

  advanceDemoPhase: RoomClient["advanceDemoPhase"] = async (_roomId, phase) => {
    this.advanceDemoPhaseCalls.push(phase);
    return this.unavailable();
  };

  markMyInputReady: RoomClient["markMyInputReady"] = async () => {
    this.readyCalls += 1;
    const before = this.state.version;
    if (this.updateReadyFromAction) this.publishSelfReady();
    return {
      ok: true,
      data: null,
      roomVersion: this.state.version,
      message:
        this.state.version === before
          ? "Ready recorded by server."
          : "Your input is ready.",
    };
  };

  advanceRoomPhase: RoomClient["advanceRoomPhase"] = async (_roomId, phase) => {
    this.advanceRoomPhaseCalls.push(phase);
    if (this.phaseResult) return this.phaseResult;

    this.publish((draft) => {
      draft.phase = phase;
    });
    return {
      ok: true,
      data: null,
      roomVersion: this.state.version,
      message: `Room phase advanced to ${phase}.`,
    };
  };

  publishSelfReady() {
    this.publish((draft) => {
      const self = draft.participants.find(
        (participant) => participant.id === draft.selfParticipantId,
      );
      if (self) self.isReady = true;
    });
  }

  private snapshot(): RoomState {
    return structuredClone(this.state);
  }

  private publish(apply: (draft: RoomState) => void) {
    const draft = this.snapshot();
    apply(draft);
    draft.version += 1;
    this.state = draft;
    for (const listener of this.listeners) listener(this.snapshot());
  }

  private unavailable<T = null>(): ActionResult<T> {
    return {
      ok: false,
      error: {
        code: "WRONG_PHASE",
        message: "This action is outside this test.",
      },
      roomVersion: this.state.version,
    };
  }
}

function seedRoom(selfParticipantId: string): RoomState {
  const seed = structuredClone(demoRoom);
  seed.demoMode = null;
  seed.selfParticipantId = selfParticipantId;
  for (const participant of seed.participants) {
    if (participant.id === selfParticipantId) participant.isClaimed = true;
  }
  return seed;
}

function addEngineeringPosition(room: RoomState) {
  const position: Position = {
    id: "position-engineering",
    participantId: "participant-engineering",
    summary: "A reduced two-week scope is shippable.",
    category: "capacity",
    priority: "high",
    referencedSourceIds: [],
    createdAt: demoTimestamp(9),
  };
  room.positions.push(position);
}

function organizerReadyRoom(): RoomState {
  const seed = seedRoom("participant-product");
  addEngineeringPosition(seed);

  for (const participant of seed.participants) {
    if (participant.kind !== "human") continue;
    participant.isClaimed = true;
    participant.isReady = true;
  }

  return seed;
}

async function mount(ui: React.ReactNode, client: RoomClient) {
  setRoomClientForTests(client);
  await act(async () => {
    root.render(<RoomProvider roomId="demo">{ui}</RoomProvider>);
  });
  await act(async () => {});
}

function buttonNamed(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`No button named "${label}".`);
  return button;
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

describe("waiting room readiness and organizer controls", () => {
  it("keeps the ready button disabled before the participant has a position", async () => {
    await mount(
      <PositionsPanel />,
      new B3RoomClient(seedRoom("participant-engineering")),
    );

    const readyButton = buttonNamed("My input is ready");
    expect(readyButton.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Share something with the meeting before marking your input ready.",
    );
  });

  it("shows ready only after the canonical snapshot marks the participant ready", async () => {
    const seed = seedRoom("participant-engineering");
    addEngineeringPosition(seed);
    const client = new B3RoomClient(seed);
    client.updateReadyFromAction = false;

    await mount(<PositionsPanel />, client);
    await click(buttonNamed("My input is ready"));

    expect(client.readyCalls).toBe(1);
    expect(container.textContent).not.toContain("✓ Ready for deliberation");

    await act(async () => {
      client.publishSelfReady();
    });

    expect(container.textContent).toContain("✓ Ready for deliberation");
  });

  it("calls the production phase action for organizer controls", async () => {
    const client = new B3RoomClient(organizerReadyRoom());

    await mount(<RoomStatusPanel />, client);
    await click(buttonNamed("Start proposals"));

    expect(client.advanceRoomPhaseCalls).toEqual(["proposals"]);
    expect(client.advanceDemoPhaseCalls).toEqual([]);
  });

  it("lets the organizer move a room into decision review regardless of alignment completeness", async () => {
    const seed = organizerReadyRoom();
    seed.phase = "voting";
    seed.activeProposalId = "proposal-1";
    seed.proposals.push({
      id: "proposal-1",
      participantId: "participant-product",
      title: "Two-week accessible onboarding scope",
      summary: "Ship a narrower onboarding update.",
      rationale: "It balances scope, quality, and launch timing.",
      expectedOutcomes: ["Faster first value"],
      referencedConstraintIds: ["constraint-1"],
      referencedSourceIds: [],
      parentProposalId: null,
      status: "candidate",
      createdAt: demoTimestamp(10),
    });
    seed.alignments.push(
      {
        proposalId: "proposal-1",
        participantId: "participant-product",
        choice: "support",
        comment: null,
        updatedAt: demoTimestamp(11),
      },
      {
        proposalId: "proposal-1",
        participantId: "participant-engineering",
        choice: "support",
        comment: null,
        updatedAt: demoTimestamp(11),
      },
      // The marketing participant deliberately has not shared alignment:
      // entering decision review no longer requires every participant to
      // have responded.
    );
    const client = new B3RoomClient(seed);

    await mount(<RoomStatusPanel />, client);
    await click(buttonNamed("Review decision"));

    expect(client.advanceRoomPhaseCalls).toEqual(["approval"]);
  });

  it("does not show organizer CTAs to a non-organizer participant", async () => {
    await mount(
      <RoomStatusPanel />,
      new B3RoomClient(seedRoom("participant-engineering")),
    );

    expect(container.textContent).not.toContain("Organizer waiting room");
    expect(container.textContent).not.toContain("Start proposals");
  });

  it("renders useful feedback when the server rejects a phase advance", async () => {
    const seed = organizerReadyRoom();
    const client = new B3RoomClient(seed);
    client.phaseResult = {
      ok: false,
      error: {
        code: "NOT_AUTHORIZED",
        message: "Only the room organizer may advance the room phase.",
        recovery: "Ask the organizer to move the room forward.",
      },
      roomVersion: seed.version,
    };

    await mount(<RoomStatusPanel />, client);
    await click(buttonNamed("Start proposals"));

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Not authorized");
    expect(alert?.textContent).toContain(
      "Ask the organizer to move the room forward.",
    );
  });
});
