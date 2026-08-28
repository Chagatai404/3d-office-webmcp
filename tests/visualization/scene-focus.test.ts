import { describe, expect, it } from "vitest";
import { OFFICE_SLOT_COUNT } from "@/visualization/room-view-model";
import {
  cameraPose,
  cameraPosition,
  officeIndexOf,
  officeZoneId,
  OVERVIEW_POSE,
  PAN_BOUNDS,
  zoneLabel,
  type SceneZoneId,
} from "@/visualization/scene/scene-focus";
import { officePlacements } from "@/visualization/scene/office-layout";

/**
 * Where the camera goes when you pick a place.
 *
 * Deterministic and pure, like the layout it reads: the same zone always
 * produces the same pose, so navigation never depends on render order.
 */

const ZONES: readonly SceneZoneId[] = [
  "overview",
  "meeting-room",
  "constraint-wall",
  "common-area",
];

describe("office zone ids", () => {
  it("round-trips every office slot", () => {
    for (let index = 0; index < OFFICE_SLOT_COUNT; index += 1) {
      expect(officeIndexOf(officeZoneId(index))).toBe(index);
    }
  });

  it("does not read a named zone as an office", () => {
    for (const zone of ZONES) {
      expect(officeIndexOf(zone)).toBeNull();
    }
  });

  it("names every zone for the HUD", () => {
    expect(zoneLabel("meeting-room")).toBe("Meeting room");
    expect(zoneLabel(officeZoneId(3))).toBe("Office 4");
  });
});

describe("camera poses", () => {
  it("is deterministic", () => {
    expect(cameraPose("meeting-room")).toEqual(cameraPose("meeting-room"));
    expect(cameraPose(officeZoneId(2))).toEqual(cameraPose(officeZoneId(2)));
  });

  it("gives every place its own vantage point", () => {
    const poses = [...ZONES, officeZoneId(0), officeZoneId(1)].map((zone) =>
      JSON.stringify(cameraPose(zone)),
    );
    expect(new Set(poses).size).toBe(poses.length);
  });

  it("looks at the office it was asked for", () => {
    const placements = officePlacements();

    for (let index = 0; index < OFFICE_SLOT_COUNT; index += 1) {
      const placement = placements[index];
      const pose = cameraPose(officeZoneId(index));
      expect(pose.target[0]).toBe(placement?.position[0]);
    }
  });

  it("approaches an office from outside the room, never through it", () => {
    const placements = officePlacements();

    for (let index = 0; index < OFFICE_SLOT_COUNT; index += 1) {
      const placement = placements[index];
      const position = cameraPosition(cameraPose(officeZoneId(index)));
      const outward = placement?.side === "left" ? -1 : 1;

      // Further from the middle than the office itself, and above the floor.
      expect(Math.abs(position[0])).toBeGreaterThan(
        Math.abs(placement?.position[0] ?? 0),
      );
      expect(Math.sign(position[0])).toBe(outward);
      expect(position[1]).toBeGreaterThan(0);
    }
  });

  it("falls back to the overview for an office that does not exist", () => {
    expect(cameraPose(officeZoneId(99))).toEqual(OVERVIEW_POSE);
  });

  it("keeps every pose inside the pannable floor", () => {
    for (const zone of [...ZONES, officeZoneId(0), officeZoneId(9)]) {
      const pose = cameraPose(zone);
      expect(Math.abs(pose.target[0])).toBeLessThanOrEqual(PAN_BOUNDS.x);
      expect(Math.abs(pose.target[2])).toBeLessThanOrEqual(PAN_BOUNDS.z);
    }
  });
});
