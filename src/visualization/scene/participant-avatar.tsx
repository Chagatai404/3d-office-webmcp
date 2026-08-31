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

/**
 * How the figure meets the chair, measured off both meshes rather than judged
 * by eye.
 *
 * Sampling `office-chair.glb` by height gives a seat pad whose top is at
 * y≈0.44, running from z −0.30 at the backrest to z +0.35 at the front lip;
 * the backrest's front face stands around z −0.29. Sampling a figure gives
 * a baked seated pose with the feet at y=0, the buttocks underside at y≈0.47,
 * and the buttocks spanning z −0.21 to +0.10 before the thighs carry forward
 * to the knees.
 *
 * `SIT_BACK` was −0.24, which put the backside at z −0.45 — through the
 * backrest and off the back of the pad, so the figure read as hovering behind
 * its chair. −0.08 sits the buttocks over the rear half of the pad with the
 * lower back just off the backrest, which is how a person actually sits.
 */
const SIT_BACK = -0.08;

/**
 * The pose expects a 0.47 seat and the pad is at 0.44, so the figure drops
 * 3cm to close the gap. Split as 2cm here and 1cm left to the cushion: sinking
 * the feet 2cm into the rug pile is invisible, where a bottom floating a
 * finger's width above the pad is not.
 */
const SIT_DROP = -0.02;

/** Feet rest on the rug — the same height the chair stands on. */
const FEET_Y = RUG_TOP + SIT_DROP;

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
