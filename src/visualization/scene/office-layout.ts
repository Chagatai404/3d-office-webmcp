import { OFFICE_SLOT_COUNT } from "@/visualization/room-view-model";

/**
 * Deterministic spatial layout for the office.
 *
 * Positions are pure data so the scene components stay declarative and so the
 * same participant always occupies the same office across reloads.
 */

export const GROUND = { width: 40, depth: 34 } as const;

export const MEETING_ROOM = {
  width: 14,
  depth: 11,
  platformHeight: 0.16,
  wallHeight: 2.6,
  position: [0, 0, 0] as const,
};

export const OFFICE = {
  width: 5.6,
  depth: 4.6,
  wallHeight: 2.35,
  /** Left column is negative X, right column is positive X. */
  columnOffsetX: 11.6,
  rowSpacing: 4.9,
};

export const COMMON_AREA = {
  width: 22,
  depth: 6,
  position: [0, 0, 11.5] as const,
};

export const CONSTRAINT_WALL = {
  width: 24,
  height: 4.6,
  position: [0, 0, -12.6] as const,
  /** Cards are laid out on a grid across the wall face. */
  columns: 8,
  rows: 4,
  cardSize: 2.4,
};

/**
 * Lens only. Where the camera stands is a navigation concern and lives with
 * the other camera poses in `scene-focus.ts`.
 */
export const CAMERA = {
  fov: 42,
};

export const SURFACE = {
  ground: "#0d141c",
  officeFloor: "#213142",
  officeFloorReserved: "#192330",
  officeWall: "#6fb8d8",
  officeWallReserved: "#405967",
  officeGlass: "#bdefff",
  officeGlassReserved: "#7daabc",
  officeFrame: "#d7e4ee",
  officeFrameReserved: "#617184",
  meetingFloor: "#33465d",
  meetingWall: "#29425e",
  commonFloor: "#243542",
  constraintWall: "#22364d",
  desk: "#b48a5f",
  deskAccent: "#76563a",
  chair: "#60778c",
  chairAccent: "#2b3947",
  table: "#b78a55",
  tableAccent: "#6d4e2f",
  board: "#e8eef4",
  boardFrame: "#4a688a",
  plant: "#3f8f5a",
  plantPot: "#8a5a3c",
  screen: "#0e1a24",
  avatarLimb: "#3f4f60",
  avatarHead: "#26323f",
} as const;

/** One stable colour per office slot, used for the office and its cards. */
export const SLOT_COLORS: readonly string[] = [
  "#5eead4",
  "#a78bfa",
  "#fbbf24",
  "#fb7185",
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#facc15",
  "#c084fc",
  "#4ade80",
];

export function slotColor(index: number): string {
  return SLOT_COLORS[index % SLOT_COLORS.length] ?? "#94a3b8";
}

export interface OfficePlacement {
  index: number;
  position: [number, number, number];
  /** Offices face the meeting room, so the left column is mirrored. */
  rotationY: number;
  side: "left" | "right";
}

/**
 * Five offices per side, ordered so the first joiners sit closest to the
 * middle of the room rather than filling one wall first.
 */
export function officePlacements(): OfficePlacement[] {
  const rowOrder = [0, -1, 1, -2, 2];

  return Array.from({ length: OFFICE_SLOT_COUNT }, (_unused, index) => {
    const side = index % 2 === 0 ? "left" : "right";
    const row = rowOrder[Math.floor(index / 2)] ?? 0;
    const x = (side === "left" ? -1 : 1) * OFFICE.columnOffsetX;

    return {
      index,
      position: [x, 0, row * OFFICE.rowSpacing] as [number, number, number],
      rotationY: side === "left" ? Math.PI / 2 : -Math.PI / 2,
      side,
    };
  });
}

export interface MeetingSeat {
  index: number;
  position: [number, number, number];
  /** Seats face the middle of the table. */
  rotationY: number;
  side: "near" | "far";
}

/**
 * One seat per office, so a participant's place at the table is as fixed as
 * their office is.
 *
 * Five down each long side of the table, ordered the way the offices are: the
 * first joiners sit at the middle facing each other rather than filling one
 * side first. Y stays zero — the meeting room adds its own platform height.
 */
export function meetingSeats(): MeetingSeat[] {
  const columnOrder = [0, -1, 1, -2, 2];
  const columnSpacing = 1.55;
  const sideOffsetZ = 2.6;

  return Array.from({ length: OFFICE_SLOT_COUNT }, (_unused, index) => {
    const side = index % 2 === 0 ? "far" : "near";
    const column = columnOrder[Math.floor(index / 2)] ?? 0;
    const z = (side === "far" ? -1 : 1) * sideOffsetZ;

    return {
      index,
      position: [column * columnSpacing, 0, z] as [number, number, number],
      // Avatars and chairs both face +Z unrotated, so the far side needs none.
      rotationY: side === "near" ? Math.PI : 0,
      side,
    };
  });
}

export interface RoamingCircuit {
  /** Half-extents of the loop, measured from the middle of the office. */
  halfX: number;
  halfZ: number;
  cornerRadius: number;
  /** Where on the loop this participant starts, in turns. */
  offset: number;
}

/**
 * The corridor loop a participant walks when they are neither at a desk nor at
 * the table.
 *
 * Four concentric rounded rectangles run in the corridor between the meeting
 * room and the offices. Every ring encloses the meeting room and stays inside
 * the office wall, so a walking participant never crosses a wall — pinned by
 * `tests/visualization/roaming-circuit.test.ts`. Ring and starting offset both
 * come from the office slot, so the same participant always walks the same
 * loop and two of them never occupy the same spot.
 */
export const ROAMING = {
  outerHalfX: 8.6,
  outerHalfZ: 7.6,
  cornerRadius: 1.4,
  ringSpacing: 0.36,
  ringCount: 4,
  /** Laps per second: a walking pace on a loop this size. */
  speed: 0.022,
} as const;

export function roamingCircuit(slotIndex: number): RoamingCircuit {
  const ring = slotIndex % ROAMING.ringCount;

  return {
    halfX: ROAMING.outerHalfX - ring * ROAMING.ringSpacing,
    halfZ: ROAMING.outerHalfZ - ring * ROAMING.ringSpacing,
    cornerRadius: ROAMING.cornerRadius,
    // The golden ratio spreads consecutive slots around the loop, so the two
    // or three participants sharing a ring stay far apart on it.
    offset: (slotIndex * 0.6180339887) % 1,
  };
}

export function circuitPerimeter(circuit: RoamingCircuit): number {
  const straightX = 2 * (circuit.halfX - circuit.cornerRadius);
  const straightZ = 2 * (circuit.halfZ - circuit.cornerRadius);
  return 2 * straightX + 2 * straightZ + 2 * Math.PI * circuit.cornerRadius;
}

export interface CircuitPoint {
  position: [number, number, number];
  /** Facing along the direction of travel. */
  rotationY: number;
}

type CircuitLeg =
  | { kind: "line"; length: number; from: [number, number]; to: [number, number] }
  | { kind: "arc"; length: number; center: [number, number]; startAngle: number };

/**
 * The loop, split into the straights and the quarter turns that join them.
 *
 * It starts at the middle of the side nearest the common area and runs the
 * long way round. Every corner sweeps a quarter turn clockwise, so one formula
 * covers all four.
 */
function circuitLegs(circuit: RoamingCircuit): CircuitLeg[] {
  const { halfX, halfZ, cornerRadius } = circuit;
  const cornerX = halfX - cornerRadius;
  const cornerZ = halfZ - cornerRadius;
  const quarter = (Math.PI * cornerRadius) / 2;

  const line = (
    from: [number, number],
    to: [number, number],
  ): CircuitLeg => ({
    kind: "line",
    length: Math.hypot(to[0] - from[0], to[1] - from[1]),
    from,
    to,
  });

  const arc = (center: [number, number], startAngle: number): CircuitLeg => ({
    kind: "arc",
    length: quarter,
    center,
    startAngle,
  });

  return [
    line([0, halfZ], [cornerX, halfZ]),
    arc([cornerX, cornerZ], Math.PI / 2),
    line([halfX, cornerZ], [halfX, -cornerZ]),
    arc([cornerX, -cornerZ], 0),
    line([cornerX, -halfZ], [-cornerX, -halfZ]),
    arc([-cornerX, -cornerZ], -Math.PI / 2),
    line([-halfX, -cornerZ], [-halfX, cornerZ]),
    arc([-cornerX, cornerZ], -Math.PI),
    line([-cornerX, halfZ], [0, halfZ]),
  ];
}

const SWEEP = -Math.PI / 2;

/**
 * Where a walk has reached after `turns` laps, and which way it is facing.
 *
 * Pure, so a walking participant is a function of the clock rather than of
 * accumulated frame state: the office looks the same however long a tab has
 * been open or how many frames it dropped. Y is zero — the walk is on the
 * floor.
 */
export function circuitPoint(
  circuit: RoamingCircuit,
  turns: number,
): CircuitPoint {
  const perimeter = circuitPerimeter(circuit);
  // Any elapsed time is somewhere on the loop, forwards or backwards.
  const lap = ((turns % 1) + 1) % 1;
  let travelled = lap * perimeter;

  for (const leg of circuitLegs(circuit)) {
    if (travelled > leg.length) {
      travelled -= leg.length;
      continue;
    }

    const progress = leg.length === 0 ? 0 : travelled / leg.length;

    if (leg.kind === "line") {
      const x = leg.from[0] + (leg.to[0] - leg.from[0]) * progress;
      const z = leg.from[1] + (leg.to[1] - leg.from[1]) * progress;
      return {
        position: [x, 0, z],
        rotationY: Math.atan2(leg.to[0] - leg.from[0], leg.to[1] - leg.from[1]),
      };
    }

    const angle = leg.startAngle + SWEEP * progress;
    return {
      position: [
        leg.center[0] + Math.cos(angle) * circuit.cornerRadius,
        0,
        leg.center[1] + Math.sin(angle) * circuit.cornerRadius,
      ],
      // Tangent of a clockwise sweep, so the walk faces where it is going.
      rotationY: Math.atan2(Math.sin(angle), -Math.cos(angle)),
    };
  }

  // Only reachable through floating-point drift at the very end of a lap.
  return { position: [0, 0, circuit.halfZ], rotationY: Math.PI / 2 };
}
