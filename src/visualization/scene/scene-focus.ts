import {
  COMMON_AREA,
  CONSTRAINT_WALL,
  MEETING_ROOM,
  OFFICE,
  officePlacements,
} from "./office-layout";

/**
 * Named places in the office and where the god-view camera sits to look at
 * them.
 *
 * Pure data. The camera rig reads it, the shell stores which zone is selected,
 * and the tests pin the geometry down. Nothing here knows about React, room
 * state, or which panel a zone opens.
 */

export type OfficeZoneId = `office-${number}`;

export type SceneZoneId =
  | "overview"
  | "meeting-room"
  | "constraint-wall"
  | "common-area"
  | OfficeZoneId;

export interface CameraPose {
  /** What the camera looks at. */
  target: [number, number, number];
  /** Where the camera sits, relative to that target. */
  offset: [number, number, number];
}

/** Human-readable name, used by the HUD hint and the window titles. */
export const ZONE_LABEL: Record<
  "overview" | "meeting-room" | "constraint-wall" | "common-area",
  string
> = {
  overview: "Whole office",
  "meeting-room": "Meeting room",
  "constraint-wall": "Constraint wall",
  "common-area": "Common area",
};

export function officeZoneId(index: number): OfficeZoneId {
  return `office-${index}`;
}

/** `office-3` -> 3, anything else -> null. */
export function officeIndexOf(zone: SceneZoneId): number | null {
  const match = /^office-(\d+)$/.exec(zone);
  if (!match?.[1]) return null;
  return Number.parseInt(match[1], 10);
}

export function zoneLabel(zone: SceneZoneId): string {
  const officeIndex = officeIndexOf(zone);
  if (officeIndex !== null) return `Office ${officeIndex + 1}`;
  return ZONE_LABEL[zone as keyof typeof ZONE_LABEL] ?? "Office";
}

/** The pose the camera starts in and returns to. */
export const OVERVIEW_POSE: CameraPose = {
  target: [0, 0, 1.5],
  offset: [0, 21, 26],
};

/**
 * Where the camera goes for a zone.
 *
 * Offices are approached from outside the room so the partition walls never
 * sit between the camera and the desk.
 */
export function cameraPose(zone: SceneZoneId): CameraPose {
  const officeIndex = officeIndexOf(zone);

  if (officeIndex !== null) {
    const placement = officePlacements()[officeIndex];
    if (!placement) return OVERVIEW_POSE;
    const outward = placement.side === "left" ? -1 : 1;

    return {
      target: [
        placement.position[0],
        1.2,
        placement.position[2] - OFFICE.depth * 0.1,
      ],
      offset: [outward * 6.5, 8.5, 8],
    };
  }

  switch (zone) {
    case "meeting-room":
      return {
        target: [0, 1, MEETING_ROOM.position[2]],
        offset: [0, 10, 15],
      };
    case "constraint-wall":
      return {
        target: [0, CONSTRAINT_WALL.height / 2, CONSTRAINT_WALL.position[2]],
        offset: [0, 6, 15],
      };
    case "common-area":
      return {
        target: [0, 1, COMMON_AREA.position[2] - 1],
        offset: [0, 8.5, 13],
      };
    default:
      return OVERVIEW_POSE;
  }
}

/** Absolute camera position for a pose. */
export function cameraPosition(pose: CameraPose): [number, number, number] {
  return [
    pose.target[0] + pose.offset[0],
    pose.target[1] + pose.offset[1],
    pose.target[2] + pose.offset[2],
  ];
}

/** How far the camera may drift from the middle of the floor while panning. */
export const PAN_BOUNDS = {
  x: 22,
  z: 20,
} as const;
