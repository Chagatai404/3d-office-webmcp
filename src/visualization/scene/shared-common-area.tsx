"use client";

import type { RoomVisualizationState } from "@/visualization/room-view-model";
import { COMMON_AREA, SURFACE } from "./office-layout";
import { OfficeModel } from "./office-models";
import { SceneLabel } from "./scene-label";

/**
 * Room-wide signals that belong to nobody in particular.
 *
 * Consensus progress, open objections, and the room's phase live here rather
 * than in any one office, which is what makes the space read as shared.
 */

function ProgressBar({
  value,
  color,
  position,
}: {
  value: number;
  color: string;
  position: [number, number, number];
}) {
  const width = 4.4;
  const clamped = Math.min(1, Math.max(0, value));

  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[width, 0.32, 0.14]} />
        <meshStandardMaterial color="#1d2a38" roughness={0.9} />
      </mesh>
      {clamped > 0 ? (
        <mesh position={[-width / 2 + (width * clamped) / 2, 0, 0.06]}>
          <boxGeometry args={[width * clamped, 0.32, 0.14]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.45}
            roughness={0.4}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export function SharedCommonArea({
  view,
}: {
  view: RoomVisualizationState;
}) {
  const { width, depth, position } = COMMON_AREA;
  const openConflicts = view.conflicts.filter(
    (conflict) => conflict.status === "open",
  ).length;

  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={SURFACE.commonFloor} roughness={0.95} />
      </mesh>

      <OfficeModel
        name="whiteboard"
        colors={[SURFACE.board, SURFACE.boardFrame, "#8fa3b8"]}
        position={[-8.2, 0, -2.2]}
      />
      <OfficeModel
        name="plant"
        colors={[SURFACE.plant, SURFACE.plantPot, "#2f7047"]}
        position={[8.4, 0, -1.2]}
      />

      <ProgressBar
        value={view.consensus.voteProgress}
        color="#60a5fa"
        position={[-3.4, 1.35, -1.9]}
      />
      <ProgressBar
        value={view.consensus.approvalProgress}
        color="#5eead4"
        position={[1.9, 1.35, -1.9]}
      />

      {/* Open-issue beacon: present only when there is something to raise. */}
      <group position={[6.2, 0, -1.9]}>
        <mesh position={[0, 0.5, 0]}>
          <cylinderGeometry args={[0.5, 0.62, 1, 12]} />
          <meshStandardMaterial
            color={openConflicts > 0 ? "#f97066" : "#1f3040"}
            emissive={openConflicts > 0 ? "#f97066" : "#000000"}
            emissiveIntensity={openConflicts > 0 ? 0.5 : 0}
            roughness={0.5}
          />
        </mesh>
        <SceneLabel
          position={[0, 1.35, 0]}
          variant={openConflicts > 0 ? "alert" : "muted"}
          distanceFactor={16}
        >
          {openConflicts} open issue{openConflicts === 1 ? "" : "s"}
        </SceneLabel>
      </group>

      <SceneLabel position={[0, 3.4, -1.9]} variant="zone" distanceFactor={20}>
        Common area
      </SceneLabel>
    </group>
  );
}
