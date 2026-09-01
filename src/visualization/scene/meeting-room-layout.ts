/**
 * Deterministic spatial layout for the one shared meeting room.
 *
 * Geometry and colour values are transcribed from the imported Claude Design
 * prototype (`meeting-stage.js`, project "AI Agent Decision Platform UI") so
 * the ported R3F scene matches it exactly at the seeded scenario's seat
 * count. Positions are pure data so the scene components stay declarative.
 */

/**
 * The shell, sized so nothing mounted on it pokes through it.
 *
 * The two angled corner boards reach 8.295 from the centre across and 6.719
 * back, and the Brief board's top edge is at 4.05 — all three of which the
 * original 16.4 x 12.6 x 3.4 shell was smaller than, so those boards cut
 * through the side walls, the back wall and the wall head respectively. These
 * are the smallest dimensions that clear every board with a hand's width to
 * spare, and the boards fixed to the walls follow the walls out.
 */
export const ROOM = {
  width: 16.9,
  depth: 13.7,
  wallHeight: 4.1,
} as const;

/** One stable colour system for the whole room, matching the design. */
export const SURFACE = {
  ground: "#e9e5dd",
  floor: "#d5cfc5",
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
  /* Cards written on a board. Nearly white, so a card reads as a crisp note
     laid on the near-white board rather than a faint patch the same value as
     the surface under it. Distinct from `card` (nameplates, other surfaces). */
  boardCard: "#fffefb",
  accent: "#d9f45b",
  attention: "#df8b5c",
  quiet: "#c7c2b8",
  avatarLimb: "#4a453e",
  avatarHead: "#2e2b27",
  /* Carried by the plant asset rather than any material here, but the room
     has one colour system and this is the only green in it. */
  foliage: "#8f9e6a",
  /* The three enclosed sides. Solid, and a shade lighter than the floor so a
     board reads as hung on a wall rather than floating in front of daylight. */
  wall: "#e0dbd2",
  /* Table top and the credenzas under the boards: the room's only warmth.
     Pale oak, not walnut — the room's light is warm (#fff7ea key over a
     #dfd8c9 bounce), so a saturated tan reads orange once it is lit. */
  wood: "#dcc5a4",
  /* Upholstery, carried by the chair asset. The one saturated tone in here. */
  chairFabric: "#8d88a6",
} as const;

/** The top of the floor slab: the height everything in the room stands on. */
export const FLOOR_TOP = 0.16;

/**
 * The rug, and what stands on it.
 *
 * `RUG_BASE` clears the floor slab by a hair on purpose. The slab's top face
 * and the rug's underside are the same plane at the same height, and the room
 * has already been bitten twice by coplanar faces flashing as the camera
 * moves — see the notes on the floor inlay and the base rim.
 */
export const RUG_BASE = 0.162;
export const RUG_TOP = RUG_BASE + 0.03;

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

/**
 * The credenza run under each board.
 *
 * `height` is not a taste decision: the lowest board in the room (Constraints
 * and Proposals, at 2.3 with a height of 3) has its bottom edge at 0.80, and
 * the run has to stop under it or it would cover a row of cards. Standing on
 * the floor slab, 0.64 lands the top exactly there.
 *
 * Laid as repeated modules rather than one long box, because a 6.5m cabinet
 * drawn as a single mesh reads as a plinth; the seams are what make it
 * furniture.
 */
export const CREDENZA = {
  height: 0.64,
  depth: 0.45,
  module: 1.6,
  gap: 0.025,
  /** The recessed dark base the body sits on. */
  toe: 0.09,
} as const;

/** Where a board's credenza run stands, in the board's own rotated frame. */
export function credenzaModules(width: number): number[] {
  const count = Math.max(1, Math.floor(width / CREDENZA.module));
  const span = count * CREDENZA.module + (count - 1) * CREDENZA.gap;
  return Array.from(
    { length: count },
    (_unused, index) => -span / 2 + CREDENZA.module / 2 + index * (CREDENZA.module + CREDENZA.gap),
  );
}

export const VOTE_PLINTH_POSITION: [number, number, number] = [-3.4, 0.16, 4.8];
export const DECISION_PEDESTAL_POSITION: [number, number, number] = [3.4, 0.16, 4.8];

export const CAMERA = { fov: 40 } as const;
