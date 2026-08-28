/**
 * Architectural geometry for the 2D floor plan.
 *
 * Pure data and pure functions: no React, no room state, no I/O. The plan is
 * drawn top-down in a single SVG user space, so every coordinate here is in
 * plan units and the canvas only ever changes the viewBox.
 *
 * This module is deliberately independent of `visualization/scene/`. The 2D
 * plan and the 3D office are two separate projections of the same canonical
 * `RoomState`, and neither owns the other's layout.
 */

export const PLAN_VIEWBOX = { width: 1440, height: 1100 } as const;

/** Structural wall thickness, drawn as a stroke centred on the room edge. */
export const WALL = 15;

/** Furniture is drawn as thin line art, the way a floor plan renders it. */
export const LINE = 1.6;

export interface PlanRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanPoint {
  x: number;
  y: number;
}

export function rectCentre(rect: PlanRect): PlanPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Shrinks a rect by `inset` on every side. Used to keep furniture off walls. */
export function inset(rect: PlanRect, amount: number): PlanRect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: rect.width - amount * 2,
    height: rect.height - amount * 2,
  };
}

/* -------------------------------------------------------------------------
 * The building
 *
 * A centre block holding the meeting room, two office wings, and a corridor
 * that runs down both wings and across the south end so every room opens onto
 * circulation rather than onto another room.
 * ---------------------------------------------------------------------- */

const BUILDING = { x: 20, y: 20, width: 1400, height: 1060 } as const;

const WING_WIDTH = 296;
const CORRIDOR_WIDTH = 66;

const OFFICE_ROWS = 5;
const OFFICE_ROW_HEIGHT = 156;
const OFFICE_BAND_TOP = BUILDING.y;
const OFFICE_BAND_HEIGHT = OFFICE_ROWS * OFFICE_ROW_HEIGHT;

const LEFT_WING_X = BUILDING.x;
const WEST_CORRIDOR_X = LEFT_WING_X + WING_WIDTH;
const CENTRE_X = WEST_CORRIDOR_X + CORRIDOR_WIDTH;
const RIGHT_WING_X = BUILDING.x + BUILDING.width - WING_WIDTH;
const EAST_CORRIDOR_X = RIGHT_WING_X - CORRIDOR_WIDTH;
const CENTRE_WIDTH = EAST_CORRIDOR_X - CENTRE_X;

const SOUTH_CORRIDOR_Y = OFFICE_BAND_TOP + OFFICE_BAND_HEIGHT;
const SOUTH_CORRIDOR_HEIGHT = 72;
const SOUTH_BAND_Y = SOUTH_CORRIDOR_Y + SOUTH_CORRIDOR_HEIGHT;
const SOUTH_BAND_HEIGHT = BUILDING.y + BUILDING.height - SOUTH_BAND_Y;

export const MEETING_ROOM: PlanRect = {
  x: CENTRE_X,
  y: OFFICE_BAND_TOP,
  width: CENTRE_WIDTH,
  height: OFFICE_BAND_HEIGHT,
};

export const CONSTRAINT_WALL: PlanRect = {
  x: BUILDING.x,
  y: SOUTH_BAND_Y,
  width: 700,
  height: SOUTH_BAND_HEIGHT,
};

export const COMMON_AREA: PlanRect = {
  x: CONSTRAINT_WALL.x + CONSTRAINT_WALL.width,
  y: SOUTH_BAND_Y,
  width: BUILDING.x + BUILDING.width - (CONSTRAINT_WALL.x + CONSTRAINT_WALL.width),
  height: SOUTH_BAND_HEIGHT,
};

/** Circulation. Drawn as floor, never as a room, and never selectable. */
export const CORRIDORS: readonly PlanRect[] = [
  { x: WEST_CORRIDOR_X, y: OFFICE_BAND_TOP, width: CORRIDOR_WIDTH, height: OFFICE_BAND_HEIGHT },
  { x: EAST_CORRIDOR_X, y: OFFICE_BAND_TOP, width: CORRIDOR_WIDTH, height: OFFICE_BAND_HEIGHT },
  { x: BUILDING.x, y: SOUTH_CORRIDOR_Y, width: BUILDING.width, height: SOUTH_CORRIDOR_HEIGHT },
];

export const BUILDING_OUTLINE: PlanRect = BUILDING;

/* -------------------------------------------------------------------------
 * Offices
 * ---------------------------------------------------------------------- */

export const OFFICE_SLOT_COUNT = 10;

export type OfficeSide = "left" | "right";

export interface OfficePlacement {
  index: number;
  side: OfficeSide;
  rect: PlanRect;
  /** The wall the door is cut into: offices open onto the wing corridor. */
  doorSide: "e" | "w";
}

/**
 * Five offices per wing, filled from the middle of the wing outwards so the
 * first participants to join sit closest to the meeting room rather than
 * packing one end of the building.
 */
const ROW_ORDER: readonly number[] = [2, 1, 3, 0, 4];

export function officePlacements(): OfficePlacement[] {
  return Array.from({ length: OFFICE_SLOT_COUNT }, (_unused, index) => {
    const side: OfficeSide = index % 2 === 0 ? "left" : "right";
    const row = ROW_ORDER[Math.floor(index / 2)] ?? 0;

    return {
      index,
      side,
      rect: {
        x: side === "left" ? LEFT_WING_X : RIGHT_WING_X,
        y: OFFICE_BAND_TOP + row * OFFICE_ROW_HEIGHT,
        width: WING_WIDTH,
        height: OFFICE_ROW_HEIGHT,
      },
      doorSide: side === "left" ? "e" : "w",
    };
  });
}

/**
 * Where an occupant sits when they are working in their own office: in the
 * task chair at their own desk, clear of the room's name plate.
 */
export function officeStandingSpot(placement: OfficePlacement): PlanPoint {
  return officeFurniture(placement).chair;
}

/** The desk, monitor, chair, and shelf drawn inside one office. */
export interface OfficeFurniture {
  desk: PlanRect;
  monitor: PlanRect;
  chair: PlanPoint;
  shelf: PlanRect;
  plant: PlanPoint;
}

export function officeFurniture(placement: OfficePlacement): OfficeFurniture {
  const room = inset(placement.rect, WALL / 2 + 14);
  const facingLeft = placement.side === "left";
  const deskWidth = 132;
  const deskHeight = 46;
  const deskX = facingLeft ? room.x : room.x + room.width - deskWidth;
  const deskY = room.y + 10;

  return {
    desk: { x: deskX, y: deskY, width: deskWidth, height: deskHeight },
    monitor: {
      x: deskX + (facingLeft ? 16 : deskWidth - 50),
      y: deskY + 12,
      width: 34,
      height: 22,
    },
    chair: { x: deskX + deskWidth / 2, y: deskY + deskHeight + 26 },
    shelf: {
      x: facingLeft ? room.x : room.x + room.width - 58,
      y: room.y + room.height - 34,
      width: 58,
      height: 24,
    },
    plant: {
      x: facingLeft ? room.x + room.width - 22 : room.x + 22,
      y: room.y + room.height - 22,
    },
  };
}

/* -------------------------------------------------------------------------
 * The meeting table
 * ---------------------------------------------------------------------- */

export const MEETING_TABLE = {
  centre: rectCentre(MEETING_ROOM),
  radiusX: 150,
  radiusY: 252,
} as const;

export interface MeetingSeat {
  index: number;
  position: PlanPoint;
  /** Which edge of the table the seat is on, so the chair can face inwards. */
  edge: "west" | "east" | "north" | "south";
}

/**
 * Ten seats around the oval: four down each long side and one at each end.
 *
 * Ordered so office slot `n` always takes seat `n`, and so the first four
 * seats face each other across the middle of the table.
 */
export function meetingSeats(): MeetingSeat[] {
  const { centre, radiusX, radiusY } = MEETING_TABLE;
  const sideOffset = radiusX + 38;
  const endOffset = radiusY + 40;
  const rows = [-150, -50, 50, 150];
  const rowOrder = [1, 2, 0, 3];

  const seats: MeetingSeat[] = [];
  for (let pair = 0; pair < 4; pair += 1) {
    const y = centre.y + (rows[rowOrder[pair] ?? 0] ?? 0);
    seats.push({
      index: pair * 2,
      position: { x: centre.x - sideOffset, y },
      edge: "west",
    });
    seats.push({
      index: pair * 2 + 1,
      position: { x: centre.x + sideOffset, y },
      edge: "east",
    });
  }

  seats.push({
    index: 8,
    position: { x: centre.x, y: centre.y - endOffset },
    edge: "north",
  });
  seats.push({
    index: 9,
    position: { x: centre.x, y: centre.y + endOffset },
    edge: "south",
  });

  return seats.sort((a, b) => a.index - b.index);
}

/** Whiteboard on the meeting room's north wall, and a plant in the corner. */
export const MEETING_FIXTURES = {
  whiteboard: {
    x: MEETING_ROOM.x + MEETING_ROOM.width / 2 - 110,
    y: MEETING_ROOM.y + WALL / 2 + 4,
    width: 220,
    height: 14,
  } satisfies PlanRect,
  credenza: {
    x: MEETING_ROOM.x + MEETING_ROOM.width / 2 - 70,
    y: MEETING_ROOM.y + MEETING_ROOM.height - WALL / 2 - 34,
    width: 140,
    height: 26,
  } satisfies PlanRect,
  plant: {
    x: MEETING_ROOM.x + 40,
    y: MEETING_ROOM.y + MEETING_ROOM.height - 44,
  } satisfies PlanPoint,
} as const;

/* -------------------------------------------------------------------------
 * Constraint wall
 * ---------------------------------------------------------------------- */

/** The hatched wall band the constraint cards are pinned to. */
export const CONSTRAINT_BOARD = {
  band: {
    x: CONSTRAINT_WALL.x + WALL / 2,
    y: CONSTRAINT_WALL.y + CONSTRAINT_WALL.height - WALL / 2 - 20,
    width: CONSTRAINT_WALL.width - WALL,
    height: 20,
  } satisfies PlanRect,
  columns: 5,
  rows: 2,
  card: { width: 104, height: 58 },
  gap: 12,
} as const;

/** How many constraint cards the board can show before it overflows. */
export const CONSTRAINT_CARD_CAPACITY =
  CONSTRAINT_BOARD.columns * CONSTRAINT_BOARD.rows;

export function constraintCardRect(slot: number): PlanRect {
  const { columns, card, gap } = CONSTRAINT_BOARD;
  const column = slot % columns;
  const row = Math.floor(slot / columns);
  const gridWidth = columns * card.width + (columns - 1) * gap;
  const startX = CONSTRAINT_WALL.x + (CONSTRAINT_WALL.width - gridWidth) / 2;
  const startY = CONSTRAINT_WALL.y + WALL / 2 + 42;

  return {
    x: startX + column * (card.width + gap),
    y: startY + row * (card.height + gap),
    width: card.width,
    height: card.height,
  };
}

/* -------------------------------------------------------------------------
 * Common area
 * ---------------------------------------------------------------------- */

const commonInner = inset(COMMON_AREA, WALL / 2 + 18);

export const COMMON_FIXTURES = {
  noticeBoard: {
    x: commonInner.x + commonInner.width - 320,
    y: commonInner.y,
    width: 320,
    height: 78,
  } satisfies PlanRect,
  couchNorth: {
    x: commonInner.x,
    y: commonInner.y + 6,
    width: 150,
    height: 38,
  } satisfies PlanRect,
  coffeeTable: {
    x: commonInner.x + 36,
    y: commonInner.y + 54,
    width: 78,
    height: 30,
  } satisfies PlanRect,
  couchSouth: {
    x: commonInner.x,
    y: commonInner.y + 94,
    width: 150,
    height: 38,
  } satisfies PlanRect,
  counter: {
    x: commonInner.x + commonInner.width - 200,
    y: commonInner.y + 106,
    width: 200,
    height: 34,
  } satisfies PlanRect,
  plant: { x: commonInner.x + 196, y: commonInner.y + 116 } satisfies PlanPoint,
} as const;

/** Stairs in the south corridor, drawn as hatched treads. */
export const STAIRS: PlanRect = {
  x: BUILDING.x + 40,
  y: SOUTH_CORRIDOR_Y + 12,
  width: 128,
  height: SOUTH_CORRIDOR_HEIGHT - 24,
};

/**
 * Where people stand when they are neither at a desk nor at the table.
 *
 * Spread along the south corridor so two people never overlap.
 */
export function corridorSpot(slotIndex: number): PlanPoint {
  const lane = SOUTH_CORRIDOR_Y + SOUTH_CORRIDOR_HEIGHT / 2;
  const first = STAIRS.x + STAIRS.width + 60;
  const spacing = 74;
  return {
    x: first + (slotIndex % OFFICE_SLOT_COUNT) * spacing,
    // Alternate lanes so a busy corridor stays readable.
    y: lane + (slotIndex % 2 === 0 ? -13 : 13),
  };
}

/* -------------------------------------------------------------------------
 * Doors
 * ---------------------------------------------------------------------- */

export type WallSide = "n" | "s" | "e" | "w";

export interface PlanDoor {
  /** The stretch of wall to erase so the opening reads as a gap. */
  gap: PlanRect;
  /** Leaf and swing arc, omitted for open archways. */
  swing: string | null;
}

const WALL_AXES: Record<
  WallSide,
  { along: PlanPoint; inward: PlanPoint }
> = {
  n: { along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } },
  s: { along: { x: 1, y: 0 }, inward: { x: 0, y: -1 } },
  w: { along: { x: 0, y: 1 }, inward: { x: 1, y: 0 } },
  e: { along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } },
};

function wallAnchor(rect: PlanRect, side: WallSide, ratio: number): PlanPoint {
  switch (side) {
    case "n":
      return { x: rect.x + rect.width * ratio, y: rect.y };
    case "s":
      return { x: rect.x + rect.width * ratio, y: rect.y + rect.height };
    case "w":
      return { x: rect.x, y: rect.y + rect.height * ratio };
    case "e":
      return { x: rect.x + rect.width, y: rect.y + rect.height * ratio };
  }
}

/**
 * Cuts a doorway into one wall of a room.
 *
 * `ratio` is the position of the door's centre along that wall, and `width`
 * is the clear opening. A swing door also gets a leaf and the quarter-circle
 * arc that a floor plan uses to show which way it opens; an archway gets the
 * opening only.
 */
export function planDoor(
  rect: PlanRect,
  side: WallSide,
  ratio: number,
  width: number,
  kind: "swing" | "open" = "swing",
): PlanDoor {
  const { along, inward } = WALL_AXES[side];
  const centre = wallAnchor(rect, side, ratio);
  const horizontal = along.x !== 0;
  const bleed = WALL + 2;

  const gap: PlanRect = horizontal
    ? { x: centre.x - width / 2, y: centre.y - bleed / 2, width, height: bleed }
    : { x: centre.x - bleed / 2, y: centre.y - width / 2, width: bleed, height: width };

  if (kind === "open") return { gap, swing: null };

  const hinge = {
    x: centre.x - (along.x * width) / 2,
    y: centre.y - (along.y * width) / 2,
  };
  const open = { x: hinge.x + inward.x * width, y: hinge.y + inward.y * width };
  const closed = { x: hinge.x + along.x * width, y: hinge.y + along.y * width };

  // SVG's y axis points down, so a positive cross product sweeps clockwise
  // on screen. Deriving the flag keeps every door correct on all four walls.
  const cross =
    (open.x - hinge.x) * (closed.y - hinge.y) -
    (open.y - hinge.y) * (closed.x - hinge.x);
  const sweep = cross > 0 ? 1 : 0;

  return {
    gap,
    swing: [
      `M ${hinge.x} ${hinge.y} L ${open.x} ${open.y}`,
      `A ${width} ${width} 0 0 ${sweep} ${closed.x} ${closed.y}`,
    ].join(" "),
  };
}

/** Every door in the building, in draw order. */
export function planDoors(): PlanDoor[] {
  const doors = officePlacements().map((placement) =>
    planDoor(placement.rect, placement.doorSide, 0.72, 46),
  );

  return [
    ...doors,
    // The meeting room's double door onto the south corridor.
    planDoor(MEETING_ROOM, "s", 0.38, 52),
    planDoor(MEETING_ROOM, "s", 0.62, 52),
    // The shared spaces open onto the corridor without leaves.
    planDoor(CONSTRAINT_WALL, "n", 0.5, 190, "open"),
    planDoor(COMMON_AREA, "n", 0.5, 190, "open"),
  ];
}

/* -------------------------------------------------------------------------
 * Colour
 * ---------------------------------------------------------------------- */

/** One stable colour per office slot, chosen to read on a white floor. */
export const SLOT_COLORS: readonly string[] = [
  "#3538f0",
  "#0f9d76",
  "#c2410c",
  "#be1a5e",
  "#0369a1",
  "#6d28d9",
  "#0f766e",
  "#a16207",
  "#9f1239",
  "#4338ca",
];

export function slotColor(index: number): string {
  return SLOT_COLORS[index % SLOT_COLORS.length] ?? "#6b7480";
}
