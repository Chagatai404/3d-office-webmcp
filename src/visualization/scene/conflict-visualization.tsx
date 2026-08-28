"use client";

import type { VisualConflict } from "@/visualization/room-view-model";
import { MEETING_ROOM } from "./office-layout";
import { SceneLabel } from "./scene-label";

/**
 * Open objections against the proposal on the table.
 *
 * Severity is carried by size, height, and shape as well as colour: blocking
 * objections are taller, thicker markers that sit above the table, warnings
 * are low and flat. Conflict-to-constraint links arrive with the objection
 * milestone; this component already reads the same projection it will use.
 */
export function ConflictVisualization({
  conflicts,
}: {
  conflicts: VisualConflict[];
}) {
  const open = conflicts.filter((conflict) => conflict.status === "open");
  if (open.length === 0) return null;

  return (
    <group position={[0, MEETING_ROOM.platformHeight, 2.6]}>
      {open.map((conflict, index) => {
        const blocking = conflict.severity === "blocking";
        const height = blocking ? 1.5 : 0.65;
        const x = (index - (open.length - 1) / 2) * 1.1;

        return (
          <group key={conflict.id} position={[x, 0, 0]}>
            <mesh position={[0, height / 2, 0]}>
              {blocking ? (
                <boxGeometry args={[0.42, height, 0.42]} />
              ) : (
                <cylinderGeometry args={[0.2, 0.26, height, 10]} />
              )}
              <meshStandardMaterial
                color={blocking ? "#f97066" : "#fbbf24"}
                emissive={blocking ? "#f97066" : "#fbbf24"}
                emissiveIntensity={blocking ? 0.55 : 0.3}
                roughness={0.45}
              />
            </mesh>
          </group>
        );
      })}

      <SceneLabel position={[0, 2.1, 0]} variant="alert" distanceFactor={16}>
        {open.length} open objection{open.length === 1 ? "" : "s"}
      </SceneLabel>
    </group>
  );
}
