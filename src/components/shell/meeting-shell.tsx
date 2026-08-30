"use client";

import { useCallback, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { useRoom } from "@/components/room/room-provider";
import { RoomSummary } from "@/components/room/room-summary";
import type { SceneInteraction } from "@/visualization/scene/scene-interaction";
import { subscribeToUiConfirmation } from "@/webmcp/confirmation-bridge";
import { DrawerHost } from "./drawers/drawer-host";
import { MeetingShellProvider, useShell } from "./shell-provider";
import { MeetingToolbar } from "./meeting-toolbar";
import { WorkspaceDock } from "./workspace-dock";
import { WorkspacePanel } from "./workspace-panel";

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
  const { request, activeWorkspace, reducedMotion, goToWorkspace, handleArrive, openDrawer } = useShell();

  // Bridges a sensitive WebMCP tool's "prepare, don't complete" refusal to
  // the exact visible confirmation surface: open the Participants drawer for
  // a transfer/removal (the alertdialog itself arms via
  // `subscribeToArmedParticipantsRequest` inside `ParticipantPanel`), or move
  // the camera to the Decision workspace for a final-decision confirmation.
  useEffect(
    () =>
      subscribeToUiConfirmation((event) => {
        if (event.kind === "participants") openDrawer("participants");
        else goToWorkspace("decision");
      }),
    [openDrawer, goToWorkspace],
  );

  const interaction = useMemo<SceneInteraction>(
    () => ({
      selectedZone: activeWorkspace,
      onSelect: (zone) => {
        if (zone !== null) goToWorkspace(zone);
      },
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
      {activeWorkspace === "room" ? <RoomSummary /> : null}
      <WorkspacePanel />
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
