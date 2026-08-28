"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useRoom } from "@/components/room/room-provider";
import type { SceneInteraction } from "@/visualization/scene/scene-interaction";
import { Dock } from "./dock";
import { Hud } from "./hud";
import { OsWindow } from "./os-window";
import { useShell, WorldShellProvider } from "./shell-provider";
import { layoutWindows } from "./window-state";

/**
 * The room as a place rather than a page.
 *
 * The 3D office fills the viewport and everything else — the brief, positions,
 * participants, the ledger — floats above it in windows you open, move, and
 * close. Both layers read the same snapshot from `RoomProvider`: the scene
 * gets the visualization projection, the panels get the room state, and
 * neither knows the other exists.
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
          <p className="panel-note">Preparing the 3D office…</p>
        </div>
      </div>
    ),
  },
);

function World() {
  const { visualization } = useRoom();
  const {
    camera,
    ready,
    windows,
    viewport,
    selectedZone,
    visitZone,
    clearSelection,
    setHoveredZone,
  } = useShell();

  const interaction = useMemo<SceneInteraction>(
    () => ({
      selectedZone,
      onSelect: (zone) => (zone === null ? clearSelection() : visitZone(zone)),
      onHover: setHoveredZone,
    }),
    [selectedZone, visitZone, clearSelection, setHoveredZone],
  );

  return (
    <div className="world-shell">
      <div className="world-scene">
        <RoomVisualization
          view={visualization}
          focus={camera}
          interaction={interaction}
        />
      </div>

      <Hud />

      {/* Windows are laid out against the measured viewport, so they wait one
          tick rather than opening in the wrong place and jumping. */}
      <div className="window-layer">
        {ready
          ? layoutWindows(windows, viewport).map((window) => (
              <OsWindow key={window.id} window={window} />
            ))
          : null}
      </div>

      <Dock />
    </div>
  );
}

export function DesktopShell() {
  return (
    <WorldShellProvider>
      <World />
    </WorldShellProvider>
  );
}
