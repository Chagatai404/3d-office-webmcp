import {
  officeIndexOf,
  type SceneZoneId,
} from "@/visualization/scene/scene-focus";
import type { WindowId } from "./window-state";

/**
 * Which panel explains which place.
 *
 * Clicking the constraint wall should not open a panel about the wall: it
 * should open the positions those constraints came from. That mapping is the
 * whole idea of moving through the room instead of through a menu.
 */
const ZONE_WINDOW: Partial<Record<SceneZoneId, WindowId>> = {
  "meeting-room": "brief",
  "constraint-wall": "positions",
  "common-area": "activity",
};

export function windowForZone(zone: SceneZoneId): WindowId | null {
  if (officeIndexOf(zone) !== null) return "participants";
  return ZONE_WINDOW[zone] ?? null;
}
