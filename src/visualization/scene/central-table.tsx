"use client";

import type { VisualProposal } from "@/visualization/room-view-model";
import { meetingSeats, SURFACE } from "./office-layout";
import { ProceduralProp } from "./procedural-props";
import { SceneLabel } from "./scene-label";

/**
 * The focal object of the meeting room.
 *
 * The table carries the active proposal. With no candidate yet, it shows the
 * room is still gathering input rather than pretending a decision exists.
 */
export function CentralTable({
  activeProposal,
  proposalCount,
  hasBlockingConflict,
}: {
  activeProposal: VisualProposal | null;
  proposalCount: number;
  hasBlockingConflict: boolean;
}) {
  return (
    <group>
      <mesh position={[0, 0.175, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.7, 4.25, 96]} />
        <meshStandardMaterial
          color={hasBlockingConflict ? "#fb7185" : "#f8c35d"}
          emissive={hasBlockingConflict ? "#fb7185" : "#f8c35d"}
          emissiveIntensity={0.34}
          roughness={0.42}
          transparent
          opacity={0.72}
        />
      </mesh>

      {/* Stretched on the floor plane only: a long table, not a tall one. */}
      <ProceduralProp
        name="meeting-table"
        colors={[SURFACE.table, SURFACE.tableAccent]}
        position={[0, 0.16, 0]}
        scale={[3.6, 1, 2.4]}
      />

      {/* One chair per office, so the room reads as ten seats here too, and a
          participant's place at the table is as fixed as their office is. */}
      {meetingSeats().map((seat) => (
        <ProceduralProp
          key={seat.index}
          name="chair"
          colors={[SURFACE.chair, SURFACE.chairAccent]}
          position={[seat.position[0], 0.16, seat.position[2]]}
          rotationY={seat.rotationY}
        />
      ))}

      {activeProposal ? (
        <group position={[0, 1.05, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <boxGeometry args={[1.5, 1.05, 0.05]} />
            <meshStandardMaterial
              color="#f2f6fa"
              emissive="#f2f6fa"
              emissiveIntensity={0.22}
              roughness={0.45}
            />
          </mesh>
          {hasBlockingConflict ? (
            // A blocking objection is marked by an extra raised body as well
            // as colour, so severity never depends on hue alone.
            <mesh position={[0, 0.4, 0]}>
              <torusGeometry args={[0.42, 0.09, 8, 24]} />
              <meshStandardMaterial
                color="#f97066"
                emissive="#f97066"
                emissiveIntensity={0.5}
                roughness={0.4}
              />
            </mesh>
          ) : null}
          <SceneLabel position={[0, 0.95, 0]} variant="focus" distanceFactor={17}>
            {activeProposal.title}
          </SceneLabel>
        </group>
      ) : (
        <SceneLabel position={[0, 1.5, 0]} variant="focus" distanceFactor={17}>
          {proposalCount === 0
            ? "No proposal yet"
            : `${proposalCount} proposal${proposalCount === 1 ? "" : "s"} drafted · none active`}
        </SceneLabel>
      )}
    </group>
  );
}
