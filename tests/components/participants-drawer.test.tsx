// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoRoom } from "@/fixtures/demo-room";
import { ParticipantsDrawer } from "@/components/shell/drawers/participants-drawer";
import { MeetingShellProvider } from "@/components/shell/shell-provider";
import { RoomProvider } from "@/components/room/room-provider";
import { setRoomClientForTests } from "@/room-client/room-client";
import type { ActionResult, JoinRequest, ManageJoinRequestInput, RoomClient, RoomState } from "@/contracts/room";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

let container: HTMLDivElement;
let root: Root;

type Listener = (state: RoomState) => void;

class WaitingRoomFakeClient implements RoomClient {
  state: RoomState;
  requests: JoinRequest[];
  resolvedIds: string[] = [];
  removedParticipantIds: string[] = [];
  transferredToParticipantIds: string[] = [];
  private readonly listeners = new Set<Listener>();

  constructor(seed: RoomState, requests: JoinRequest[]) {
    this.state = structuredClone(seed);
    this.requests = requests;
  }

  async getRoom(roomId: string): Promise<RoomState> {
    if (roomId !== this.state.id) throw new Error(`Unknown room: ${roomId}`);
    return structuredClone(this.state);
  }

  subscribe(roomId: string, callback: Listener): () => void {
    if (roomId !== this.state.id) return () => {};
    this.listeners.add(callback);
    queueMicrotask(() => {
      if (this.listeners.has(callback)) callback(structuredClone(this.state));
    });
    return () => { this.listeners.delete(callback); };
  }

  listJoinRequests: RoomClient["listJoinRequests"] = async () => ({
    ok: true,
    data: this.requests.filter((request) => request.status === "waiting"),
    roomVersion: this.state.version,
    message: "Waiting room loaded.",
  });

  admitJoinRequest: RoomClient["admitJoinRequest"] = async (_roomId, input: ManageJoinRequestInput) => {
    this.resolvedIds.push(input.joinRequestId);
    const request = this.requests.find((candidate) => candidate.id === input.joinRequestId);
    if (request) request.status = "admitted";
    return { ok: true, data: request!, roomVersion: this.state.version, message: "Participant admitted." };
  };

  rejectJoinRequest: RoomClient["rejectJoinRequest"] = async (_roomId, input: ManageJoinRequestInput) => {
    this.resolvedIds.push(input.joinRequestId);
    const request = this.requests.find((candidate) => candidate.id === input.joinRequestId);
    if (request) request.status = "rejected";
    return { ok: true, data: request!, roomVersion: this.state.version, message: "Join request rejected." };
  };

  private unavailable<T = null>(): ActionResult<T> {
    return { ok: false, error: { code: "WRONG_PHASE", message: "Not used by this test." }, roomVersion: this.state.version };
  }

  claimSeat: RoomClient["claimSeat"] = async () => this.unavailable();
  addMyPosition: RoomClient["addMyPosition"] = async () => this.unavailable();
  submitProposal: RoomClient["submitProposal"] = async () => this.unavailable();
  raiseObjection: RoomClient["raiseObjection"] = async () => this.unavailable();
  resolveObjection: RoomClient["resolveObjection"] = async () => this.unavailable();
  proposeTradeoff: RoomClient["proposeTradeoff"] = async () => this.unavailable();
  castMyVote: RoomClient["castMyVote"] = async () => this.unavailable();
  previewFinalDecision: RoomClient["previewFinalDecision"] = async () => this.unavailable();
  approveFinalDecision: RoomClient["approveFinalDecision"] = async () => this.unavailable();
  getDecisionRecord: RoomClient["getDecisionRecord"] = async () => this.unavailable();
  startDemoScenario: RoomClient["startDemoScenario"] = async () => this.unavailable();
  advanceDemoPhase: RoomClient["advanceDemoPhase"] = async () => this.unavailable();
  markMyInputReady: RoomClient["markMyInputReady"] = async () => this.unavailable();
  advanceRoomPhase: RoomClient["advanceRoomPhase"] = async () => this.unavailable();

  lockMeeting: RoomClient["lockMeeting"] = async () => this.unavailable();
  unlockMeeting: RoomClient["unlockMeeting"] = async () => this.unavailable();

  removeParticipant: RoomClient["removeParticipant"] = async (_roomId, input) => {
    this.removedParticipantIds.push(input.participantId);
    const target = this.state.participants.find((participant) => participant.id === input.participantId);
    if (target) {
      target.status = "removed";
      target.removedAt = "2026-08-30T00:00:01.000Z";
    }
    this.state.version += 1;
    this.publish();
    return { ok: true, data: null, roomVersion: this.state.version, message: "Participant removed." };
  };

  transferOwnership: RoomClient["transferOwnership"] = async (_roomId, input) => {
    this.transferredToParticipantIds.push(input.participantId);
    const previousOwnerId = this.state.ownerParticipantId;
    for (const participant of this.state.participants) {
      if (participant.id === previousOwnerId) participant.meetingRole = "participant";
      if (participant.id === input.participantId) {
        participant.meetingRole = "owner";
        participant.decisionRole = "decision_maker";
      }
    }
    this.state.ownerParticipantId = input.participantId;
    this.state.version += 1;
    this.publish();
    return { ok: true, data: null, roomVersion: this.state.version, message: "Ownership transferred." };
  };

  private publish() {
    const snapshot = structuredClone(this.state);
    for (const listener of this.listeners) listener(snapshot);
  }
}

function seedRoom(selfParticipantId: string): RoomState {
  const seed = structuredClone(demoRoom);
  seed.selfParticipantId = selfParticipantId;
  return seed;
}

const waitingRequest: JoinRequest = {
  id: "join-request-1",
  roomId: "demo",
  displayName: "Jane",
  role: "Designer",
  status: "waiting",
  createdAt: "2026-08-30T00:00:00.000Z",
  resolvedAt: null,
};

async function mount(client: RoomClient) {
  setRoomClientForTests(client);
  await act(async () => {
    root.render(
      <MeetingShellProvider>
        <RoomProvider roomId="demo">
          <ParticipantsDrawer />
        </RoomProvider>
      </MeetingShellProvider>,
    );
  });
  await act(async () => {});
}

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom does not implement matchMedia; MeetingShellProvider's
  // reduced-motion subscription needs a MediaQueryList-shaped stub.
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
  await act(async () => { root.unmount(); });
  container.remove();
  setRoomClientForTests(null);
});

describe("owner waiting room", () => {
  it("shows waiting requesters with admit/reject controls only to the owner", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), [
      { ...waitingRequest },
    ]);
    await mount(client);
    await tick();

    expect(container.textContent).toContain("Jane");
    expect(container.textContent).toContain("Designer");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Admit")).toBe(true);
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Reject")).toBe(true);
  });

  it("hides the waiting room and its controls from a non-owner participant", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-engineering"), [
      { ...waitingRequest },
    ]);
    await mount(client);
    await tick();

    expect(container.textContent).not.toContain("Waiting room");
    expect(container.textContent).not.toContain("Jane");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Admit")).toBe(false);
  });

  it("admits a requester and removes them from the waiting list", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), [
      { ...waitingRequest },
    ]);
    await mount(client);
    await tick();

    const admitButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Admit",
    );
    if (!admitButton) throw new Error("Admit button missing.");
    await act(async () => { admitButton.click(); });
    await tick();

    expect(client.resolvedIds).toEqual(["join-request-1"]);
    expect(container.textContent).toContain("No one is waiting.");
  });
});

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")].filter(
    (button) => button.textContent === name,
  );
}

describe("owner membership controls", () => {
  it("shows Remove and Make owner for the owner, on every other active human participant only", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), []);
    await mount(client);
    await tick();

    // demoRoom seats: product (owner, self here), engineering (human),
    // design (simulation), marketing (human).
    expect(buttonsNamed("Remove")).toHaveLength(2);
    expect(buttonsNamed("Make owner")).toHaveLength(2);

    // Never on the owner's own row.
    const ownerRow = [...container.querySelectorAll(".participant-row")].find((row) =>
      row.textContent?.includes("Maya Okonkwo"),
    );
    expect(ownerRow?.querySelector("button")).toBeNull();
  });

  it("hides membership controls entirely from a non-owner participant", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-engineering"), []);
    await mount(client);
    await tick();

    expect(buttonsNamed("Remove")).toHaveLength(0);
    expect(buttonsNamed("Make owner")).toHaveLength(0);
  });

  it("requires explicit confirmation naming the participant before removing them", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), []);
    await mount(client);
    await tick();

    const engineeringRow = [...container.querySelectorAll(".participant-row")].find((row) =>
      row.textContent?.includes("Emre Yilmaz"),
    );
    const removeButton = [...(engineeringRow?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Remove",
    );
    if (!removeButton) throw new Error("Remove button missing for Emre.");
    await act(async () => { removeButton.click(); });

    expect(container.textContent).toContain("Remove Emre Yilmaz from this meeting?");
    expect(client.removedParticipantIds).toEqual([]);

    const confirmButtons = [...container.querySelectorAll<HTMLButtonElement>(".participant-confirm button")];
    const confirm = confirmButtons.find((button) => button.textContent === "Remove");
    if (!confirm) throw new Error("Confirmation Remove button missing.");
    await act(async () => { confirm.click(); });
    await tick();

    expect(client.removedParticipantIds).toEqual(["participant-engineering"]);
  });

  it("cancels a pending removal without calling the action", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), []);
    await mount(client);
    await tick();

    const removeButton = buttonsNamed("Remove")[0];
    await act(async () => { removeButton!.click(); });
    expect(container.querySelector(".participant-confirm")).not.toBeNull();

    const cancel = [...container.querySelectorAll<HTMLButtonElement>(".participant-confirm button")].find(
      (button) => button.textContent === "Cancel",
    );
    await act(async () => { cancel!.click(); });

    expect(container.querySelector(".participant-confirm")).toBeNull();
    expect(client.removedParticipantIds).toEqual([]);
  });

  it("requires explicit confirmation naming the participant and the authority loss before transferring ownership", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), []);
    await mount(client);
    await tick();

    const marketingRow = [...container.querySelectorAll(".participant-row")].find((row) =>
      row.textContent?.includes("Tomas Reyes"),
    );
    const makeOwnerButton = [...(marketingRow?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Make owner",
    );
    if (!makeOwnerButton) throw new Error("Make owner button missing for Tomas.");
    await act(async () => { makeOwnerButton.click(); });

    expect(container.textContent).toContain("Make Tomas Reyes the meeting owner?");
    expect(container.textContent).toContain("You will lose owner-only controls.");
    expect(client.transferredToParticipantIds).toEqual([]);

    const confirm = [...container.querySelectorAll<HTMLButtonElement>(".participant-confirm button")].find(
      (button) => button.textContent === "Confirm",
    );
    if (!confirm) throw new Error("Confirmation button missing.");
    await act(async () => { confirm.click(); });
    await tick();

    expect(client.transferredToParticipantIds).toEqual(["participant-marketing"]);
  });

  it("updates controls live once the room reflects a new owner", async () => {
    const client = new WaitingRoomFakeClient(seedRoom("participant-product"), []);
    await mount(client);
    await tick();
    expect(buttonsNamed("Remove").length).toBeGreaterThan(0);

    const makeOwnerButton = buttonsNamed("Make owner")[0];
    await act(async () => { makeOwnerButton!.click(); });
    const confirm = [...container.querySelectorAll<HTMLButtonElement>(".participant-confirm button")].find(
      (button) => button.textContent === "Confirm",
    );
    await act(async () => { confirm!.click(); });
    await tick();

    // The old owner (self, in this mount) is no longer owner: no more
    // membership controls are rendered for this session.
    expect(buttonsNamed("Remove")).toHaveLength(0);
    expect(buttonsNamed("Make owner")).toHaveLength(0);
  });
});
