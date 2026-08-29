import { describe, expect, it } from "vitest";
import {
  CAMERA_POSES,
  ease,
  flightDuration,
  WORKSPACE_IDS,
} from "@/visualization/scene/camera-poses";

/**
 * Where the camera goes when you pick a workspace.
 *
 * Deterministic and pure: the same workspace always produces the same pose,
 * so navigation never depends on render order. Values are transcribed 1:1
 * from the imported design's `POSES` table, so the ported camera behaves
 * exactly like the prototype.
 */
describe("camera poses", () => {
  it("gives every workspace its own vantage point", () => {
    const poses = WORKSPACE_IDS.map((id) => JSON.stringify(CAMERA_POSES[id]));
    expect(new Set(poses).size).toBe(poses.length);
  });

  it("matches the imported design's exact room pose", () => {
    expect(CAMERA_POSES.room).toEqual({ position: [0.4, 7.2, 15.6], target: [0, 1.1, 0] });
  });

  it("matches the imported design's exact decision pose", () => {
    expect(CAMERA_POSES.decision).toEqual({ position: [3.4, 2.3, 8.2], target: [3.4, 1.15, 4.8] });
  });
});

describe("ease", () => {
  it("starts at zero and ends at one", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("is monotonic", () => {
    let previous = -Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const value = ease(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("flightDuration", () => {
  it("is instant under reduced motion regardless of distance", () => {
    expect(flightDuration(0, true)).toBe(0.001);
    expect(flightDuration(40, true)).toBe(0.001);
  });

  it("grows with distance but never exceeds the cap", () => {
    expect(flightDuration(0, false)).toBeCloseTo(0.55);
    expect(flightDuration(10, false)).toBeGreaterThan(flightDuration(1, false));
    expect(flightDuration(1000, false)).toBe(1.5);
  });
});
