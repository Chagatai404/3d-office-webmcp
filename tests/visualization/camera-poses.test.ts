import { describe, expect, it } from "vitest";
import {
  CAMERA_POSES,
  ease,
  fitPoseToFrame,
  flightDuration,
  flowFlightSeconds,
  PRE_MEETING_POSES,
  ROOM_BOUNDS,
  WELCOME_FRAME_FILL,
  WELCOME_FRAME_LIFT,
  WELCOME_FOV,
  WORKSPACE_IDS,
  type CameraPose,
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

describe("pre-meeting poses", () => {
  it("keeps the imported design's poses for the screens inside the room", () => {
    expect(PRE_MEETING_POSES.create).toEqual({
      position: [1.0, 5.4, 12.8],
      target: [0, 1.1, -1],
    });
    expect(PRE_MEETING_POSES.lobby).toEqual({
      position: [1.4, 5.2, 12.2],
      target: [0, 1.0, 0],
    });
  });

  it("stands the welcome camera outside the room, above it", () => {
    const { position } = PRE_MEETING_POSES.welcome;
    expect(position[1]).toBeGreaterThan(ROOM_BOUNDS.center[1] + ROOM_BOUNDS.half[1]);
    expect(position[2]).toBeGreaterThan(ROOM_BOUNDS.half[2]);
  });

  it("gives every onboarding screen its own vantage point", () => {
    const poses = Object.values(PRE_MEETING_POSES).map((pose) => JSON.stringify(pose));
    expect(new Set(poses).size).toBe(poses.length);
  });

  it("keeps the onboarding poses out of the navigable workspace list", () => {
    for (const id of Object.keys(PRE_MEETING_POSES)) {
      expect(WORKSPACE_IDS).not.toContain(id);
    }
  });
});

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * Where the room's eight corners land on screen, in frame halves: 1 is the
 * edge of the frame, 0 its centre. An independent projection — it derives
 * nothing from `fitPoseToFrame` — so it can hold that function to its claim.
 */
function silhouette(pose: CameraPose, aspect: number, fovDegrees: number) {
  const direction = unit(sub(pose.position, pose.target));
  const right = unit(cross([0, 1, 0], direction));
  const up = cross(direction, right);
  const tanUp = Math.tan((fovDegrees * Math.PI) / 360);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner: Vec3 = [
          ROOM_BOUNDS.center[0] + sx * ROOM_BOUNDS.half[0],
          ROOM_BOUNDS.center[1] + sy * ROOM_BOUNDS.half[1],
          ROOM_BOUNDS.center[2] + sz * ROOM_BOUNDS.half[2],
        ];
        const offset = sub(corner, pose.position);
        const depth = -dot(offset, direction);
        xs.push(dot(offset, right) / (depth * tanUp * aspect));
        ys.push(dot(offset, up) / (depth * tanUp));
      }
    }
  }

  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    bottom: Math.min(...ys),
    top: Math.max(...ys),
  };
}

/**
 * The welcome shot presents the room as one object, so the frame has one job:
 * hold all of it, centred, whatever shape the window is.
 */
describe("fitPoseToFrame", () => {
  const aspects = [3, 2.1, 1.6, 1, 0.6];

  it("holds the whole room inside the frame at every aspect ratio", () => {
    for (const aspect of aspects) {
      const fitted = fitPoseToFrame(
        PRE_MEETING_POSES.welcome,
        aspect,
        WELCOME_FOV,
        WELCOME_FRAME_FILL,
        WELCOME_FRAME_LIFT,
      );
      const frame = silhouette(fitted, aspect, WELCOME_FOV);
      expect(Math.max(-frame.left, frame.right)).toBeLessThanOrEqual(1);
      expect(Math.max(-frame.bottom, frame.top)).toBeLessThanOrEqual(1);
    }
  });

  it("fills the frame it is given, rather than sitting small in it", () => {
    for (const aspect of aspects) {
      const fitted = fitPoseToFrame(
        PRE_MEETING_POSES.welcome,
        aspect,
        WELCOME_FOV,
        WELCOME_FRAME_FILL,
        WELCOME_FRAME_LIFT,
      );
      const frame = silhouette(fitted, aspect, WELCOME_FOV);
      const claimed = Math.max(
        -frame.left,
        frame.right,
        -frame.bottom,
        frame.top,
      );
      expect(claimed).toBeGreaterThan(WELCOME_FRAME_FILL - 0.06);
    }
  });

  it("centres the room in the frame, lifted clear of the controls below", () => {
    const fitted = fitPoseToFrame(
      PRE_MEETING_POSES.welcome,
      2.1,
      WELCOME_FOV,
      WELCOME_FRAME_FILL,
      WELCOME_FRAME_LIFT,
    );
    const frame = silhouette(fitted, 2.1, WELCOME_FOV);
    expect((frame.left + frame.right) / 2).toBeCloseTo(0, 1);
    expect((frame.bottom + frame.top) / 2).toBeCloseTo(WELCOME_FRAME_LIFT, 1);
  });

  it("stays on the pose's own line of sight, only sliding along it", () => {
    const fitted = fitPoseToFrame(PRE_MEETING_POSES.welcome, 1.6, WELCOME_FOV, 0.88);
    const authored = unit(
      sub(PRE_MEETING_POSES.welcome.position, PRE_MEETING_POSES.welcome.target),
    );
    const moved = unit(sub(fitted.position, fitted.target));
    for (const axis of [0, 1, 2] as const) {
      expect(moved[axis]).toBeCloseTo(authored[axis], 5);
    }
  });

  it("stands further back the narrower the frame gets", () => {
    const distance = (aspect: number) => {
      const fitted = fitPoseToFrame(
        PRE_MEETING_POSES.welcome,
        aspect,
        WELCOME_FOV,
        WELCOME_FRAME_FILL,
        WELCOME_FRAME_LIFT,
      );
      const offset = sub(fitted.position, fitted.target);
      return Math.hypot(offset[0], offset[1], offset[2]);
    };
    expect(distance(0.6)).toBeGreaterThan(distance(1));
    expect(distance(1)).toBeGreaterThan(distance(1.6));
  });
});

describe("flowFlightSeconds", () => {
  it("cuts straight there under reduced motion", () => {
    expect(flowFlightSeconds(true)).toBe(0.001);
  });

  it("otherwise sits inside the design's 600-1000ms band", () => {
    expect(flowFlightSeconds(false)).toBeGreaterThanOrEqual(0.6);
    expect(flowFlightSeconds(false)).toBeLessThanOrEqual(1);
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
