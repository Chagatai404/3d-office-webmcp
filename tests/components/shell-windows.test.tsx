// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomProvider } from "@/components/room/room-provider";
import { Dock } from "@/components/shell/dock";
import { OsWindow } from "@/components/shell/os-window";
import { useShell, WorldShellProvider } from "@/components/shell/shell-provider";
import { layoutWindows } from "@/components/shell/window-state";
import { resetRoomClient } from "@/room-client/room-client";
import type { SceneZoneId } from "@/visualization/scene/scene-focus";

/**
 * The shell wiring, without WebGL.
 *
 * The 3D canvas is deliberately not mounted: what a click in the office does
 * is call `visitZone`, and that is exactly what this drives. If a place in the
 * office opens the right panel here, it opens it in the scene too.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let visit: ((zone: SceneZoneId) => void) | null = null;

/** Stands in for a click in the 3D office, which the canvas cannot do here. */
function VisitProbe() {
  const { visitZone } = useShell();
  useEffect(() => {
    visit = visitZone;
  }, [visitZone]);
  return null;
}

/** The window layer, exactly as the shell renders it. */
function WindowLayer() {
  const { ready, windows, viewport } = useShell();
  if (!ready) return null;

  return (
    <>
      {layoutWindows(windows, viewport).map((window) => (
        <OsWindow key={window.id} window={window} />
      ))}
    </>
  );
}

async function mountShell() {
  await act(async () => {
    root.render(
      <RoomProvider roomId="demo">
        <WorldShellProvider>
          <VisitProbe />
          <WindowLayer />
          <Dock />
        </WorldShellProvider>
      </RoomProvider>,
    );
  });
}

function windowTitles(): string[] {
  return [...container.querySelectorAll(".window-title")].map(
    (title) => title.textContent ?? "",
  );
}

/** Attribute selectors carrying an ampersand are not reliable in jsdom. */
function requireCloseButton(title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.getAttribute("aria-label") === `Close ${title}`,
  );
  if (!button) throw new Error(`The "${title}" window has no close button.`);
  return button;
}

function requireDockButton(label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`No dock button for "${label}".`);
  return button;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  visit = null;
  resetRoomClient();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("the window shell over the office", () => {
  it("opens with the brief and the participants, and nothing else", async () => {
    await mountShell();

    expect(windowTitles()).toEqual([
      "Decision brief",
      "Participants & offices",
    ]);
    expect(container.textContent).toContain("Maya Okonkwo");
  });

  it("opens a panel from the dock and closes it again", async () => {
    await mountShell();

    await click(requireDockButton("Activity & audit ledger"));
    expect(windowTitles()).toContain("Activity & audit ledger");
    expect(container.textContent).toContain("Browser agent");

    await click(requireCloseButton("Activity & audit ledger"));

    expect(windowTitles()).not.toContain("Activity & audit ledger");
  });

  it("opens the positions panel when the constraint wall is visited", async () => {
    await mountShell();
    expect(windowTitles()).not.toContain("Positions & constraints");

    // Exactly what clicking the wall in the 3D office does.
    await act(async () => {
      visit?.("constraint-wall");
    });

    expect(windowTitles()).toContain("Positions & constraints");
    expect(container.textContent).toContain(
      "Every new onboarding step needs an accessibility review",
    );
  });

  it("opens the participants panel when an office is visited", async () => {
    await mountShell();

    await click(requireCloseButton("Participants & offices"));
    expect(windowTitles()).not.toContain("Participants & offices");

    await act(async () => {
      visit?.("office-2");
    });

    expect(windowTitles()).toContain("Participants & offices");
  });

  it("marks the dock button of an open panel as pressed", async () => {
    await mountShell();

    expect(requireDockButton("Decision brief").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      requireDockButton("Getting around").getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("keeps every place in the office reachable without the canvas", async () => {
    await mountShell();

    for (const place of [
      "Whole office",
      "Meeting room",
      "Constraint wall",
      "Common area",
    ]) {
      expect(requireDockButton(place)).toBeTruthy();
    }
  });
});
