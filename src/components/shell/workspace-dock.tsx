"use client";

import { useRoom } from "@/components/room/room-provider";
import { WORKSPACE_IDS, WORKSPACE_LABEL, type WorkspaceId } from "@/visualization/scene/camera-poses";
import { useShell, type DrawerId } from "./shell-provider";

/**
 * Layer 3: the workspace dock, and the meeting-controls row beneath it.
 *
 * Selecting a tab never opens another permanent panel — it moves the camera
 * and swaps the one floating workspace card, per the product's screen
 * hierarchy. The row underneath is meeting metadata (participants, role,
 * activity, agents, settings): utilities, not decision
 * content, so they live in drawers rather than in the 3D room.
 */

const WORKSPACE_SUB: Record<WorkspaceId, (context: DockContext) => string> = {
  room: () => "the table",
  brief: () => "read",
  constraints: (c) => (c.selfHasConstraint ? `${c.constraintCount} published` : "yours pending"),
  proposals: (c) =>
    c.hasActiveProposal ? "active" : c.proposalCount > 0 ? `${c.proposalCount} drafted` : "none yet",
  issues: (c) => (c.hasBlockingConflict ? "blocking" : c.openConflictCount > 0 ? "open" : "clear"),
  whiteboard: () => "not tracked yet",
  vote: (c) => (c.votingOpen ? "open" : "not open"),
  decision: (c) => (c.finalized ? "finalized" : c.inApproval ? "in review" : "draft"),
};

interface DockContext {
  selfHasConstraint: boolean;
  constraintCount: number;
  hasActiveProposal: boolean;
  proposalCount: number;
  openConflictCount: number;
  hasBlockingConflict: boolean;
  votingOpen: boolean;
  inApproval: boolean;
  finalized: boolean;
}

const DRAWER_ITEMS: Array<{ id: DrawerId; label: string; accent?: boolean }> = [
  { id: "participants", label: "Participants" },
  { id: "role", label: "My role", accent: true },
  { id: "activity", label: "Activity" },
  { id: "agents", label: "Agents & tools" },
  { id: "settings", label: "Settings" },
];

export function WorkspaceDock() {
  const { room, self, visualization } = useRoom();
  const { activeWorkspace, activeDrawer, goToWorkspace, toggleDrawer } = useShell();

  const openConflicts = visualization.conflicts.filter((conflict) => conflict.status === "open");
  const context: DockContext = {
    selfHasConstraint: self
      ? room.constraints.some((constraint) => constraint.participantId === self.id)
      : false,
    constraintCount: room.constraints.length,
    hasActiveProposal: visualization.activeProposal !== null,
    proposalCount: visualization.proposals.length,
    openConflictCount: openConflicts.length,
    hasBlockingConflict: visualization.consensus.hasBlockingConflict,
    votingOpen: room.phase === "voting",
    inApproval: room.phase === "approval",
    finalized: room.phase === "finalized",
  };

  return (
    <nav className="workspace-dock" aria-label="Meeting workspaces and controls">
      <div className="workspace-tabs" role="tablist" aria-label="Meeting workspaces">
        {WORKSPACE_IDS.map((workspace) => {
          const selected = activeWorkspace === workspace;
          const badge = workspace === "issues" && openConflicts.length > 0 ? openConflicts.length : null;

          return (
            <button
              key={workspace}
              type="button"
              role="tab"
              aria-selected={selected}
              className="workspace-tab"
              onClick={() => goToWorkspace(workspace)}
            >
              <span className="workspace-tab-label">
                {WORKSPACE_LABEL[workspace]}
                {badge !== null ? <span className="workspace-tab-badge">{badge}</span> : null}
              </span>
              <span className="workspace-tab-sub">{WORKSPACE_SUB[workspace](context)}</span>
            </button>
          );
        })}
      </div>

      <div className="meeting-controls">
        {DRAWER_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="meeting-control-button"
            aria-pressed={activeDrawer === item.id}
            onClick={() => toggleDrawer(item.id)}
          >
            <span
              className={
                item.accent ? "meeting-control-dot meeting-control-dot-accent" : "meeting-control-dot"
              }
              aria-hidden="true"
            />
            {item.label}
            {item.id === "participants" ? (
              <span className="meeting-control-count">{room.participants.length}</span>
            ) : null}
          </button>
        ))}

        <span className="meeting-control-version">Room v{room.version}</span>

        <button
          type="button"
          className="meeting-control-button meeting-control-leave"
          aria-pressed={activeDrawer === "leave"}
          onClick={() => toggleDrawer("leave")}
        >
          Leave
        </button>
      </div>
    </nav>
  );
}
