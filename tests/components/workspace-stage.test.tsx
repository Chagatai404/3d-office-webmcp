// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MeetingShellProvider,
  useShell,
  type ShellContextValue,
} from "@/components/shell/shell-provider";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The shell's rule for what sits over the room: one workspace panel at a time,
 * opened at the item a board press named, and never sharing the screen with a
 * drawer. The 3D canvas is not mounted — what is under test is the decision
 * the shell makes about a press, not how the press was produced.
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

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mountShell() {
  await act(async () => {
    root.render(
      <MeetingShellProvider>
        <ShellProbe />
      </MeetingShellProvider>,
    );
  });
}

function pressEscape() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
}

describe("the workspace panel over the room", () => {
  it("starts closed, in the room", async () => {
    await mountShell();

    expect(shell.openPanel).toBeNull();
    expect(shell.activeWorkspace).toBe("room");
  });

  it("opens the workspace a board press selected, with no item singled out", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("constraints"));

    expect(shell.openPanel).toMatchObject({ workspace: "constraints", itemId: null });
    expect(shell.activeWorkspace).toBe("constraints");
  });

  it("opens at the one item a card press named", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("issues", "conflict-7"));

    expect(shell.openPanel).toMatchObject({ workspace: "issues", itemId: "conflict-7" });
  });

  it("counts a second press of the same item as a new opening", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("issues", "conflict-7"));
    const first = shell.openPanel?.nonce;
    await act(async () => shell.goToWorkspace("issues", "conflict-7"));

    expect(shell.openPanel?.nonce).toBeGreaterThan(first ?? 0);
  });

  it("clears the panel on the way back to the room", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("constraints"));
    await act(async () => shell.goToWorkspace("room"));

    expect(shell.openPanel).toBeNull();
    expect(shell.activeWorkspace).toBe("room");
  });

  it("moves the camera to brief without opening a panel over it", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("brief"));

    expect(shell.openPanel).toBeNull();
    expect(shell.activeWorkspace).toBe("brief");
  });

  it("closes without moving the camera back", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("decision"));
    await act(async () => shell.closeWorkspacePanel());

    expect(shell.openPanel).toBeNull();
    expect(shell.activeWorkspace).toBe("decision");
  });

  it("closes on Escape", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("proposals"));
    await act(async () => pressEscape());

    expect(shell.openPanel).toBeNull();
  });

  it("never shares the screen with a drawer", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("constraints", "constraint-1"));
    await act(async () => shell.openDrawer("participants"));

    expect(shell.openPanel).toBeNull();
    expect(shell.activeDrawer).toBe("participants");

    await act(async () => shell.goToWorkspace("constraints"));

    expect(shell.activeDrawer).toBeNull();
    expect(shell.openPanel).toMatchObject({ workspace: "constraints" });
  });

  it("puts the panel away when a drawer is toggled open from the dock", async () => {
    await mountShell();
    await act(async () => shell.goToWorkspace("alignment"));
    await act(async () => shell.toggleDrawer("activity"));

    expect(shell.openPanel).toBeNull();
    expect(shell.activeDrawer).toBe("activity");
  });
});
