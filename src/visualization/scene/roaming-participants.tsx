"use client";

import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { VisualParticipant } from "@/visualization/room-view-model";
import {
  circuitPoint,
  ROAMING,
  roamingCircuit,
  slotColor,
} from "./office-layout";
import { ParticipantAvatar } from "./participant-avatar";
import { officeZoneId } from "./scene-focus";
import { useSceneInteraction } from "./scene-interaction";

/**
 * The participants who are not at a desk and not at the table.
 *
 * They walk the corridor between the offices and the meeting room. The walk is
 * a function of the clock and the office slot, never of accumulated frame
 * state, so it is the same walk in every tab and after any number of dropped
 * frames — and it stops entirely for a viewer who asked for less motion.
 *
 * A walking participant is still theirs: pointing at one highlights the office
 * it belongs to, and clicking flies there, which is the same thing the dock
 * and the participant panel do.
 */

function RoamingParticipant({
  participant,
  animated,
}: {
  participant: VisualParticipant;
  animated: boolean;
}) {
  const walker = useRef<Group>(null);
  const circuit = roamingCircuit(participant.officeSlot);
  const start = circuitPoint(circuit, circuit.offset);

  useFrame((state) => {
    if (!animated) return;
    const group = walker.current;
    if (!group) return;

    const point = circuitPoint(
      circuit,
      circuit.offset + state.clock.elapsedTime * ROAMING.speed,
    );
    group.position.set(...point.position);
    group.rotation.y = point.rotationY;
  });

  return (
    <group
      ref={walker}
      position={start.position}
      rotation={[0, start.rotationY, 0]}
    >
      <ParticipantAvatar
        participant={participant}
        color={slotColor(participant.officeSlot)}
        pose={animated ? "walking" : "standing"}
        showName
      />
    </group>
  );
}

export function RoamingParticipants({
  participants,
}: {
  participants: VisualParticipant[];
}) {
  const { hoveredZone, onSelect, onHover } = useSceneInteraction();

  // Read once, the way a camera flight does: the walk is either on for this
  // viewer or it is not.
  const [animated] = useState(
    () =>
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  return (
    <>
      {participants.map((participant) => {
        const zone = officeZoneId(participant.officeSlot);

        return (
          <group
            key={participant.id}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(zone);
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              onHover(zone);
            }}
            onPointerOut={() => {
              if (hoveredZone === zone) onHover(null);
            }}
          >
            <RoamingParticipant participant={participant} animated={animated} />
          </group>
        );
      })}
    </>
  );
}
