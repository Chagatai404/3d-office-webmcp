import { describe, expect, it } from "vitest";
import { meetingSeats, ROOM, tableRadius } from "@/visualization/scene/meeting-room-layout";

/**
 * Where the people in the room sit.
 *
 * The seat ring matches the imported design's exact 4-seat geometry at the
 * seeded scenario's participant count, and generalizes gracefully beyond it
 * so a larger room never loses a participant — per the product decision to
 * support more than four seats rather than hard-capping at the mockup's
 * fixed table.
 */
describe("meetingSeats", () => {
  it("matches the imported design's exact 4-seat angles", () => {
    const seats = meetingSeats(4);
    const angles = seats.map((seat) => Math.atan2(seat.position[0], seat.position[2]));
    // The source design places seats at 45°/135°/225°/315° (radius 3.1).
    expect(seats[0]?.position[0]).toBeCloseTo(Math.sin(Math.PI / 4) * 3.1, 5);
    expect(seats[0]?.position[2]).toBeCloseTo(Math.cos(Math.PI / 4) * 3.1, 5);
    expect(new Set(angles.map((a) => a.toFixed(4))).size).toBe(4);
  });

  it("gives every participant a seat of their own", () => {
    for (const count of [1, 2, 4, 7, 12]) {
      const seats = meetingSeats(count);
      expect(seats).toHaveLength(count);
      expect(seats.map((seat) => seat.index)).toEqual(
        Array.from({ length: count }, (_unused, index) => index),
      );
      expect(
        new Set(seats.map((seat) => `${seat.position[0].toFixed(4)}/${seat.position[2].toFixed(4)}`))
          .size,
      ).toBe(count);
    }
  });

  it("fits every seat inside the room", () => {
    for (const count of [4, 8, 12]) {
      for (const seat of meetingSeats(count)) {
        expect(Math.abs(seat.position[0])).toBeLessThan(ROOM.width / 2);
        expect(Math.abs(seat.position[2])).toBeLessThan(ROOM.depth / 2);
      }
    }
  });

  it("faces every seat toward the middle of the table", () => {
    for (const seat of meetingSeats(6)) {
      const facing = Math.atan2(seat.position[0], seat.position[2]) + Math.PI;
      // Compare angles modulo a full turn: rotationY and `facing` describe the
      // same orientation even when one has wrapped past 2π.
      const wrapped = Math.atan2(
        Math.sin(seat.rotationY - facing),
        Math.cos(seat.rotationY - facing),
      );
      expect(wrapped).toBeCloseTo(0, 6);
    }
  });

  it("is deterministic", () => {
    expect(meetingSeats(5)).toEqual(meetingSeats(5));
  });

  it("grows the ring radius past four seats, and never shrinks it", () => {
    const radiusOf = (count: number) => Math.hypot(...(meetingSeats(count)[0]?.position ?? [0, 0]));
    expect(radiusOf(4)).toBeCloseTo(3.1, 5);
    expect(radiusOf(8)).toBeGreaterThan(radiusOf(4));
    expect(radiusOf(12)).toBeGreaterThan(radiusOf(8));
  });
});

describe("tableRadius", () => {
  it("matches the imported design's exact table size at four seats", () => {
    expect(tableRadius(4)).toBeCloseTo(2.1, 5);
  });

  it("grows past four seats without shrinking below it", () => {
    expect(tableRadius(1)).toBeCloseTo(2.1, 5);
    expect(tableRadius(8)).toBeGreaterThan(tableRadius(4));
  });
});
