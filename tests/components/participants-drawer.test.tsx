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
