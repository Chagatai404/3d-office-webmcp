// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomProvider } from "@/components/room/room-provider";
import { PHASE_WORKSPACE } from "@/components/shell/phase-workspace";
import {
  MeetingShellProvider,
  useShell,
  type ShellContextValue,
} from "@/components/shell/shell-provider";
import { usePhaseFollow } from "@/components/shell/use-phase-follow";
import type { RoomClient, RoomPhase, RoomState } from "@/contracts/room";
import { demoRoom } from "@/fixtures/demo-room";
import { setRoomClientForTests } from "@/room-client/room-client";
import { CAMERA_POSES, WORKSPACE_IDS } from "@/visualization/scene/camera-poses";

/**
 * B8: the room follows the meeting.
 *
 * A phase is a place, not only a word in the toolbar. When the canonical phase
 * changes — whoever or whatever advanced it — the camera stands at the surface
 * that phase is about, so nobody has to go hunting for the board a changed
 * label refers to and no agent ever has to describe where to click.
 *
 * The rules that keep it from being a hijack are the interesting part, and
 * they are what these pin down.
 */

vi.mock("@/webmcp/register-tools", () => ({
  useRoomWebMcpTools: () => undefined,
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let shell: ShellContextValue;

/**
 * Only what the follow hook touches: a snapshot, a subscription, and a way to
 * push the next snapshot. Everything else on `RoomClient` is unreachable from
 * here, so it is not built.
 */
class PhaseClient {
  state: RoomState;
  private readonly listeners = new Set<(state: RoomState) => void>();

  constructor(seed: RoomState) {
    this.state = structuredClone(seed);
  }

  async getRoom(): Promise<RoomState> {
    return structuredClone(this.state);
  }

  subscribe(_roomId: string, callback: (state: RoomState) => void): () => void {
    this.listeners.add(callback);
    queueMicrotask(() => {
      if (this.listeners.has(callback)) callback(structuredClone(this.state));
    });
    return () => {
      this.listeners.delete(callback);
    };
  }

  advanceTo(phase: RoomPhase) {
    this.state = { ...structuredClone(this.state), phase, version: this.state.version + 1 };
    for (const listener of this.listeners) listener(structuredClone(this.state));
  }
}

function Probe() {
  const value = useShell();
  usePhaseFollow();
  useEffect(() => {
    shell = value;
  }, [value]);
  return null;
}

async function mountInPhase(phase: RoomPhase): Promise<PhaseClient> {
  const seed: RoomState = structuredClone(demoRoom);
  seed.phase = phase;
  const client = new PhaseClient(seed);
  setRoomClientForTests(client as unknown as RoomClient);

  await act(async () => {
    root.render(
      <MeetingShellProvider>
        <RoomProvider roomId={seed.id}>
          <Probe />
        </RoomProvider>
      </MeetingShellProvider>,
    );
  });
  await act(async () => {});
  return client;
}

async function advance(client: PhaseClient, phase: RoomPhase) {
  await act(async () => {
    client.advanceTo(phase);
  });
  await act(async () => {});
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
  await act(async () => {
    root.unmount();
  });
  container.remove();
  setRoomClientForTests(null);
});

describe("PHASE_WORKSPACE", () => {
  it("gives every phase a real place in the room to stand", () => {
    for (const workspace of Object.values(PHASE_WORKSPACE)) {
      expect(WORKSPACE_IDS).toContain(workspace);
      // A stable named pose, never arbitrary coordinates: there is no free
      // flight in this room and following the phase must not introduce any.
      expect(CAMERA_POSES[workspace]).toBeDefined();
    }
  });

  it("puts the input phase at the table, where readiness is", () => {
    expect(PHASE_WORKSPACE.input).toBe("room");
  });

  it("keeps the decision and its record on the same surface", () => {
    expect(PHASE_WORKSPACE.approval).toBe("decision");
    expect(PHASE_WORKSPACE.finalized).toBe("decision");
  });
});

describe("usePhaseFollow", () => {
  it("does not move anything on the first snapshot", async () => {
    await mountInPhase("deliberation");

    // Walking into a room already in Deliberation lands you at the table, the
    // way it always did. Nothing has *changed* yet.
    expect(shell.activeWorkspace).toBe("room");
    expect(shell.openPanel).toBeNull();
  });

  it("moves to the surface a phase change is about, and opens it", async () => {
    const client = await mountInPhase("proposals");

    await advance(client, "deliberation");

    expect(shell.activeWorkspace).toBe("issues");
    expect(shell.openPanel?.workspace).toBe("issues");
  });

  it("follows the room all the way to the decision surface", async () => {
    const client = await mountInPhase("voting");

    await advance(client, "approval");
    expect(shell.activeWorkspace).toBe("decision");

    await advance(client, "finalized");
    expect(shell.activeWorkspace).toBe("decision");
  });

  it("stays put when the phase has not actually changed", async () => {
    const client = await mountInPhase("proposals");

    await act(async () => {
      shell.goToWorkspace("constraints");
    });
    await advance(client, "proposals");

    expect(shell.activeWorkspace).toBe("constraints");
  });

  it("leaves an open drawer alone rather than snatching it away", async () => {
    const client = await mountInPhase("proposals");

    await act(async () => {
      shell.openDrawer("participants");
    });
    await advance(client, "deliberation");

    // Mid-admission is exactly the wrong moment to move someone: the dock
    // still says where the room went.
    expect(shell.activeDrawer).toBe("participants");
    expect(shell.activeWorkspace).toBe("room");
  });
});
