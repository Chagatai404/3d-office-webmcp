import { describe, expect, it } from "vitest";
import type { RoomPhase, RoomState } from "@/contracts/room";
import { demoRoom } from "@/fixtures/demo-room";
import {
  createRoomVisualizationState,
  OFFICE_SLOT_COUNT,
} from "@/visualization/room-view-model";
import {
  circuitPerimeter,
  circuitPoint,
  meetingSeats,
  MEETING_ROOM,
  OFFICE,
  roamingCircuit,
  ROAMING,
} from "@/visualization/scene/office-layout";

/**
 * Where the people in the room are.
 *
 * Presence is a reading of canonical state, and the places it puts somebody
 * are fixed geometry, so both are pinned here: the same room always produces
 * the same office, the same seat, and the same walk.
 */

function inPhase(phase: RoomPhase, overrides: Partial<RoomState> = {}): RoomState {
  return { ...structuredClone(demoRoom), phase, ...overrides };
}

const SAMPLES = 720;

describe("participant presence", () => {
  it("puts everyone at the table once the room convenes", () => {
    for (const phase of ["deliberation", "voting", "approval", "finalized"] as const) {
      const view = createRoomVisualizationState(inPhase(phase));
      expect(
        view.participants.every((participant) => participant.presence === "meeting"),
      ).toBe(true);
    }
  });

  it("keeps a participant in their office until they have published", () => {
    const view = createRoomVisualizationState(demoRoom);

    // The Engineer is the one seat the demo leaves without a position.
    const engineer = view.participants.find(
      (participant) => participant.id === "participant-engineering",
    );
    expect(engineer?.presence).toBe("office");

    expect(
      view.participants
        .filter((participant) => participant.id !== "participant-engineering")
        .every((participant) => participant.presence === "roaming"),
    ).toBe(true);
  });

  it("sends a participant out onto the floor when they publish", () => {
    const before = createRoomVisualizationState(demoRoom);
    const after = createRoomVisualizationState(
      inPhase("input", {
        positions: [
          ...demoRoom.positions,
          {
            id: "position-4",
            participantId: "participant-engineering",
            summary: "Two weeks is not enough for a rebuild.",
            category: "capacity",
            priority: "high",
            createdAt: demoRoom.participants[0]!.createdAt,
          },
        ],
      }),
    );

    expect(
      before.participants.find((p) => p.id === "participant-engineering")?.presence,
    ).toBe("office");
    expect(
      after.participants.find((p) => p.id === "participant-engineering")?.presence,
    ).toBe("roaming");
  });

  it("is deterministic", () => {
    const first = createRoomVisualizationState(demoRoom);
    const second = createRoomVisualizationState(structuredClone(demoRoom));

    expect(first.participants.map((p) => p.presence)).toEqual(
      second.participants.map((p) => p.presence),
    );
  });
});

describe("meeting seats", () => {
  const seats = meetingSeats();

  it("gives every office a seat of its own", () => {
    expect(seats).toHaveLength(OFFICE_SLOT_COUNT);
    expect(
      new Set(seats.map((seat) => `${seat.position[0]}/${seat.position[2]}`)).size,
    ).toBe(OFFICE_SLOT_COUNT);
    expect(seats.map((seat) => seat.index)).toEqual(
      Array.from({ length: OFFICE_SLOT_COUNT }, (_unused, index) => index),
    );
  });

  it("fits every seat inside the meeting room", () => {
    for (const seat of seats) {
      expect(Math.abs(seat.position[0])).toBeLessThan(MEETING_ROOM.width / 2);
      expect(Math.abs(seat.position[2])).toBeLessThan(MEETING_ROOM.depth / 2);
    }
  });

  it("faces every seat at the table", () => {
    for (const seat of seats) {
      // Unrotated is facing +Z, so the far side of the table needs no turn.
      const facing = seat.position[2] > 0 ? Math.PI : 0;
      expect(seat.rotationY).toBe(facing);
    }
  });

  it("seats the first joiners opposite each other, not down one side", () => {
    expect(seats[0]?.side).not.toBe(seats[1]?.side);
    expect(seats[0]?.position[0]).toBe(seats[1]?.position[0]);
  });
});

describe("roaming circuits", () => {
  const circuits = Array.from({ length: OFFICE_SLOT_COUNT }, (_unused, index) =>
    roamingCircuit(index),
  );

  it("is deterministic per office slot", () => {
    for (let index = 0; index < OFFICE_SLOT_COUNT; index += 1) {
      expect(roamingCircuit(index)).toEqual(circuits[index]);
      expect(circuitPoint(roamingCircuit(index), 0.31)).toEqual(
        circuitPoint(roamingCircuit(index), 0.31),
      );
    }
  });

  it("never walks through a wall", () => {
    for (const circuit of circuits) {
      for (let step = 0; step < SAMPLES; step += 1) {
        const { position } = circuitPoint(circuit, step / SAMPLES);
        const [x, , z] = position;

        // Outside the meeting room: never both within its width and its depth.
        const insideMeetingRoom =
          Math.abs(x) < MEETING_ROOM.width / 2 &&
          Math.abs(z) < MEETING_ROOM.depth / 2;
        expect(insideMeetingRoom).toBe(false);

        // Inside the corridor: never onto an office floor. Offices are rotated
        // a quarter turn, so their world footprint across X is the local depth.
        expect(Math.abs(x)).toBeLessThan(
          OFFICE.columnOffsetX - OFFICE.depth / 2,
        );
      }
    }
  });

  it("closes the loop and walks it at a steady pace", () => {
    for (const circuit of circuits) {
      const start = circuitPoint(circuit, 0);
      const end = circuitPoint(circuit, 1);
      expect(end.position[0]).toBeCloseTo(start.position[0], 6);
      expect(end.position[2]).toBeCloseTo(start.position[2], 6);

      const perimeter = circuitPerimeter(circuit);
      const expectedStep = perimeter / SAMPLES;

      for (let step = 0; step < SAMPLES; step += 1) {
        const here = circuitPoint(circuit, step / SAMPLES).position;
        const next = circuitPoint(circuit, (step + 1) / SAMPLES).position;
        const travelled = Math.hypot(next[0] - here[0], next[2] - here[2]);

        // Chords on the corners fall just short of the arc they cut.
        expect(travelled).toBeGreaterThan(expectedStep * 0.97);
        expect(travelled).toBeLessThan(expectedStep * 1.001);
      }
    }
  });

  it("faces the direction it is walking", () => {
    for (const circuit of circuits) {
      for (let step = 0; step < SAMPLES; step += 1) {
        const turns = step / SAMPLES;
        const { position, rotationY } = circuitPoint(circuit, turns);
        const ahead = circuitPoint(circuit, turns + 0.0005).position;

        const travelled = Math.atan2(
          ahead[0] - position[0],
          ahead[2] - position[2],
        );
        const difference = Math.abs(
          Math.atan2(
            Math.sin(travelled - rotationY),
            Math.cos(travelled - rotationY),
          ),
        );
        expect(difference).toBeLessThan(0.05);
      }
    }
  });

  it("keeps participants who share a ring apart", () => {
    const perRing = new Map<number, number[]>();
    for (let index = 0; index < OFFICE_SLOT_COUNT; index += 1) {
      const ring = index % ROAMING.ringCount;
      perRing.set(ring, [...(perRing.get(ring) ?? []), index]);
    }

    for (const slots of perRing.values()) {
      for (const first of slots) {
        for (const second of slots) {
          if (first >= second) continue;
          const a = circuitPoint(roamingCircuit(first), roamingCircuit(first).offset);
          const b = circuitPoint(
            roamingCircuit(second),
            roamingCircuit(second).offset,
          );
          expect(
            Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]),
          ).toBeGreaterThan(2);
        }
      }
    }
  });
});
