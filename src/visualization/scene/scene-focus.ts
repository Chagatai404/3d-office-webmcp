import { WORKSPACE_LABEL, type WorkspaceId } from "./camera-poses";

/**
 * What a pointer can select in the room.
 *
 * The room has no places besides the eight workspaces now: clicking a board
 * selects the same id the workspace dock uses, so the 3D room and the dock
 * agree on one vocabulary of "where you are."
 */
export type SceneZoneId = WorkspaceId;

export function zoneLabel(zone: SceneZoneId): string {
  return WORKSPACE_LABEL[zone];
}
