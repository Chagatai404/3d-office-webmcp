// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoRoom } from "@/fixtures/demo-room";
import { SettingsDrawer } from "@/components/shell/drawers/settings-drawer";
import { MeetingShellProvider } from "@/components/shell/shell-provider";
import { RoomProvider } from "@/components/room/room-provider";
import { setRoomClientForTests } from "@/room-client/room-client";
import type { ActionResult, RoomClient, RoomState } from "@/contracts/room";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }

let container: HTMLDivElement;
let root: Root;

type Listener = (state: RoomState) => void;

class LockFakeClient implements RoomClient {
  state: RoomState;
  lockCalls = 0;
  unlockCalls = 0;
  private readonly listeners = new Set<Listener>();

  constructor(seed: RoomState) {
    this.state = structuredClone(seed);
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

  lockMeeting: RoomClient["lockMeeting"] = async () => {
    this.lockCalls += 1;
    this.state.isLocked = true;
    this.state.version += 1;
    this.publish();
    return { ok: true, data: null, roomVersion: this.state.version, message: "Meeting locked." };
  };

  unlockMeeting: RoomClient["unlockMeeting"] = async () => {
    this.unlockCalls += 1;
    this.state.isLocked = false;
    this.state.version += 1;
    this.publish();
    return { ok: true, data: null, roomVersion: this.state.version, message: "Meeting unlocked." };
  };

  private publish() {
    const snapshot = structuredClone(this.state);
    for (const listener of this.listeners) listener(snapshot);
  }

  private unavailable<T = null>(): ActionResult<T> {
    return { ok: false, error: { code: "WRONG_PHASE", message: "Not used by this test." }, roomVersion: this.state.version };
  }

  claimSeat: RoomClient["claimSeat"] = async () => this.unavailable();
  addMyPosition: RoomClient["addMyPosition"] = async () => this.unavailable();
  submitProposal: RoomClient["submitProposal"] = async () => this.unavailable();
  raiseObjection: RoomClient["raiseObjection"] = async () => this.unavailable();
  resolveObjection: RoomClient["resolveObjection"] = async () => this.unavailable();
  proposeTradeoff: RoomClient["proposeTradeoff"] = async () => this.unavailable();
  expressMyAlignment: RoomClient["expressMyAlignment"] = async () => this.unavailable();
  previewFinalDecision: RoomClient["previewFinalDecision"] = async () => this.unavailable();
  approveFinalDecision: RoomClient["approveFinalDecision"] = async () => this.unavailable();
  getDecisionRecord: RoomClient["getDecisionRecord"] = async () => this.unavailable();
  startDemoScenario: RoomClient["startDemoScenario"] = async () => this.unavailable();
  advanceDemoPhase: RoomClient["advanceDemoPhase"] = async () => this.unavailable();
  markMyInputReady: RoomClient["markMyInputReady"] = async () => this.unavailable();
  advanceRoomPhase: RoomClient["advanceRoomPhase"] = async () => this.unavailable();
  listJoinRequests: RoomClient["listJoinRequests"] = async () => this.unavailable();
  admitJoinRequest: RoomClient["admitJoinRequest"] = async () => this.unavailable();
  rejectJoinRequest: RoomClient["rejectJoinRequest"] = async () => this.unavailable();
  removeParticipant: RoomClient["removeParticipant"] = async () => this.unavailable();
  transferOwnership: RoomClient["transferOwnership"] = async () => this.unavailable();
  setDecisionPolicy: RoomClient["setDecisionPolicy"] = async () => this.unavailable();
  setParticipantDecisionRole: RoomClient["setParticipantDecisionRole"] = async () => this.unavailable();
  configureParticipant: RoomClient["configureParticipant"] = async () => this.unavailable();
}

function seedRoom(selfParticipantId: string): RoomState {
  const seed = structuredClone(demoRoom);
  seed.selfParticipantId = selfParticipantId;
  return seed;
}

async function mount(client: RoomClient) {
  setRoomClientForTests(client);
  await act(async () => {
    root.render(
      <MeetingShellProvider>
        <RoomProvider roomId="demo">
          <SettingsDrawer />
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

describe("meeting lock in the settings drawer", () => {
  it("shows the owner a Lock control and toggles it", async () => {
    const client = new LockFakeClient(seedRoom("participant-product"));
    await mount(client);
    await tick();

    expect(container.textContent).toContain("Open — new join requests are allowed.");
    const lockButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Lock meeting",
    );
    if (!lockButton) throw new Error("Lock meeting button missing.");
    await act(async () => { lockButton.click(); });
    await tick();

    expect(client.lockCalls).toBe(1);
    expect(container.textContent).toContain("Locked — new join requests are refused.");

    const unlockButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Unlock meeting",
    );
    if (!unlockButton) throw new Error("Unlock meeting button missing.");
    await act(async () => { unlockButton.click(); });
    await tick();
    expect(client.unlockCalls).toBe(1);
  });

  it("shows a non-owner the lock status without a control to change it", async () => {
    const client = new LockFakeClient(seedRoom("participant-engineering"));
    await mount(client);
    await tick();

    expect(container.textContent).toContain("Meeting access");
    expect(
      [...container.querySelectorAll("button")].some(
        (button) => button.textContent === "Lock meeting" || button.textContent === "Unlock meeting",
      ),
    ).toBe(false);
    expect(container.textContent).toContain("Open");
  });
});
