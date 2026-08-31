// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomProvider } from "@/components/room/room-provider";
import {
  MeetingShellProvider,
  useShell,
  type ShellContextValue,
} from "@/components/shell/shell-provider";
import { WorkspacePanel } from "@/components/shell/workspace-panel";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { demoRoom } from "@/fixtures/demo-room";
import { setRoomClientForTests } from "@/room-client/room-client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The panel a board press puts over the room: it is one dialog centred on the
 * stage, it opens marked at the item that was pressed, and it comes off again.
 * The 3D canvas is not mounted — the press is simulated at the shell, which is
 * exactly where the canvas would deliver it.
 */

let container: HTMLDivElement;
let root: Root;
let shell: ShellContextValue;

/* Effects, not render: the probe publishes the shell after each commit,
   which is also when `act` hands control back to the test. */
function ShellProbe() {
  const value = useShell();
  useEffect(() => {
    shell = value;
  }, [value]);
  return null;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom implements neither of these: the provider's reduced-motion
  // subscription needs a MediaQueryList, and the panel scrolls the pressed
  // row into view.
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
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setRoomClientForTests(null);
});

async function mountPanel() {
  setRoomClientForTests(new MockRoomClient(demoRoom));
  await act(async () => {
    root.render(
      <RoomProvider roomId="demo">
        <MeetingShellProvider>
          <ShellProbe />
          <WorkspacePanel />
        </MeetingShellProvider>
      </RoomProvider>,
    );
  });
  await act(async () => {});
}

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const markedRows = () =>
  [...container.querySelectorAll<HTMLElement>('[data-board-focus="on"]')];

describe("the workspace panel on screen", () => {
  it("shows nothing over the room until a workspace is opened", async () => {
    await mountPanel();

    expect(dialog()).toBeNull();
  });

  it("opens one dialog naming the workspace, over the scene", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-label")).toBe("Constraints");
    expect(container.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container.querySelector(".workspace-stage-scrim")).not.toBeNull();
  });

  it("marks the one constraint a card press named, and only that one", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints", "constraint-1"));

    const marked = markedRows();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.boardItem).toBe("constraint-1");
  });

  it("marks nothing when the whole workspace was opened", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    expect(container.querySelectorAll("[data-board-item]").length).toBeGreaterThan(0);
    expect(markedRows()).toHaveLength(0);
  });

  it("opens unmarked, not broken, when the panel does not render the pressed item", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints", "not-on-this-panel"));

    expect(dialog()).not.toBeNull();
    expect(markedRows()).toHaveLength(0);
  });

  it("moves the mark when a second item is pressed", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints", "constraint-1"));
    await act(async () => shell.goToWorkspace("constraints", "constraint-2"));

    const marked = markedRows();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.boardItem).toBe("constraint-2");
  });

  it("comes off when the close button is pressed", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("brief"));

    const close = container.querySelector<HTMLButtonElement>(".workspace-stage-close");
    expect(close).not.toBeNull();
    await act(async () => close?.click());

    expect(dialog()).toBeNull();
  });

  it("comes off when the scrim is pressed", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("issues"));

    const scrim = container.querySelector<HTMLButtonElement>(".workspace-stage-scrim");
    await act(async () => scrim?.click());

    expect(dialog()).toBeNull();
  });
});
