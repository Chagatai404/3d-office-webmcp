"use client";

import { useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRoom } from "@/components/room/room-provider";
import { RoomSummary } from "@/components/room/room-summary";
import type { SceneInteraction } from "@/visualization/scene/scene-interaction";
import { subscribeToUiConfirmation } from "@/webmcp/confirmation-bridge";
import { AttentionAlerts } from "./attention-alerts";
import { AttentionToasts } from "./attention-toasts";
import { BackToRoomButton } from "./back-to-room-button";
import { BoardSidePanel } from "./board-side-panel";
import { ChromeToggle } from "./chrome-toggle";
import { DrawerHost } from "./drawers/drawer-host";
import { MeetingShellProvider, useShell } from "./shell-provider";
import { useAutoAdvancePhase } from "./use-auto-advance-phase";
import { usePhaseFollow } from "./use-phase-follow";
import { MeetingToolbar } from "./meeting-toolbar";
import { WorkspaceDock } from "./workspace-dock";

/**
 * The room as a place rather than a page.
 *
 * The 3D meeting room fills the viewport; the toolbar, the workspace dock,
 * the one active workspace card, and at most one drawer float above it. Both
 * layers read the same snapshot from `RoomProvider`: the scene gets the
 * visualization projection, the panels get the room state, and neither knows
 * the other exists.
 */

const RoomVisualization = dynamic(
  () =>
    import("@/visualization/room-visualization").then(
      (module) => module.RoomVisualization,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="scene-frame">
        <div className="scene-fallback">
          <p className="panel-note">Preparing the meeting room…</p>
        </div>
      </div>
    ),
  },
);

function World() {
  const { visualization } = useRoom();
  const {
    request,
    activeWorkspace,
    reducedMotion,
    goToWorkspace,
    handleArrive,
    openDrawer,
    openDecisionReviewForHuman,
  } = useShell();

  // The room follows the meeting: when the canonical phase changes, the camera
  // stands where the work now is, rather than leaving people to find it.
  usePhaseFollow();

  // The room moves itself through its procedural phases -- see
  // `useAutoAdvancePhase` for which transitions this covers and why
  // Decision review is deliberately left out.
  useAutoAdvancePhase();

  // Bridges a sensitive WebMCP tool's "prepare, don't complete" refusal to
  // the exact visible confirmation surface: open the Participants drawer for
  // a transfer/removal (the alertdialog itself arms via
  // `subscribeToArmedParticipantsRequest` inside `ParticipantPanel`), or move
  // the camera to the Decision workspace for a final-decision confirmation --
  // there, carrying the hand-off notice, so the person arrives understanding
  // that their agent stopped on purpose rather than failed.
  useEffect(
    () =>
      subscribeToUiConfirmation((event) => {
        if (event.kind === "participants") openDrawer("participants");
        else if (event.kind === "decision") openDecisionReviewForHuman();
        else goToWorkspace("whiteboard");
      }),
    [goToWorkspace, openDrawer, openDecisionReviewForHuman],
  );

  const interaction = useMemo<SceneInteraction>(
    () => ({
      selectedZone: activeWorkspace,
      onSelect: (zone) => {
        if (zone !== null) goToWorkspace(zone);
      },
      // Pressing one written item on a board goes to the same place as
      // pressing the board, and additionally says which item to open at.
      onOpenItem: (zone, itemId) => goToWorkspace(zone, itemId),
      onHover: () => {},
    }),
    [activeWorkspace, goToWorkspace],
  );

  const onArrive = useCallback((workspace: typeof activeWorkspace) => handleArrive(workspace), [handleArrive]);

  return (
    <div className="world-shell">
      <div className="world-scene">
        <RoomVisualization
          view={visualization}
          request={request}
          reducedMotion={reducedMotion}
          onArrive={onArrive}
          interaction={interaction}
        />
      </div>

      <MeetingToolbar />
      <ChromeToggle />
      <BackToRoomButton />
      <AttentionToasts />
      <AttentionAlerts />
      {activeWorkspace === "room" ? <RoomSummary /> : null}
      <BoardSidePanel />
      <DrawerHost />
      <WorkspaceDock />
    </div>
  );
}

export function MeetingShell() {
  return (
    <MeetingShellProvider>
      <World />
    </MeetingShellProvider>
  );
}
