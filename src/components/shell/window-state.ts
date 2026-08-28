/**
 * Layout state for the windows that float over the 3D office.
 *
 * Pure and framework-free on purpose: this is the whole desktop metaphor —
 * which windows are open, where they sit, and which one is on top — with no
 * React, no DOM, and no room state. Tests drive it directly.
 *
 * A window keeps `frame: null` until someone moves or resizes it, and until
 * then it stays anchored to its corner. That is what lets the layout follow a
 * resized browser window without ever overriding a choice the viewer made.
 */

export type WindowId =
  | "brief"
  | "positions"
  | "participants"
  | "activity"
  | "status"
  | "guide";

export type WindowAnchor =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "center";

export interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  id: WindowId;
  open: boolean;
  /** Higher is nearer the viewer. */
  z: number;
  /** `null` while the window still sits where it opened. */
  frame: WindowFrame | null;
}

export type WindowMap = Record<WindowId, WindowState>;

/** A window with its frame worked out against the current viewport. */
export interface PlacedWindow extends WindowState {
  frame: WindowFrame;
}

export interface Viewport {
  width: number;
  height: number;
}

interface WindowDefault {
  id: WindowId;
  width: number;
  height: number;
  anchor: WindowAnchor;
  open: boolean;
}

/** Space the HUD and the dock reserve, so no window opens underneath them. */
export const EDGE_INSET = 16;
export const TOP_INSET = 108;
export const BOTTOM_INSET = 88;
export const MIN_WIDTH = 280;
export const MIN_HEIGHT = 180;

/** Each window is offset from the previous one sharing its corner. */
const CASCADE = 26;

export const WINDOW_DEFAULTS: readonly WindowDefault[] = [
  { id: "brief", width: 400, height: 250, anchor: "top-left", open: true },
  {
    id: "participants",
    width: 420,
    height: 460,
    anchor: "top-right",
    open: true,
  },
  {
    id: "positions",
    width: 560,
    height: 520,
    anchor: "bottom-left",
    open: false,
  },
  {
    id: "activity",
    width: 520,
    height: 400,
    anchor: "bottom-right",
    open: false,
  },
  { id: "status", width: 420, height: 300, anchor: "top-left", open: false },
  { id: "guide", width: 380, height: 340, anchor: "center", open: false },
];

export const WINDOW_IDS: readonly WindowId[] = WINDOW_DEFAULTS.map(
  (definition) => definition.id,
);

const DEFAULT_BY_ID = new Map(
  WINDOW_DEFAULTS.map((definition) => [definition.id, definition]),
);

/** How many windows already share this one's corner, for the cascade. */
const CASCADE_INDEX = new Map<WindowId, number>();
{
  const seen = new Map<WindowAnchor, number>();
  for (const definition of WINDOW_DEFAULTS) {
    const index = seen.get(definition.anchor) ?? 0;
    CASCADE_INDEX.set(definition.id, index);
    seen.set(definition.anchor, index + 1);
  }
}

function windowDefault(id: WindowId): WindowDefault {
  const definition = DEFAULT_BY_ID.get(id);
  if (!definition) throw new Error(`No window is registered as "${id}".`);
  return definition;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/** Keeps a window inside the viewport, clear of the HUD and the dock. */
export function clampFrame(frame: WindowFrame, viewport: Viewport): WindowFrame {
  const maxWidth = Math.max(MIN_WIDTH, viewport.width - EDGE_INSET * 2);
  const maxHeight = Math.max(
    MIN_HEIGHT,
    viewport.height - TOP_INSET - BOTTOM_INSET,
  );
  const width = clamp(frame.width, MIN_WIDTH, maxWidth);
  const height = clamp(frame.height, MIN_HEIGHT, maxHeight);

  return {
    width,
    height,
    x: clamp(frame.x, EDGE_INSET, viewport.width - width - EDGE_INSET),
    y: clamp(frame.y, TOP_INSET, viewport.height - BOTTOM_INSET - height),
  };
}

/** Where a window sits before anyone has moved it. */
export function anchoredFrame(id: WindowId, viewport: Viewport): WindowFrame {
  const definition = windowDefault(id);
  const { width, height } = definition;
  const cascade = (CASCADE_INDEX.get(id) ?? 0) * CASCADE;
  const right = viewport.width - width - EDGE_INSET;
  const bottom = viewport.height - BOTTOM_INSET - height;

  const base: Record<WindowAnchor, { x: number; y: number }> = {
    "top-left": { x: EDGE_INSET, y: TOP_INSET },
    "top-right": { x: right, y: TOP_INSET },
    "bottom-left": { x: EDGE_INSET, y: bottom },
    "bottom-right": { x: right, y: bottom },
    center: {
      x: (viewport.width - width) / 2,
      y: (viewport.height - height) / 2,
    },
  };

  const { x, y } = base[definition.anchor];
  const direction = definition.anchor.includes("right") ? -1 : 1;

  return clampFrame(
    { width, height, x: x + cascade * direction, y: y + cascade },
    viewport,
  );
}

/** The opening layout: two windows up, the rest waiting in the dock. */
export function createWindows(): WindowMap {
  const entries = WINDOW_DEFAULTS.map(
    (definition, index) =>
      [
        definition.id,
        {
          id: definition.id,
          open: definition.open,
          z: index + 1,
          frame: null,
        },
      ] as const,
  );

  return Object.fromEntries(entries) as WindowMap;
}

export type WindowAction =
  | { type: "open"; id: WindowId }
  | { type: "close"; id: WindowId }
  | { type: "toggle"; id: WindowId }
  | { type: "focus"; id: WindowId }
  | { type: "place"; id: WindowId; frame: WindowFrame; viewport: Viewport }
  | { type: "reset" };

function topZ(state: WindowMap): number {
  return Math.max(...WINDOW_IDS.map((id) => state[id].z));
}

/** Raises a window without changing whether it is open. */
function raise(state: WindowMap, id: WindowId): WindowMap {
  const window = state[id];
  if (window.z === topZ(state)) return state;
  return { ...state, [id]: { ...window, z: topZ(state) + 1 } };
}

export function windowReducer(
  state: WindowMap,
  action: WindowAction,
): WindowMap {
  switch (action.type) {
    case "open": {
      const raised = raise(state, action.id);
      const window = raised[action.id];
      if (window.open) return raised;
      return { ...raised, [action.id]: { ...window, open: true } };
    }

    case "close":
      return { ...state, [action.id]: { ...state[action.id], open: false } };

    case "toggle":
      return state[action.id].open
        ? windowReducer(state, { type: "close", id: action.id })
        : windowReducer(state, { type: "open", id: action.id });

    case "focus":
      return raise(state, action.id);

    case "place":
      return {
        ...state,
        [action.id]: {
          ...state[action.id],
          frame: clampFrame(action.frame, action.viewport),
        },
      };

    case "reset":
      return createWindows();

    default:
      return state;
  }
}

/** Open windows, back to front, with their frames resolved for this viewport. */
export function layoutWindows(
  state: WindowMap,
  viewport: Viewport,
): PlacedWindow[] {
  return WINDOW_IDS.map((id) => state[id])
    .filter((window) => window.open)
    .sort((left, right) => left.z - right.z)
    .map((window) => ({
      ...window,
      frame: window.frame
        ? clampFrame(window.frame, viewport)
        : anchoredFrame(window.id, viewport),
    }));
}
