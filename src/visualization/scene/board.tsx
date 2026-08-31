"use client";

import { SURFACE } from "./meeting-room-layout";
import { useBoardFaceTexture } from "./textures";

/** How much of a board's height the name band takes, when it has one. */
const LABEL_BAND = 0.52;

/** The frame's border around the writing surface, and the board's thickness. */
const FRAME_BORDER = 0.08;
const BOARD_DEPTH = 0.08;

/**
 * A wall-mounted surface: a slim dark frame around one written face.
 *
 * Transcribed from the imported design's `board()` factory. The card count
 * and the accent card are driven by real room state (constraint count, open
 * issue count, and so on) rather than fixed numbers, so the room's geometry
 * says something true about the decision.
 *
 * The name and the cards are drawn *into* the face rather than built in front
 * of it. They used to be meshes — a 30mm slab per card floating 5mm off a
 * panel that itself stood 40mm proud of the frame — which up close read as
 * tiles propped against the board instead of anything written on it. Now the
 * board is a frame and a surface, and everything on it is that surface.
 *
 * The name is signage, not content: one fixed word per workspace, drawn at
 * runtime rather than baked into an authored texture. Everything a board
 * actually reports still lives in the dock and its panel — the canvas stays
 * `aria-hidden`, and no participant, proposal or vote text is ever drawn here.
 */
export function Board({
  width,
  height,
  face = SURFACE.boardLight,
  label,
  cardCount = 0,
  columns = 4,
  cardColor = SURFACE.card,
  accentIndex = -1,
  active = false,
}: {
  width: number;
  height: number;
  face?: string;
  /** The workspace's name, shown across the top of the board. */
  label?: string;
  cardCount?: number;
  columns?: number;
  cardColor?: string;
  accentIndex?: number;
  /** True when this is the workspace currently in camera focus. */
  active?: boolean;
}) {
  const faceWidth = width - FRAME_BORDER * 2;
  const faceHeight = height - FRAME_BORDER * 2;
  // Dark boards take light lettering and light boards dark, off the face's own
  // brightness, so a board can change colour without its name going unreadable.
  const ink = luminance(face) > 0.5 ? SURFACE.frame : SURFACE.boardLight;

  const drawn = useBoardFaceTexture({
    width: faceWidth,
    height: faceHeight,
    color: face,
    label,
    ink,
    band: label ? LABEL_BAND : 0,
    cardCount,
    columns,
    cardColor,
    accentColor: SURFACE.accent,
    accentIndex: active ? accentIndex : -1,
  });

  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, BOARD_DEPTH]} />
        <meshStandardMaterial color={SURFACE.frame} roughness={0.6} metalness={0.02} />
      </mesh>
      {/* 6mm proud of the frame's front, and offset in the depth buffer on top
          of that. 1mm was enough to separate them on paper and not in fact:
          the welcome camera sits 30m back, where the default near plane leaves
          about half a millimetre of depth resolution, and the face broke into
          speckle against the frame behind it. 6mm is still nothing against an
          80mm border — the face reads as sitting in the frame. */}
      <mesh position={[0, 0, BOARD_DEPTH / 2 + 0.006]} receiveShadow>
        <planeGeometry args={[faceWidth, faceHeight]} />
        <meshStandardMaterial
          color={drawn ? "#ffffff" : face}
          map={drawn}
          roughness={0.92}
          metalness={0.02}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  );
}

/** Rough perceptual brightness of a `#rrggbb` colour, 0 to 1. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
