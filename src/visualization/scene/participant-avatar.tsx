"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group } from "three";
import type { VisualParticipant } from "@/visualization/room-view-model";
import { SURFACE } from "./office-layout";
import { SceneLabel } from "./scene-label";

/**
 * A participant, in the room.
 *
 * The figure is procedural rather than a character asset: the packs available
 * here ship no rigged people, and a handful of primitives keeps the office one
 * visual language and costs nothing to load.
 *
 * It carries identity and nothing else. The office colour says who this is,
 * the halo says the participant is simulated, the floor ring says it is you.
 * None of that is a claim about authority — the panels hold that, and the
 * canvas stays `aria-hidden` behind them.
 *
 * Unrotated, an avatar faces +Z, the same way the chair model does, so seats
 * and avatars share one set of rotations.
 */

export type AvatarPose = "sitting" | "standing" | "walking";

const HIP_HEIGHT = { standing: 0.86, sitting: 0.46 } as const;

/** Every part is measured from the hips, so a pose only moves the hips. */
const BODY = {
  torsoHeight: 0.54,
  shoulderY: 0.5,
  shoulderX: 0.28,
  headY: 0.72,
  headRadius: 0.17,
  thighLength: 0.44,
  shinLength: 0.42,
  hipX: 0.13,
} as const;

/** Radians per second, and how far each limb swings. */
const STRIDE_RATE = 5.2;
const LEG_SWING = 0.52;
const ARM_SWING = 0.38;
const BOB = 0.05;

/** Arms rest slightly out when upright and reach forward when seated. */
const ARM_REST = { upright: 0.12, sitting: -0.62 } as const;

function setPitch(limb: Group | null, radians: number) {
  if (limb) limb.rotation.x = radians;
}

export function ParticipantAvatar({
  participant,
  color,
  pose,
  showName = false,
}: {
  participant: VisualParticipant;
  color: string;
  pose: AvatarPose;
  /** Offices carry a nameplate already; the table and the floor do not. */
  showName?: boolean;
}) {
  const hips = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);

  const sitting = pose === "sitting";
  const walking = pose === "walking";
  const hipHeight = sitting ? HIP_HEIGHT.sitting : HIP_HEIGHT.standing;

  // Seated, the thighs go forward and the shins drop back down under them.
  const thighRest = sitting ? -Math.PI / 2 : 0;
  const shinRest = sitting ? Math.PI / 2 : 0;
  const armRest = sitting ? ARM_REST.sitting : ARM_REST.upright;

  /* Limbs are driven here for every pose, not only while walking: a figure
     that sat down after a walk would otherwise keep the last frame's stride,
     since the resting rotation prop has not changed. */
  useFrame((state) => {
    const swing = walking
      ? Math.sin(state.clock.elapsedTime * STRIDE_RATE + participant.officeSlot)
      : 0;

    setPitch(leftLeg.current, thighRest + swing * LEG_SWING);
    setPitch(rightLeg.current, thighRest - swing * LEG_SWING);
    setPitch(leftArm.current, armRest - swing * ARM_SWING);
    setPitch(rightArm.current, armRest + swing * ARM_SWING);

    if (hips.current) {
      // Two bobs per stride, centred so the feet stay on the floor.
      hips.current.position.y =
        hipHeight + (walking ? (Math.abs(swing) - 0.5) * BOB : 0);
    }
  });

  return (
    <group>
      <group ref={hips} position={[0, hipHeight, 0]}>
        {/* Torso: the office colour, so identity reads from across the room. */}
        <mesh position={[0, BODY.torsoHeight / 2, 0]}>
          <cylinderGeometry args={[0.26, 0.21, BODY.torsoHeight, 8]} />
          <meshStandardMaterial
            color={color}
            roughness={0.55}
            emissive={color}
            emissiveIntensity={0.12}
          />
        </mesh>

        <mesh position={[0, BODY.torsoHeight + 0.04, 0]}>
          <cylinderGeometry args={[0.07, 0.08, 0.09, 6]} />
          <meshStandardMaterial color={SURFACE.avatarLimb} roughness={0.7} />
        </mesh>

        <mesh position={[0, BODY.headY, 0]}>
          <icosahedronGeometry args={[BODY.headRadius, 0]} />
          <meshStandardMaterial color={SURFACE.avatarHead} roughness={0.65} />
        </mesh>

        {/* The visor faces forward, so which way somebody is turned is legible
            even in silhouette at god-view height. */}
        <mesh position={[0, BODY.headY + 0.01, BODY.headRadius * 0.82]}>
          <boxGeometry args={[0.23, 0.075, 0.07]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.75}
            roughness={0.3}
          />
        </mesh>

        {([-1, 1] as const).map((side) => (
          <group
            key={`arm-${side}`}
            ref={side === -1 ? leftArm : rightArm}
            position={[side * BODY.shoulderX, BODY.shoulderY, 0]}
            rotation={[armRest, 0, 0]}
          >
            <mesh position={[0, -0.26, 0]}>
              <boxGeometry args={[0.13, 0.52, 0.14]} />
              <meshStandardMaterial color={SURFACE.avatarLimb} roughness={0.7} />
            </mesh>
          </group>
        ))}

        {([-1, 1] as const).map((side) => (
          <group
            key={`leg-${side}`}
            ref={side === -1 ? leftLeg : rightLeg}
            position={[side * BODY.hipX, 0, 0]}
            rotation={[thighRest, 0, 0]}
          >
            <mesh position={[0, -BODY.thighLength / 2, 0]}>
              <boxGeometry args={[0.17, BODY.thighLength, 0.19]} />
              <meshStandardMaterial color={SURFACE.avatarLimb} roughness={0.7} />
            </mesh>

            <group position={[0, -BODY.thighLength, 0]} rotation={[shinRest, 0, 0]}>
              <mesh position={[0, -BODY.shinLength / 2, 0]}>
                <boxGeometry args={[0.15, BODY.shinLength, 0.17]} />
                <meshStandardMaterial
                  color={SURFACE.avatarLimb}
                  roughness={0.7}
                />
              </mesh>
              <mesh position={[0, -BODY.shinLength + 0.045, 0.045]}>
                <boxGeometry args={[0.17, 0.09, 0.26]} />
                <meshStandardMaterial color={SURFACE.avatarHead} roughness={0.8} />
              </mesh>
            </group>
          </group>
        ))}

        {/* A simulated participant is marked by a shape, not only by a label:
            they are visibly not a person, wherever they are standing. */}
        {participant.kind === "simulation" ? (
          <mesh position={[0, BODY.headY + 0.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.14, 0.035, 6, 18]} />
            <meshStandardMaterial
              color={color}
              emissive={color}
              emissiveIntensity={0.7}
              roughness={0.35}
            />
          </mesh>
        ) : null}
      </group>

      {participant.isSelf ? (
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.42, 0.045, 6, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.55}
            roughness={0.4}
          />
        </mesh>
      ) : null}

      {showName ? (
        <SceneLabel
          position={[0, hipHeight + 1.15, 0]}
          variant="office"
          distanceFactor={11}
        >
          {participant.name}
        </SceneLabel>
      ) : null}
    </group>
  );
}
