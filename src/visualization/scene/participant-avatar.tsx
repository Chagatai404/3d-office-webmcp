"use client";

import { Clone, useGLTF } from "@react-three/drei";
import type { VisualParticipant } from "@/visualization/room-view-model";
import { RUG_TOP, SURFACE } from "./meeting-room-layout";

/**
 * A participant, in their chair.
 *
 * This was a stack of primitives for as long as no character asset was
 * available. It now loads one of a small cast of low-poly figures — picked
 * from the Ultimate Modular Men / Women packs and folded into a seated pose by
 * `scripts/assets/convert-people.py` — so a seat reads as a person from across
 * the room. The figure keeps its own clothing colours: unlike the furniture
 * props it is not re-shaded from `SURFACE`, because a room of palette-grey
 * mannequins reads worse than one with people in it.
 *
 * It still carries identity and nothing else. The floor ring says the seat is
 * you; the halo says the participant is simulated. Neither is a claim about
 * authority — the panels hold that, and the canvas stays `aria-hidden` behind
 * them.
 *
 * Every figure is exported facing +Z, the way the chair model and the seat
 * math already do, so one rotation turns the seat, the chair and the person
 * together.
 */

/** The cast, indexed by seat. Mixed men and women, office-plausible. */
const CHARACTERS = [
  "woman-suit",
  "man-suit",
  "woman-casual",
  "man-casual",
  "woman-formal",
  "man-hoodie",
  "woman-worker",
  "man-worker",
] as const;

const characterUrl = (id: string) => `/models/people/${id}.glb`;

/** Feet rest on the rug — the same height the chair stands on. */
const FEET_Y = RUG_TOP;

/**
 * The figure sits facing +Z, so −Z is back into the chair. The baked pose
 * puts the pelvis near the model origin; without this the seat of the trousers
 * lands on the front lip of the cushion with the thighs cantilevered over the
 * edge. This slides the whole figure back until the weight is over the pad.
 */
const SIT_BACK = -0.24;

export function ParticipantAvatar({
  participant,
  color,
}: {
  participant: VisualParticipant;
  /** Tints the "you" ring only — never the figure. */
  color: string;
}) {
  const id = CHARACTERS[participant.seatIndex % CHARACTERS.length] ?? CHARACTERS[0];
  const { scene } = useGLTF(characterUrl(id));

  return (
    <group>
      {/* Deep-cloned per seat: a THREE.Object3D can only sit at one point in
          one graph, and past eight seats the cast repeats. Geometry and
          materials stay shared with the cached original. */}
      <Clone object={scene} position={[0, FEET_Y, SIT_BACK]} castShadow />

      {/* A simulated participant is marked by a shape, not only by a label:
          they are visibly not a person, wherever they are sitting. */}
      {participant.kind === "simulation" ? (
        <mesh position={[0, 1.62, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.16, 0.035, 6, 20]} />
          <meshStandardMaterial
            color={SURFACE.quiet}
            emissive={SURFACE.quiet}
            emissiveIntensity={0.4}
            roughness={0.4}
          />
        </mesh>
      ) : null}

      {participant.isSelf ? (
        <mesh position={[0, FEET_Y + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.46, 0.045, 6, 24]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.55}
            roughness={0.4}
          />
        </mesh>
      ) : null}
    </group>
  );
}

// Fetched as the scene module loads, so a seat is never a bare chair for a
// frame while its figure arrives.
for (const id of CHARACTERS) useGLTF.preload(characterUrl(id));
