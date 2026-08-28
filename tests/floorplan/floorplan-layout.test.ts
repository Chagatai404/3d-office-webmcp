import { describe, expect, it } from "vitest";
import {
  BUILDING_OUTLINE,
  COMMON_AREA,
  CONSTRAINT_CARD_CAPACITY,
  CONSTRAINT_WALL,
  MEETING_ROOM,
  OFFICE_SLOT_COUNT,
  PLAN_VIEWBOX,
  constraintCardRect,
  meetingSeats,
  officePlacements,
  planDoor,
  planDoors,
  slotColor,
  type PlanRect,
} from "@/floorplan/floorplan-layout";

/** Two rectangles share interior area. Touching edges do not count. */
function overlaps(a: PlanRect, b: PlanRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function contains(outer: PlanRect, inner: PlanRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

describe("the building", () => {
  it("fits inside the drawing", () => {
    expect(BUILDING_OUTLINE.x + BUILDING_OUTLINE.width).toBeLessThanOrEqual(
      PLAN_VIEWBOX.width,
    );
    expect(BUILDING_OUTLINE.y + BUILDING_OUTLINE.height).toBeLessThanOrEqual(
      PLAN_VIEWBOX.height,
    );
  });

  it("keeps every room inside the outer walls", () => {
    const rooms = [
      MEETING_ROOM,
      CONSTRAINT_WALL,
      COMMON_AREA,
      ...officePlacements().map((placement) => placement.rect),
    ];

    for (const room of rooms) {
      expect(contains(BUILDING_OUTLINE, room)).toBe(true);
    }
  });

  it("never puts two rooms on the same floor space", () => {
    const rooms = [
      MEETING_ROOM,
      CONSTRAINT_WALL,
      COMMON_AREA,
      ...officePlacements().map((placement) => placement.rect),
    ];

    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        const a = rooms[i];
        const b = rooms[j];
        if (!a || !b) throw new Error("missing room");
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});

describe("offices", () => {
  it("lays out ten, five to a wing", () => {
    const placements = officePlacements();

    expect(placements).toHaveLength(OFFICE_SLOT_COUNT);
    expect(placements.filter((p) => p.side === "left")).toHaveLength(5);
    expect(placements.filter((p) => p.side === "right")).toHaveLength(5);
  });

  it("opens every office onto the wing corridor rather than a neighbour", () => {
    for (const placement of officePlacements()) {
      expect(placement.doorSide).toBe(placement.side === "left" ? "e" : "w");
    }
  });

  it("seats the first joiners nearest the middle of the wing", () => {
    const placements = officePlacements();
    const middle = MEETING_ROOM.y + MEETING_ROOM.height / 2;
    const distance = (index: number) => {
      const rect = placements[index]?.rect;
      if (!rect) throw new Error("missing placement");
      return Math.abs(rect.y + rect.height / 2 - middle);
    };

    // Slot 0 takes the middle row, then the rows above and below it, and the
    // ends last. Mirrored rows are the same distance out by construction.
    expect(distance(0)).toBeLessThan(distance(2));
    expect(distance(2)).toBeLessThan(distance(6));
    expect(distance(2)).toBe(distance(4));
    expect(distance(6)).toBe(distance(8));
  });

  it("is deterministic", () => {
    expect(officePlacements()).toEqual(officePlacements());
  });
});

describe("the meeting table", () => {
  it("has one seat per office", () => {
    const seats = meetingSeats();

    expect(seats).toHaveLength(OFFICE_SLOT_COUNT);
    expect(seats.map((seat) => seat.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("gives every seat its own place at the table", () => {
    const seats = meetingSeats();
    const spots = new Set(
      seats.map((seat) => `${seat.position.x}:${seat.position.y}`),
    );

    expect(spots.size).toBe(seats.length);
  });

  it("seats the first two joiners facing each other", () => {
    const [first, second] = meetingSeats();

    expect(first?.position.y).toBe(second?.position.y);
    expect(first?.edge).toBe("west");
    expect(second?.edge).toBe("east");
  });

  it("keeps every seat inside the meeting room", () => {
    for (const seat of meetingSeats()) {
      expect(seat.position.x).toBeGreaterThan(MEETING_ROOM.x);
      expect(seat.position.x).toBeLessThan(MEETING_ROOM.x + MEETING_ROOM.width);
      expect(seat.position.y).toBeGreaterThan(MEETING_ROOM.y);
      expect(seat.position.y).toBeLessThan(MEETING_ROOM.y + MEETING_ROOM.height);
    }
  });
});

describe("doors", () => {
  const room: PlanRect = { x: 100, y: 100, width: 200, height: 200 };

  it("swings the leaf into the room on every wall", () => {
    for (const side of ["n", "s", "e", "w"] as const) {
      const door = planDoor(room, side, 0.5, 40);
      expect(door.swing).toMatch(/^M .* A 40 40 0 0 [01] .*$/);
    }
  });

  it("cuts the opening across the wall it is on", () => {
    const north = planDoor(room, "n", 0.5, 40);
    expect(north.gap.width).toBe(40);
    expect(north.gap.y).toBeLessThan(room.y);

    const east = planDoor(room, "e", 0.5, 40);
    expect(east.gap.height).toBe(40);
    expect(east.gap.x).toBeLessThan(room.x + room.width);
  });

  it("draws an archway without a leaf", () => {
    expect(planDoor(room, "n", 0.5, 120, "open").swing).toBeNull();
  });

  it("gives every office a door and the meeting room a double one", () => {
    // Ten offices, two meeting-room leaves, two shared-space archways.
    expect(planDoors()).toHaveLength(OFFICE_SLOT_COUNT + 4);
    expect(planDoors().filter((door) => door.swing === null)).toHaveLength(2);
  });
});

describe("the constraint board", () => {
  it("keeps every card it can fit inside the constraint wall", () => {
    for (let slot = 0; slot < CONSTRAINT_CARD_CAPACITY; slot += 1) {
      expect(contains(CONSTRAINT_WALL, constraintCardRect(slot))).toBe(true);
    }
  });

  it("never puts two cards in the same place", () => {
    const spots = new Set(
      Array.from({ length: CONSTRAINT_CARD_CAPACITY }, (_unused, slot) => {
        const rect = constraintCardRect(slot);
        return `${rect.x}:${rect.y}`;
      }),
    );

    expect(spots.size).toBe(CONSTRAINT_CARD_CAPACITY);
  });
});

describe("slot colour", () => {
  it("gives each of the ten offices its own colour and wraps beyond them", () => {
    const colors = Array.from({ length: OFFICE_SLOT_COUNT }, (_u, i) => slotColor(i));

    expect(new Set(colors).size).toBe(OFFICE_SLOT_COUNT);
    expect(slotColor(OFFICE_SLOT_COUNT)).toBe(slotColor(0));
  });
});
