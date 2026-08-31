import type { RoomPhase } from "@/contracts/room";
import type { WorkspaceId } from "@/visualization/scene/camera-poses";

/**
 * Where the room stands while it is in each phase.
 *
 * The 3D room is a projection of canonical state, and this is the last piece
 * of that projection: a phase is not only a label in the toolbar, it is a
 * place. Reading the two together — "Deliberation" and the issues board in
 * front of you — is what makes the scene reinforce the meeting rather than
 * become navigation work on top of it.
 *
 * `input` maps to the table rather than to the Constraints board on purpose.
 * Input is the phase whose subject is the *people*: who has shared, who has
 * marked ready, who the room is still waiting on. That is the seat ring, and
 * the seat markers there say it without a word of 3D text.
 *
 * `finalized` maps to the same decision pedestal `approval` does. The exact
 * candidate a person confirmed and the record that confirmation produced are
 * one artifact at one place in the room, so the pedestal simply stops being a
 * review surface and becomes the report surface.
 */
export const PHASE_WORKSPACE: Record<RoomPhase, WorkspaceId> = {
  input: "room",
  proposals: "proposals",
  deliberation: "issues",
  voting: "alignment",
  approval: "decision",
  finalized: "decision",
};
