"use client";

import type { RoomVisualizationState } from "@/visualization/room-view-model";
import { CentralTable } from "./central-table";
import { ConflictVisualization } from "./conflict-visualization";
import { meetingSeats, MEETING_ROOM, slotColor, SURFACE } from "./office-layout";
import { ProceduralProp } from "./procedural-props";
import { ParticipantAvatar } from "./participant-avatar";
import { SceneLabel } from "./scene-label";

/**
 * The collective decision space.
 *
 * Shared deliberation happens here: the active proposal sits on the table,
 * conflicts are drawn against it, and once the room convenes the participants
 * are sitting around it. Nothing in this subtree decides anything — it renders
 * the projection it is handed, and who is at the table is a reading of the
 * room's phase, not a claim about who may act.
 */
export function CentralMeetingRoom({
  view,
}: {
  view: RoomVisualizationState;
}) {
  const { width, depth, platformHeight, wallHeight } = MEETING_ROOM;
  const seats = meetingSeats();
  const attending = view.participants.filter(
    (participant) => participant.presence === "meeting",
  );

  return (
    <group>
      <pointLight
        position={[0, wallHeight + 2.6, 0.6]}
        intensity={34}
        distance={13}
        color="#f8c35d"
      />

      <mesh position={[0, platformHeight / 2, 0]}>
        <boxGeometry args={[width, platformHeight, depth]} />
        <meshStandardMaterial color={SURFACE.meetingFloor} roughness={0.92} />
      </mesh>

      {/* Back wall with the room whiteboard; the front stays open to camera. */}
      <mesh position={[0, wallHeight / 2 + platformHeight, -depth / 2]}>
        <boxGeometry args={[width, wallHeight, 0.16]} />
        <meshStandardMaterial color={SURFACE.meetingWall} roughness={0.9} />
      </mesh>
      <ProceduralProp
        name="whiteboard"
        colors={[SURFACE.board, SURFACE.boardFrame, "#8fa3b8"]}
        position={[-3.6, platformHeight, -depth / 2 + 0.35]}
      />
      <ProceduralProp
        name="plant"
        colors={[SURFACE.plant, SURFACE.plantPot, "#2f7047"]}
        position={[width / 2 - 1.1, platformHeight, -depth / 2 + 1.1]}
      />

      <CentralTable
        activeProposal={view.activeProposal}
        proposalCount={view.proposals.length}
        hasBlockingConflict={view.consensus.hasBlockingConflict}
      />

      <ConflictVisualization conflicts={view.conflicts} />

      {/* Everyone takes the seat that belongs to their office, so the table
          shows who is in the room without rearranging itself as people join. */}
      {attending.map((participant) => {
        const seat = seats[participant.officeSlot];
        if (!seat) return null;

        return (
          <group
            key={participant.id}
            position={[seat.position[0], platformHeight, seat.position[2]]}
            rotation={[0, seat.rotationY, 0]}
          >
            <ParticipantAvatar
              participant={participant}
              color={slotColor(participant.officeSlot)}
              pose="sitting"
              showName
            />
          </group>
        );
      })}

      <SceneLabel
        position={[0, wallHeight + platformHeight + 0.8, -depth / 2 + 0.2]}
        variant="zone"
        distanceFactor={20}
      >
        Meeting room
      </SceneLabel>
    </group>
  );
}
