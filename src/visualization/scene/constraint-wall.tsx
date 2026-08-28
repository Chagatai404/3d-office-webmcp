"use client";

import type {
  VisualConstraint,
  VisualParticipant,
} from "@/visualization/room-view-model";
import { CONSTRAINT_WALL, SURFACE } from "./office-layout";
import { SceneLabel } from "./scene-label";

/**
 * Every published constraint in the room, on one wall.
 *
 * Cards keep their owner's office colour and sit in owner-grouped columns, so
 * a constraint is always readable as belonging to a specific participant
 * rather than to the room in general.
 */
export function ConstraintWall({
  constraints,
  participants,
}: {
  constraints: VisualConstraint[];
  participants: VisualParticipant[];
}) {
  const { width, height, position, columns, rows, cardSize } = CONSTRAINT_WALL;
  const slotByParticipant = new Map(
    participants.map((participant) => [participant.id, participant.officeSlot]),
  );

  // Group by owner so a participant's constraints stay adjacent on the wall.
  const ordered = [...constraints].sort((left, right) => {
    const leftSlot = slotByParticipant.get(left.participantId) ?? 99;
    const rightSlot = slotByParticipant.get(right.participantId) ?? 99;
    if (leftSlot !== rightSlot) return leftSlot - rightSlot;
    return left.id.localeCompare(right.id, "en");
  });

  const columnStep = width / columns;
  const rowStep = (height - 1) / rows;

  return (
    <group position={[position[0], position[1], position[2]]}>
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[width, height, 0.2]} />
        <meshStandardMaterial color={SURFACE.constraintWall} roughness={0.94} />
      </mesh>

      {ordered.slice(0, columns * rows).map((constraint, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const color = constraintColor(constraint);
        const high = constraint.priority === "high";

        return (
          <group
            key={constraint.id}
            position={[
              -width / 2 + columnStep / 2 + column * columnStep,
              height - 0.9 - row * rowStep,
              0.14,
            ]}
          >
            <mesh>
              <boxGeometry
                args={[cardSize, cardSize * 0.58, high ? 0.14 : 0.07]}
              />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={high ? 0.36 : 0.14}
                roughness={0.5}
              />
            </mesh>
            <SceneLabel position={[0, 0, 0.16]} distanceFactor={17}>
              {constraint.category}
            </SceneLabel>
          </group>
        );
      })}

      <SceneLabel
        position={[0, height + 0.7, 0.2]}
        variant="zone"
        distanceFactor={20}
      >
        Constraint wall
      </SceneLabel>
    </group>
  );
}

function constraintColor(constraint: VisualConstraint): string {
  if (constraint.priority === "high") return "#fb7185";

  switch (constraint.category.toLowerCase()) {
    case "outcome":
      return "#5eead4";
    case "accessibility":
    case "quality":
      return "#8fd7ff";
    case "consistency":
      return "#f8c35d";
    case "timing":
      return "#fb7185";
    default:
      return "#c4b5fd";
  }
}
