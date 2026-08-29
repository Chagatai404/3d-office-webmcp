/**
 * Deterministic spatial layout for the one shared meeting room.
 *
 * Geometry and colour values are transcribed from the imported Claude Design
 * prototype (`meeting-stage.js`, project "AI Agent Decision Platform UI") so
 * the ported R3F scene matches it exactly at the seeded scenario's seat
 * count. Positions are pure data so the scene components stay declarative.
 */

export const ROOM = {
  width: 16.4,
  depth: 12.6,
  wallHeight: 3.4,
} as const;

/** One stable colour system for the whole room, matching the design. */
export const SURFACE = {
  ground: "#e9e5dd",
  floor: "#f4f1ea",
  inlay: "#e3dfd5",
  frame: "#2e2b27",
  glass: "#d8e5e7",
  tableTop: "#eae6dd",
  tableBase: "#3a3630",
  seat: "#d2cdc3",
  seatDark: "#4a453e",
  boardDark: "#2e2b27",
  boardLight: "#f8f6f1",
  card: "#e6e2d8",
  accent: "#d9f45b",
  attention: "#df8b5c",
  quiet: "#c7c2b8",
  avatarLimb: "#4a453e",
  avatarHead: "#2e2b27",
} as const;

export interface MeetingSeat {
  index: number;
  position: [number, number, number];
  /** Seats face the middle of the table. */
  rotationY: number;
}

/**
 * `N` evenly-spaced seats around the table, matching the design's exact 4
 * angles (45°/135°/225°/315°) when `count` is 4, and growing gracefully
 * beyond it so a larger room never loses a participant.
 */
export function meetingSeats(count: number): MeetingSeat[] {
  const n = Math.max(count, 1);
  const overflow = Math.max(0, n - 4);
  const radius = 3.1 + 0.12 * overflow;

  return Array.from({ length: n }, (_unused, index) => {
    const angle = (2 * Math.PI * index) / n + Math.PI / 4;
    return {
      index,
      position: [Math.sin(angle) * radius, 0, Math.cos(angle) * radius],
      rotationY: angle + Math.PI,
    };
  });
}

/** How far the table top grows past four seats, so it never looks crowded. */
export function tableRadius(count: number): number {
  return 2.1 + 0.08 * Math.max(0, count - 4);
}

export interface BoardPlacement {
  width: number;
  height: number;
  position: [number, number, number];
  rotationY: number;
}

/**
 * One wall-mounted board per decision workspace, positioned exactly as in
 * the source design: Brief on the back wall, Constraints on the left wall,
 * Proposals on the right wall, Issues and Whiteboard in the back corners.
 */
export const BOARDS: Record<
  "brief" | "constraints" | "proposals" | "issues" | "whiteboard",
  BoardPlacement
> = {
  brief: {
    width: 7.4,
    height: 3.1,
    position: [0, 2.5, -ROOM.depth / 2 + 0.12],
    rotationY: 0,
  },
  constraints: {
    width: 7,
    height: 3,
    position: [-ROOM.width / 2 + 0.14, 2.3, 0],
    rotationY: Math.PI / 2,
  },
  proposals: {
    width: 7,
    height: 3,
    position: [ROOM.width / 2 - 0.14, 2.3, 0],
    rotationY: -Math.PI / 2,
  },
  issues: {
    width: 4.6,
    height: 2.7,
    position: [6.4, 2.2, -5.35],
    rotationY: -0.62,
  },
  whiteboard: {
    width: 4.6,
    height: 2.7,
    position: [-6.4, 2.2, -5.35],
    rotationY: 0.62,
  },
};

export const VOTE_PLINTH_POSITION: [number, number, number] = [-3.4, 0.16, 4.8];
export const DECISION_PEDESTAL_POSITION: [number, number, number] = [3.4, 0.16, 4.8];

export const CAMERA = { fov: 40 } as const;
