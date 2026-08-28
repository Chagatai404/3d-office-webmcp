import type { RoomPhase } from "@/contracts/room";
import type { PlanPlace, PlanZoneId } from "@/floorplan/floorplan-view-model";
import { officeIndexOf } from "@/floorplan/floorplan-view-model";

/**
 * Names for the places on the plan.
 *
 * Canonical enum vocabulary (phases, origins, vote choices) is shared with the
 * rest of the frontend through `components/room/room-labels.ts`; only the
 * plan's own place names live here.
 */

export const ZONE_LABEL: Record<
  "meeting-room" | "constraint-wall" | "common-area",
  string
> = {
  "meeting-room": "Meeting room",
  "constraint-wall": "Constraint wall",
  "common-area": "Common area",
};

export function zoneLabel(zone: PlanZoneId): string {
  const officeIndex = officeIndexOf(zone);
  if (officeIndex !== null) return `Office ${officeIndex + 1}`;
  return ZONE_LABEL[zone as keyof typeof ZONE_LABEL] ?? "Office";
}

/** What each place is for, shown under its name in the detail rail. */
export const ZONE_PURPOSE: Record<
  "meeting-room" | "constraint-wall" | "common-area",
  string
> = {
  "meeting-room": "Where the room deliberates on one shared candidate.",
  "constraint-wall": "Every published constraint, still owned by its author.",
  "common-area": "Room-wide signals that belong to nobody in particular.",
};

export const PLACE_LABEL: Record<PlanPlace, string> = {
  meeting: "In the meeting room",
  office: "At their desk",
  corridor: "On the floor",
};

/** The action the phase invites, used for the rail's primary button. */
export const PHASE_CALL_TO_ACTION: Record<RoomPhase, string> = {
  input: "Publish your position",
  proposals: "Submit a proposal",
  deliberation: "Raise an objection",
  voting: "Cast your vote",
  approval: "Review the final plan",
  finalized: "Open the decision record",
};
