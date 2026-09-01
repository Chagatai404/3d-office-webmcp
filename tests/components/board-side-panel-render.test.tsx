// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomProvider } from "@/components/room/room-provider";
import { BoardSidePanel } from "@/components/shell/board-side-panel";
import {
  MeetingShellProvider,
  useShell,
  type ShellContextValue,
} from "@/components/shell/shell-provider";
import { MockRoomClient } from "@/room-client/mock-room-client";
import { demoRoom } from "@/fixtures/demo-room";
import { setRoomClientForTests } from "@/room-client/room-client";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * The six board workspaces that moved off `WorkspacePanel`'s centred stage
 * onto a side rail: the room stays visible (no scrim), the panel sits on
 * the side opposite its board, and a board press still lands on the row it
 * named -- now inside whichever tab renders that row, switching there first.
 */

let container: HTMLDivElement;
let root: Root;
let shell: ShellContextValue;

function ShellProbe() {
  const value = useShell();
  useEffect(() => {
    shell = value;
  }, [value]);
  return null;
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
          <BoardSidePanel />
        </MeetingShellProvider>
      </RoomProvider>,
    );
  });
  await act(async () => {});
}

const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]');
const markedRows = () =>
  [...container.querySelectorAll<HTMLElement>('[data-board-focus="on"]')];
const tab = (label: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (button) => button.textContent === label,
  );

describe("the board side panel on screen", () => {
  it("shows nothing over the room until a board workspace is opened", async () => {
    await mountPanel();

    expect(dialog()).toBeNull();
  });

  it("opens a dialog with no scrim, on the side opposite its board", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    const panel = dialog();
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("aria-label")).toBe("Constraints");
    expect(panel?.className).toContain("board-panel-right");
    expect(container.querySelector(".workspace-stage-scrim")).toBeNull();
  });

  it("puts the panel on the left for a workspace whose board sits on the right", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("proposals"));

    expect(dialog()?.className).toContain("board-panel-left");
  });

  it("does not open for brief -- pressing it is a camera move, not a panel", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("brief"));

    expect(dialog()).toBeNull();
  });

  it("shows a highlighted tab for input, alongside one tab per seated participant", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    expect(tab("Maya Okonkwo")).toBeTruthy();
    expect(tab("Emre Yilmaz")).toBeTruthy();
    expect(tab("Lina Duarte")).toBeTruthy();
    expect(tab("Tomas Reyes")).toBeTruthy();
    const input = tab("Your input");
    expect(input).toBeTruthy();
    expect(input?.className).toContain("board-panel-tab-input");
  });

  it("opens on the participant tab that owns the constraint a board press named", async () => {
    await mountPanel();
    // constraint-3 belongs to participant-design (Lina Duarte).
    await act(async () => shell.goToWorkspace("constraints", "constraint-3"));

    expect(tab("Lina Duarte")?.getAttribute("aria-selected")).toBe("true");
    const marked = markedRows();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.boardItem).toBe("constraint-3");
  });

  it("moves the mark, and the active tab, when a second item from another participant is pressed", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints", "constraint-3"));
    expect(tab("Lina Duarte")?.getAttribute("aria-selected")).toBe("true");

    // constraint-1 belongs to participant-product (Maya Okonkwo).
    await act(async () => shell.goToWorkspace("constraints", "constraint-1"));

    expect(tab("Maya Okonkwo")?.getAttribute("aria-selected")).toBe("true");
    const marked = markedRows();
    expect(marked).toHaveLength(1);
    expect(marked[0]?.dataset.boardItem).toBe("constraint-1");
  });

  it("opens on the first tab, marking nothing, when the whole workspace was opened", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    expect(tab("Maya Okonkwo")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelectorAll("[data-board-item]").length).toBeGreaterThan(0);
    expect(markedRows()).toHaveLength(0);
  });

  it("switches tabs on click without closing the panel", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("constraints"));

    const input = tab("Your input");
    await act(async () => input?.click());

    expect(input?.getAttribute("aria-selected")).toBe("true");
    expect(dialog()).not.toBeNull();
  });

  it("comes off when the close button is pressed", async () => {
    await mountPanel();
    await act(async () => shell.goToWorkspace("issues"));

    const close = container.querySelector<HTMLButtonElement>(".board-panel-close");
    expect(close).not.toBeNull();
    await act(async () => close?.click());

    expect(dialog()).toBeNull();
  });
});
