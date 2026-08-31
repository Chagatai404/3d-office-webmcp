import type { AttentionItem, AttentionItemType, RoomPhase } from "@/contracts/room";
import type { WorkspaceId } from "@/visualization/scene/camera-poses";

/**
 * Where reviewing an attention item sends the viewer.
 *
 * Shared rather than owned by the drawer: the drawer's list and the alert
 * that appears the moment an item arrives are two doors onto the same item,
 * and a "Review" that led somewhere different depending on which door you
 * used would be a bug waiting to happen.
 */
export interface AttentionTarget {
  drawer?: "participants";
  workspace?: WorkspaceId;
}

export function targetFor(item: AttentionItem, phase: RoomPhase): AttentionTarget {
  const routes: Record<AttentionItemType, AttentionTarget> = {
    input_required: { workspace: "constraints" },
    admission_request: { drawer: "participants" },
    conflict_requires_human: { workspace: "issues" },
    alignment_required: { workspace: "alignment" },
    owner_decision_required: { workspace: "decision" },
    consensus_approval_required: { workspace: "decision" },
    expert_advice_needs_disposition: { workspace: "alignment" },
    owner_progress_required: {
      workspace:
        phase === "proposals"
          ? "proposals"
          : phase === "deliberation"
            ? "issues"
            : phase === "voting"
              ? "alignment"
              : "room",
    },
  };
  return routes[item.type];
}
