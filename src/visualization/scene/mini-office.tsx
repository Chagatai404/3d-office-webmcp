"use client";

import type {
  VisualConstraint,
  VisualOfficeSlot,
  VisualParticipant,
} from "@/visualization/room-view-model";
import { OFFICE, SURFACE, slotColor, type OfficePlacement } from "./office-layout";
import { OfficeModel } from "./office-models";
import { ParticipantAvatar } from "./participant-avatar";
import { SceneLabel } from "./scene-label";

/**
 * One participant-owned office.
 *
 * The office exists to make separate authority legible: identity, role, the
 * constraints that participant published, and their own vote and approval
 * state, all inside a space nobody else occupies. Reserved slots stay visible
 * so the room reads as ten seats, four of them taken.
 *
 * The owner is at the desk while they still owe the room their input. An empty
 * office means they are at the table or out on the floor, never that the seat
 * is unclaimed — the nameplate stays either way.
 */

const CARD = { width: 0.9, height: 0.62, thickness: 0.06 };
const WALL_THICKNESS = 0.08;

function GlassPartition({
  width,
  height,
  color,
  frameColor,
  position,
  rotationY = 0,
}: {
  width: number;
  height: number;
  color: string;
  frameColor: string;
  position: [number, number, number];
  rotationY?: number;
}) {
  const railHeight = 0.08;
  const mullionWidth = 0.08;

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width, height, WALL_THICKNESS]} />
        <meshPhysicalMaterial
          color={color}
          transparent
          opacity={0.34}
          roughness={0.08}
          metalness={0}
          transmission={0.45}
          thickness={0.35}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, -height / 2 + railHeight / 2, 0.01]}>
        <boxGeometry args={[width + mullionWidth, railHeight, WALL_THICKNESS * 1.6]} />
        <meshStandardMaterial color={frameColor} roughness={0.38} metalness={0.12} />
      </mesh>
      <mesh position={[0, height / 2 - railHeight / 2, 0.01]}>
        <boxGeometry args={[width + mullionWidth, railHeight, WALL_THICKNESS * 1.6]} />
        <meshStandardMaterial color={frameColor} roughness={0.38} metalness={0.12} />
      </mesh>
      {[-0.5, 0, 0.5].map((offset) => (
        <mesh key={offset} position={[offset * width, 0, 0.02]}>
          <boxGeometry args={[mullionWidth, height, WALL_THICKNESS * 1.8]} />
          <meshStandardMaterial color={frameColor} roughness={0.36} metalness={0.16} />
        </mesh>
      ))}
    </group>
  );
}

function ConstraintCards({
  constraints,
  color,
}: {
  constraints: VisualConstraint[];
  color: string;
}) {
  // Cards stack on the desk in publication order, three per row.
  return (
    <>
      {constraints.slice(0, 9).map((constraint, index) => {
        const column = index % 3;
        const row = Math.floor(index / 3);
        return (
          <mesh
            key={constraint.id}
            position={[
              -0.95 + column * 1.0,
              0.82 + row * 0.09,
              -0.35 + row * 0.02,
            ]}
            rotation={[-Math.PI / 2.35, 0, 0]}
          >
            <boxGeometry args={[CARD.width, CARD.height, CARD.thickness]} />
            <meshStandardMaterial
              color={color}
              roughness={0.55}
              emissive={color}
              emissiveIntensity={
                constraint.priority === "high" ? 0.34 : 0.12
              }
            />
          </mesh>
        );
      })}
    </>
  );
}

function VoteMarker({
  participant,
  color,
}: {
  participant: VisualParticipant;
  color: string;
}) {
  // Geometry, not colour, carries the state: a cast vote raises a pillar and
  // an approval crowns it, so the marker is readable without colour vision.
  const hasVote = participant.vote !== null;
  const height = hasVote ? 0.9 : 0.3;

  return (
    <group position={[1.9, 0, -1.5]}>
      <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.11, 0.14, height, 12]} />
        <meshStandardMaterial
          color={hasVote ? color : SURFACE.officeWallReserved}
          roughness={0.5}
          emissive={hasVote ? color : "#000000"}
          emissiveIntensity={hasVote ? 0.25 : 0}
        />
      </mesh>
      {participant.hasApprovedCurrentDecision ? (
        <mesh position={[0, height + 0.14, 0]}>
          <octahedronGeometry args={[0.18]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.6}
            roughness={0.3}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export function MiniOffice({
  slot,
  placement,
  participant,
  constraints,
}: {
  slot: VisualOfficeSlot;
  placement: OfficePlacement;
  participant: VisualParticipant | null;
  constraints: VisualConstraint[];
}) {
  const occupied = slot.status === "occupied" && participant !== null;
  const color = slotColor(slot.index);
  const isSelf = participant?.isSelf ?? false;
  const floorColor = occupied
    ? isSelf
      ? "#2d4053"
      : SURFACE.officeFloor
    : SURFACE.officeFloorReserved;
  const glassColor = occupied ? SURFACE.officeGlass : SURFACE.officeGlassReserved;
  const frameColor = occupied ? SURFACE.officeFrame : SURFACE.officeFrameReserved;

  return (
    <group position={placement.position} rotation={[0, placement.rotationY, 0]}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[OFFICE.width, OFFICE.depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.95} />
      </mesh>

      {isSelf ? (
        <>
          <pointLight
            position={[0, OFFICE.wallHeight + 0.7, 0]}
            intensity={12}
            distance={6}
            color="#f8c35d"
          />
          <mesh position={[0, 0.08, -OFFICE.depth / 2 + 0.03]}>
            <boxGeometry args={[OFFICE.width, 0.08, 0.12]} />
            <meshStandardMaterial
              color="#f8c35d"
              emissive="#f8c35d"
              emissiveIntensity={0.6}
              roughness={0.35}
            />
          </mesh>
          <mesh position={[-OFFICE.width / 2 + 0.03, 0.08, 0]}>
            <boxGeometry args={[0.12, 0.08, OFFICE.depth]} />
            <meshStandardMaterial
              color="#f8c35d"
              emissive="#f8c35d"
              emissiveIntensity={0.6}
              roughness={0.35}
            />
          </mesh>
        </>
      ) : null}

      {/* Interior-facing office partitions are framed glass, keeping ownership visible without hiding the shared room. */}
      <GlassPartition
        width={OFFICE.width}
        height={OFFICE.wallHeight}
        color={glassColor}
        frameColor={frameColor}
        position={[0, OFFICE.wallHeight / 2, -OFFICE.depth / 2]}
      />
      <GlassPartition
        width={OFFICE.depth}
        height={OFFICE.wallHeight}
        color={glassColor}
        frameColor={frameColor}
        position={[-OFFICE.width / 2, OFFICE.wallHeight / 2, 0]}
        rotationY={Math.PI / 2}
      />

      {/* Owner stripe along the partition top. */}
      <mesh position={[0, OFFICE.wallHeight + 0.06, -OFFICE.depth / 2]}>
        <boxGeometry args={[OFFICE.width, 0.1, 0.16]} />
        <meshStandardMaterial
          color={isSelf ? "#f8c35d" : occupied ? color : SURFACE.officeWallReserved}
          emissive={isSelf ? "#f8c35d" : occupied ? color : "#000000"}
          emissiveIntensity={isSelf ? 0.72 : occupied ? 0.4 : 0}
          roughness={0.4}
        />
      </mesh>

      {occupied && participant ? (
        <>
          <OfficeModel
            name="door"
            colors={[frameColor, glassColor, SURFACE.officeWall]}
            position={[OFFICE.width / 2 - 0.7, 0, OFFICE.depth / 2 - 0.35]}
            rotationY={Math.PI}
            scale={[0.82, 0.9, 0.82]}
            roughness={0.34}
          />
          <OfficeModel
            name="desk"
            colors={[SURFACE.desk, SURFACE.deskAccent]}
            position={[0, 0, -0.9]}
          />
          <OfficeModel
            name="monitor"
            colors={[SURFACE.screen, "#c9d6e2"]}
            position={[0.65, 0.78, -1.05]}
            rotationY={Math.PI}
          />
          {/* Turned to the desk, so the chair and whoever is in it face the
              monitor rather than the door. */}
          <OfficeModel
            name="chair"
            colors={[SURFACE.chair, SURFACE.chairAccent]}
            position={[0, 0, 0.35]}
            rotationY={Math.PI}
          />
          {participant.presence === "office" ? (
            <group position={[0, 0, 0.3]} rotation={[0, Math.PI, 0]}>
              <ParticipantAvatar
                participant={participant}
                color={color}
                pose="sitting"
              />
            </group>
          ) : null}
          <OfficeModel
            name="plant"
            colors={[SURFACE.plant, SURFACE.plantPot, "#2f7047"]}
            position={[-1.9, 0, 1.35]}
            scale={0.72}
          />
          <OfficeModel
            name="whiteboard"
            colors={[SURFACE.board, SURFACE.boardFrame, "#8fa3b8"]}
            position={[-2.05, 0.25, -1.78]}
            rotationY={0}
            scale={[0.55, 0.55, 0.55]}
          />
          <ConstraintCards constraints={constraints} color={color} />
          <VoteMarker participant={participant} color={color} />

          <SceneLabel
            position={[0, OFFICE.wallHeight + 0.7, -OFFICE.depth / 2 + 0.1]}
            variant={participant.isSelf ? "focus" : "office"}
            distanceFactor={14}
          >
            {participant.name}
            {" · "}
            {participant.role}
            {participant.isSelf ? " · You" : ""}
          </SceneLabel>
        </>
      ) : (
        <>
          <OfficeModel
            name="door"
            colors={[frameColor, glassColor, SURFACE.officeWallReserved]}
            position={[OFFICE.width / 2 - 0.7, 0, OFFICE.depth / 2 - 0.35]}
            rotationY={Math.PI}
            scale={[0.82, 0.9, 0.82]}
            roughness={0.42}
          />
          <SceneLabel
            position={[0, OFFICE.wallHeight + 0.55, -OFFICE.depth / 2 + 0.1]}
            variant="muted"
            distanceFactor={14}
          >
            Office {slot.index + 1}
          </SceneLabel>
        </>
      )}
    </group>
  );
}
