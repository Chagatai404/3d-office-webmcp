import { describe, expect, it } from "vitest";
import {
  anchoredFrame,
  BOTTOM_INSET,
  clampFrame,
  createWindows,
  EDGE_INSET,
  layoutWindows,
  MIN_HEIGHT,
  MIN_WIDTH,
  TOP_INSET,
  windowReducer,
  WINDOW_IDS,
  type Viewport,
  type WindowMap,
} from "@/components/shell/window-state";

/**
 * The desktop metaphor, driven without React.
 *
 * Window layout is presentation state, so nothing here touches room state, the
 * room client, or the 3D scene.
 */

const VIEWPORT: Viewport = { width: 1440, height: 900 };
const NARROW: Viewport = { width: 700, height: 620 };

function apply(
  state: WindowMap,
  ...actions: Parameters<typeof windowReducer>[1][]
): WindowMap {
  return actions.reduce(windowReducer, state);
}

describe("the opening layout", () => {
  it("opens the brief and the participants, and leaves the rest docked", () => {
    const windows = createWindows();

    expect(windows.brief.open).toBe(true);
    expect(windows.decision.open).toBe(false);
    expect(windows.participants.open).toBe(true);
    expect(windows.positions.open).toBe(false);
    expect(windows.activity.open).toBe(false);
    expect(windows.status.open).toBe(false);
    expect(windows.guide.open).toBe(false);
  });

  it("has no frame of its own until a window is moved", () => {
    const windows = createWindows();
    expect(WINDOW_IDS.every((id) => windows[id].frame === null)).toBe(true);
  });

  it("anchors an untouched window to its corner in any viewport", () => {
    const wide = anchoredFrame("participants", VIEWPORT);
    const narrow = anchoredFrame("participants", NARROW);

    // Top-right in both, so the layout follows the browser window.
    expect(wide.x + wide.width).toBe(VIEWPORT.width - EDGE_INSET);
    expect(narrow.x + narrow.width).toBe(NARROW.width - EDGE_INSET);
    expect(wide.y).toBe(TOP_INSET);
  });

  it("keeps every default window clear of the HUD and the dock", () => {
    for (const id of WINDOW_IDS) {
      const frame = anchoredFrame(id, VIEWPORT);
      expect(frame.x).toBeGreaterThanOrEqual(EDGE_INSET);
      expect(frame.y).toBeGreaterThanOrEqual(TOP_INSET);
      expect(frame.x + frame.width).toBeLessThanOrEqual(
        VIEWPORT.width - EDGE_INSET,
      );
      expect(frame.y + frame.height).toBeLessThanOrEqual(
        VIEWPORT.height - BOTTOM_INSET,
      );
    }
  });
});

describe("opening, closing, and stacking", () => {
  it("toggles a window open and shut", () => {
    const opened = apply(createWindows(), { type: "toggle", id: "activity" });
    expect(opened.activity.open).toBe(true);

    const closed = apply(opened, { type: "toggle", id: "activity" });
    expect(closed.activity.open).toBe(false);
  });

  it("puts a newly opened window on top", () => {
    const state = apply(createWindows(), { type: "open", id: "guide" });
    const top = Math.max(...WINDOW_IDS.map((id) => state[id].z));
    expect(state.guide.z).toBe(top);
  });

  it("raises a window on focus without opening or closing anything", () => {
    const state = apply(
      createWindows(),
      { type: "open", id: "activity" },
      { type: "focus", id: "brief" },
    );

    expect(state.brief.z).toBeGreaterThan(state.activity.z);
    expect(state.activity.open).toBe(true);
    expect(state.brief.open).toBe(true);
  });

  it("renders open windows back to front", () => {
    const state = apply(
      createWindows(),
      { type: "open", id: "activity" },
      { type: "focus", id: "brief" },
    );

    const order = layoutWindows(state, VIEWPORT).map((window) => window.id);
    expect(order.at(-1)).toBe("brief");
    expect(order).toContain("activity");
    expect(order).not.toContain("guide");
  });
});

describe("moving and resizing", () => {
  it("records where a window was dragged to", () => {
    const state = apply(createWindows(), {
      type: "place",
      id: "brief",
      frame: { x: 500, y: 300, width: 400, height: 250 },
      viewport: VIEWPORT,
    });

    expect(state.brief.frame).toEqual({
      x: 500,
      y: 300,
      width: 400,
      height: 250,
    });
  });

  it("never lets a window be dragged under the dock or off screen", () => {
    const state = apply(createWindows(), {
      type: "place",
      id: "brief",
      frame: { x: 9000, y: 9000, width: 400, height: 250 },
      viewport: VIEWPORT,
    });

    const placed = layoutWindows(state, VIEWPORT).find(
      (window) => window.id === "brief",
    );
    expect(placed?.frame.x).toBe(VIEWPORT.width - 400 - EDGE_INSET);
    expect(placed?.frame.y).toBe(VIEWPORT.height - BOTTOM_INSET - 250);
  });

  it("holds a window to its minimum size", () => {
    const frame = clampFrame({ x: 40, y: 200, width: 10, height: 10 }, VIEWPORT);
    expect(frame.width).toBe(MIN_WIDTH);
    expect(frame.height).toBe(MIN_HEIGHT);
  });

  it("shrinks a moved window to fit a smaller browser window", () => {
    const state = apply(
      createWindows(),
      { type: "open", id: "positions" },
      {
        type: "place",
        id: "positions",
        frame: { x: 40, y: 200, width: 900, height: 700 },
        viewport: VIEWPORT,
      },
    );

    const placed = layoutWindows(state, NARROW).find(
      (window) => window.id === "positions",
    );
    expect(placed?.frame.width).toBeLessThanOrEqual(NARROW.width - EDGE_INSET * 2);
    expect(placed?.frame.height).toBeLessThanOrEqual(
      NARROW.height - TOP_INSET - BOTTOM_INSET,
    );
  });

  it("returns everything to its anchor on reset", () => {
    const state = apply(
      createWindows(),
      {
        type: "place",
        id: "brief",
        frame: { x: 500, y: 300, width: 400, height: 250 },
        viewport: VIEWPORT,
      },
      { type: "open", id: "guide" },
      { type: "reset" },
    );

    expect(state).toEqual(createWindows());
  });
});
