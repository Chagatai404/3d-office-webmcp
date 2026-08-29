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
  | "vote"
  | "decision";

export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  "room",
  "brief",
  "constraints",
  "proposals",
  "issues",
  "whiteboard",
  "vote",
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
  vote: { position: [-3.4, 2.5, 8.4], target: [-3.4, 1.05, 4.8] },
  decision: { position: [3.4, 2.3, 8.2], target: [3.4, 1.15, 4.8] },
};

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
  whiteboard: "Whiteboard",
  vote: "Vote",
  decision: "Decision",
};

export const MOVING_LABEL: Record<WorkspaceId, string> = {
  room: "Moving back to the table",
  brief: "Moving to the brief display",
  constraints: "Moving to the constraints board",
  proposals: "Moving to the candidate board",
  issues: "Moving to the issues board",
  whiteboard: "Moving to the whiteboard",
  vote: "Moving to the voting plinth",
  decision: "Moving to the decision pedestal",
};
