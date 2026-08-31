/**
 * Named camera poses for the meeting room, transcribed 1:1 from the imported
 * design's `POSES` table (`meeting-stage.js`) so the ported camera behaves
 * exactly like the prototype.
 *
 * These are the only places the camera may stand. Navigation is semantic —
 * `navigateTo("proposals")` — never arbitrary coordinates, per the product's
 * camera design rules.
 */

export type WorkspaceId =
  | "room"
  | "brief"
  | "constraints"
  | "proposals"
  | "issues"
  | "whiteboard"
  | "alignment"
  | "decision";

export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  "room",
  "brief",
  "constraints",
  "proposals",
  "issues",
  "whiteboard",
  "alignment",
  "decision",
];

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export const CAMERA_POSES: Record<WorkspaceId, CameraPose> = {
  room: { position: [0.4, 7.2, 15.6], target: [0, 1.1, 0] },
  brief: { position: [0, 2.9, 1.2], target: [0, 2.5, -6] },
  constraints: { position: [-1.4, 2.8, 0.6], target: [-8, 2.3, 0] },
  proposals: { position: [1.4, 2.8, 0.6], target: [8, 2.3, 0] },
  issues: { position: [2.6, 2.7, -0.8], target: [6.4, 2.2, -5.4] },
  whiteboard: { position: [-2.6, 2.7, -0.8], target: [-6.4, 2.2, -5.4] },
  alignment: { position: [-3.4, 2.5, 8.4], target: [-3.4, 1.05, 4.8] },
  decision: { position: [3.4, 2.3, 8.2], target: [3.4, 1.15, 4.8] },
};

/**
 * The pre-meeting flow (welcome / create / lobby) looks at the same room from
 * further back, before the user has a seat. These are kept out of
 * `WorkspaceId` / `WORKSPACE_IDS` on purpose: they are not navigable meeting
 * workspaces, just where the camera stands on each onboarding screen.
 *
 * `welcome` is the arrival shot — the whole room seen as one object from
 * outside, three-quarters on and above, so the first screen is the product
 * itself rather than a picture of it. `create` and `lobby` are transcribed
 * 1:1 from the imported design's extended `POSES` table (`meeting-stage.js`):
 * the camera has moved inside the composition, close to the table. `join` is
 * deliberately symmetrical with `create` -- the same distance, height and
 * target, mirrored to the opposite side of the table -- so creating and
 * joining read as the same unframed interior composition approached from two
 * sides, never as two unrelated shots.
 */
export type PreMeetingPoseId = "welcome" | "create" | "join" | "lobby";

export const PRE_MEETING_POSES: Record<PreMeetingPoseId, CameraPose> = {
  welcome: { position: [13.9, 16.0, 22.3], target: [0, 1.45, 0] },
  create: { position: [1.0, 5.4, 12.8], target: [0, 1.1, -1] },
  join: { position: [-1.0, 5.4, 12.8], target: [0, 1.1, -1] },
  lobby: { position: [1.4, 5.2, 12.2], target: [0, 1.0, 0] },
};

/**
 * The room's outer box — glass shell, base rim and cap beams — as a centre
 * and half-extents. `fitPoseToFrame` frames these corners, so the welcome
 * shot holds the whole model at any window shape.
 */
export const ROOM_BOUNDS = {
  center: [0, 2.22, 0],
  half: [8.6, 2.28, 7.0],
} as const;

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function roomCorners(): Vec3[] {
  const { center, half } = ROOM_BOUNDS;
  const corners: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([
          center[0] + sx * half[0],
          center[1] + sy * half[1],
          center[2] + sz * half[2],
        ]);
      }
    }
  }
  return corners;
}

/**
 * The same vantage point, framed so the whole room sits centred in a frame of
 * this shape.
 *
 * The welcome shot presents the room as one object on the page, so it has to
 * survive every window: a wide desktop frame and a narrow phone frame need
 * different distances to show the same model. This keeps the camera on its
 * named pose's own axis — it only slides along the view direction and slides
 * the point it looks at, never to arbitrary coordinates.
 *
 * Two things happen, three times over. The distance is solved from the exact
 * perspective condition for the eight corners of `ROOM_BOUNDS`, so nothing
 * clips at any aspect ratio. Then the point the camera looks at is nudged so
 * the room's *projected* silhouette is centred — perspective makes the near
 * bottom corner reach much further down the frame than the far top corner
 * reaches up, and a shot fitted without this sits low and small. Each pass
 * feeds the next; three is well past convergence.
 *
 * `fill` is how much of the frame the model may claim on its binding axis;
 * `lift` raises it by that fraction of the half-frame, for a frame with
 * something resting along its bottom edge. Pure: no scene access.
 */
export function fitPoseToFrame(
  pose: CameraPose,
  aspect: number,
  fovDegrees: number,
  fill: number,
  lift = 0,
): CameraPose {
  const direction = normalise(sub(pose.position, pose.target));
  const right = normalise(cross([0, 1, 0], direction));
  const up = cross(direction, right);

  const tanUp = Math.tan((fovDegrees * Math.PI) / 360) * fill;
  const tanRight = tanUp * Math.max(aspect, 0.2);

  const corners = roomCorners();
  let target: Vec3 = [...pose.target];
  let distance = 0;

  for (let pass = 0; pass < 3; pass += 1) {
    distance = 0;
    for (const corner of corners) {
      const offset = sub(corner, target);
      const depth = dot(offset, direction);
      distance = Math.max(
        distance,
        depth + Math.abs(dot(offset, up)) / tanUp,
        depth + Math.abs(dot(offset, right)) / tanRight,
      );
    }

    const eye: Vec3 = [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ];

    // The silhouette, in frame widths from the centre, plus how far away it
    // sits on average — enough to turn a frame offset back into world units.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let depthSum = 0;
    for (const corner of corners) {
      const offset = sub(corner, eye);
      const depth = -dot(offset, direction);
      depthSum += depth;
      const x = dot(offset, right) / (depth * tanRight);
      const y = dot(offset, up) / (depth * tanUp);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    const meanDepth = depthSum / corners.length;
    const shiftX = ((minX + maxX) / 2) * tanRight * meanDepth;
    const shiftY = ((minY + maxY) / 2 - lift) * tanUp * meanDepth;
    target = [
      target[0] + right[0] * shiftX + up[0] * shiftY,
      target[1] + right[1] * shiftX + up[1] * shiftY,
      target[2] + right[2] * shiftX + up[2] * shiftY,
    ];
  }

  return {
    position: [
      target[0] + direction[0] * distance,
      target[1] + direction[1] * distance,
      target[2] + direction[2] * distance,
    ],
    target,
  };
}

/**
 * How much of the welcome frame the room may claim, and how far above centre
 * it sits.
 *
 * Nothing floats over the frame any more — the reading column sits beside it,
 * not on it — so the model is centred and takes very nearly the whole panel.
 * The remainder is the margin that keeps it an object resting inside a frame
 * rather than a picture cropped by one.
 */
export const WELCOME_FRAME_FILL = 0.93;
export const WELCOME_FRAME_LIFT = 0;

/**
 * The welcome shot's own lens.
 *
 * A longer lens than the room's `CAMERA.fov` flattens the perspective, so the
 * room reads as a model of itself — one object you can take in at a glance —
 * rather than a space you are already standing in. Widening back to the room
 * lens as the camera flies in is what makes the move feel like stepping
 * inside rather than zooming.
 */
export const WELCOME_FOV = 26;

/**
 * How far the welcome shot may be swung around the room, in radians from +Z.
 *
 * The limit is not a taste call. At the fitted welcome distance the camera
 * stands about 30m from the middle of the room, so it clears a side wall —
 * and starts looking at the outside of it — once |x| passes the room's own
 * half-width, at roughly 16 degrees. The shot is authored at +32, outside the
 * right-hand wall, which is why Proposals has never been visible from it.
 * Swinging to -32 puts the camera outside the left-hand wall instead and shows
 * the right-hand one; everything between shows both. 35 degrees is a little
 * past either end of that useful arc and nowhere near the 90 it would take to
 * begin seeing the room from behind.
 */
export const WELCOME_SWING = { min: -0.62, max: 0.62 } as const;

/** Where a pose stands around what it looks at, in radians from the +Z axis. */
export function poseAzimuth(pose: CameraPose): number {
  return Math.atan2(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]);
}

/**
 * The same pose swung around the vertical axis through what it looks at.
 *
 * Height and distance are untouched, so a swung pose is still the authored
 * shot — the camera has walked around the room on its own circle, and
 * `fitPoseToFrame` can still solve the framing for it at any angle.
 */
export function swingPose(pose: CameraPose, azimuth: number): CameraPose {
  const radius = Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[2] - pose.target[2],
  );
  return {
    position: [
      pose.target[0] + Math.sin(azimuth) * radius,
      pose.position[1],
      pose.target[2] + Math.cos(azimuth) * radius,
    ],
    target: [...pose.target],
  };
}

export function clampSwing(azimuth: number): number {
  return Math.min(WELCOME_SWING.max, Math.max(WELCOME_SWING.min, azimuth));
}

/** How far a pose stands from what it looks at. */
function poseReach(pose: CameraPose): number {
  return Math.hypot(
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  );
}

/**
 * The welcome shot, fitted once for the whole arc and then swung along it.
 *
 * Fitting each angle separately is what a single shot wants and what an orbit
 * must not do: the room is a box, so its silhouette is 16.9m across head-on
 * and about 21.7m across at the ends of the arc, and a per-angle fit answers
 * that by pushing the camera out and pulling it back in as you drag. The room
 * appeared to breathe in and out around the table.
 *
 * So the fit is solved once, at whichever angle in the arc needs the most
 * room, and every other angle reuses that distance. Because `fitPoseToFrame`
 * only ever nudges its target vertically here — the room is symmetric about
 * both floor axes, so a swung view of it is still symmetric about the frame's
 * centre line — the fitted target sits on the room's own vertical axis, and
 * swinging around it is a true circle: constant height, constant distance.
 *
 * The cost is that the resting shot is about two per cent smaller than a fit
 * made for its angle alone, which is well inside the 7% margin `fill` already
 * leaves.
 */
export function fitSwungPose(
  base: CameraPose,
  aspect: number,
  fovDegrees: number,
  fill: number,
  lift: number,
  swing: number,
): CameraPose {
  // The ends of the arc are the widest views of a box this shallow, but the
  // middle is sampled too rather than assumed: it costs three dot-product
  // passes and it cannot be wrong.
  let widest: CameraPose | null = null;
  let reach = -Infinity;
  for (const angle of [WELCOME_SWING.min, 0, WELCOME_SWING.max]) {
    const candidate = fitPoseToFrame(swingPose(base, angle), aspect, fovDegrees, fill, lift);
    const distance = poseReach(candidate);
    if (distance > reach) {
      widest = candidate;
      reach = distance;
    }
  }
  return swingPose(widest ?? base, swing);
}

/**
 * One duration for every pre-meeting camera move, in seconds.
 *
 * Unlike the in-room camera, this flight is choreographed with the DOM: the
 * welcome panel fades out as the camera leaves, the create form appears as it
 * arrives. Both sides read this number, so they cannot drift apart. It sits
 * in the design's 600–1000ms band; reduced motion cuts straight there.
 */
export function flowFlightSeconds(reducedMotion: boolean): number {
  return reducedMotion ? 0.001 : 0.9;
}

/**
 * When the flow hands the screen over to the next one, in seconds.
 *
 * A little before the camera stops. The last stretch of a cubic ease covers
 * almost none of the distance, so a panel rising into place there reads as
 * the two settling together rather than as a beat of empty room; and whatever
 * the route itself costs is absorbed by that margin instead of added after
 * it. Never negative, and instant under reduced motion.
 */
export function flowHandoverSeconds(reducedMotion: boolean): number {
  return reducedMotion ? 0.001 : Math.max(0, flowFlightSeconds(false) - 0.12);
}

/** Cubic ease-in-out, matching the source's `ease` function exactly. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Seconds for a flight of this distance; instant under reduced motion. */
export function flightDuration(distance: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.001;
  return Math.min(1.5, 0.55 + distance * 0.045);
}

export const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  room: "Room",
  brief: "Brief",
  constraints: "Constraints",
  proposals: "Proposals",
  issues: "Issues",
  whiteboard: "Sources",
  alignment: "Alignment",
  decision: "Decision",
};

export const MOVING_LABEL: Record<WorkspaceId, string> = {
  room: "Moving back to the table",
  brief: "Moving to the brief display",
  constraints: "Moving to the constraints board",
  proposals: "Moving to the candidate board",
  issues: "Moving to the issues board",
  whiteboard: "Moving to the source files",
  alignment: "Moving to the alignment plinth",
  decision: "Moving to the decision pedestal",
};
