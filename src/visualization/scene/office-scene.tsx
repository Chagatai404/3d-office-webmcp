"use client";

import { PerspectiveCamera } from "@react-three/drei";
import type { RoomVisualizationState } from "@/visualization/room-view-model";
import { CentralMeetingRoom } from "./central-meeting-room";
import { ConstraintWall } from "./constraint-wall";
import { GodViewControls, type CameraFlight } from "./god-view-controls";
import { MiniOffice } from "./mini-office";
import {
  CAMERA,
  COMMON_AREA,
  CONSTRAINT_WALL,
  GROUND,
  MEETING_ROOM,
  OFFICE,
  SURFACE,
  officePlacements,
} from "./office-layout";
import { RoamingParticipants } from "./roaming-participants";
import { cameraPosition, officeZoneId, OVERVIEW_POSE } from "./scene-focus";
import { SelectableZone, useSceneInteraction } from "./scene-interaction";
import { SharedCommonArea } from "./shared-common-area";

/**
 * Where the camera stands before anyone has navigated. Hoisted so the prop
 * keeps one identity and the camera is never re-seated mid-flight.
 */
const START_POSITION = cameraPosition(OVERVIEW_POSE);

/**
 * The office, assembled from one projection of canonical room state.
 *
 * BACKEND CONTRACT:
 * This subtree receives `RoomVisualizationState` and a camera request, and
 * nothing else. It never calls `RoomClient`, never touches the network, and
 * never derives authoritative phase, consensus, vote, or approval state. The
 * zones it makes clickable report a place, not a decision.
 */
export function OfficeScene({
  view,
  focus,
}: {
  view: RoomVisualizationState;
  focus: CameraFlight;
}) {
  const placements = officePlacements();
  const { onSelect } = useSceneInteraction();
  const participantsById = new Map(
    view.participants.map((participant) => [participant.id, participant]),
  );
  const roaming = view.participants.filter(
    (participant) => participant.presence === "roaming",
  );

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={START_POSITION}
        fov={CAMERA.fov}
      />
      <GodViewControls focus={focus} />

      {/* Lightweight lighting: no realtime shadow maps. */}
      <hemisphereLight args={["#d6ecff", "#131c25", 1.55]} />
      <ambientLight intensity={0.58} />
      <directionalLight position={[14, 22, 14]} intensity={1.65} />
      <directionalLight position={[-18, 14, -6]} intensity={0.9} color="#8fd7ff" />
      <directionalLight position={[0, 12, 24]} intensity={0.9} color="#f8c35d" />

      {/* Clicking bare floor steps back out of whatever was selected. */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => onSelect(null)}
      >
        <planeGeometry args={[GROUND.width, GROUND.depth]} />
        <meshStandardMaterial color={SURFACE.ground} roughness={1} />
      </mesh>

      <SelectableZone
        zone="meeting-room"
        highlight={{
          size: [MEETING_ROOM.width, MEETING_ROOM.depth],
          position: [0, MEETING_ROOM.platformHeight + 0.03, 0],
        }}
      >
        <CentralMeetingRoom view={view} />
      </SelectableZone>

      {view.officeSlots.map((slot) => {
        const placement = placements[slot.index];
        if (!placement) return null;
        const participant = slot.participantId
          ? participantsById.get(slot.participantId) ?? null
          : null;

        return (
          <SelectableZone
            key={slot.index}
            zone={officeZoneId(slot.index)}
            /* Offices are rotated a quarter turn, so the world footprint is
               the local depth across X and the local width across Z. */
            highlight={{
              size: [OFFICE.depth, OFFICE.width],
              position: [placement.position[0], 0.05, placement.position[2]],
            }}
          >
            <MiniOffice
              slot={slot}
              placement={placement}
              participant={participant}
              constraints={view.constraints.filter(
                (constraint) => constraint.participantId === slot.participantId,
              )}
            />
          </SelectableZone>
        );
      })}

      <SelectableZone
        zone="constraint-wall"
        highlight={{
          size: [CONSTRAINT_WALL.width, CONSTRAINT_WALL.height],
          position: [
            0,
            CONSTRAINT_WALL.height / 2,
            CONSTRAINT_WALL.position[2] + 0.22,
          ],
          rotation: [0, 0, 0],
        }}
      >
        <ConstraintWall
          constraints={view.constraints}
          participants={view.participants}
        />
      </SelectableZone>

      <SelectableZone
        zone="common-area"
        highlight={{
          size: [COMMON_AREA.width, COMMON_AREA.depth],
          position: [0, 0.05, COMMON_AREA.position[2]],
        }}
      >
        <SharedCommonArea view={view} />
      </SelectableZone>

      {/* The corridor belongs to nobody, so the people walking it sit outside
          every zone rather than inside one of them. */}
      <RoamingParticipants participants={roaming} />
    </>
  );
}
