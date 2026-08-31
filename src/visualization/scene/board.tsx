"use client";

import { useState } from "react";
import { SURFACE } from "./meeting-room-layout";
import {
  type BoardCard,
  type BoardFaceRect,
  boardBodyRect,
  boardCardRects,
  useBoardFaceTexture,
} from "./textures";

/** How much of a board's height the name band takes, when it has one. */
const LABEL_BAND = 0.52;

/** The frame's border around the writing surface, and the board's thickness. */
const FRAME_BORDER = 0.08;
const BOARD_DEPTH = 0.08;

/**
 * How far in front of the face the pressable quads sit.
 *
 * The face itself is 6mm proud of the frame; another 6mm keeps a hit target
 * unambiguously in front of the pixels it covers, and is still nothing against
 * an 80mm border — nothing here reads as standing off the board.
 */
const HIT_LIFT = BOARD_DEPTH / 2 + 0.012;

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
 * The name is signage; the cards carry the concise real text the matching
 * workspace panel shows. The panel stays the accessible source of truth (the
 * canvas is `aria-hidden`) — the board is its echo on the wall.
 */
export function Board({
  width,
  height,
  face = SURFACE.boardLight,
  label,
  cards = [],
  columns = 4,
  cardColor = SURFACE.card,
  body,
  active = false,
  onPress,
}: {
  width: number;
  height: number;
  face?: string;
  /** The workspace's name, shown across the top of the board. */
  label?: string;
  /** Concise real text, one card per item. */
  cards?: BoardCard[];
  columns?: number;
  cardColor?: string;
  /** A flowing paragraph shown instead of cards (Brief board). */
  body?: string;
  /** True when this is the workspace currently in camera focus. */
  active?: boolean;
  /**
   * A single written thing on this board was pressed: one card, or the whole
   * paragraph on a `body` board. The board says *what* was pressed and stops
   * there — the shell decides that it means "open this item's workspace",
   * exactly as it already decides what selecting the board means.
   */
  onPress?: ((card: BoardCard | null) => void) | undefined;
}) {
  const faceWidth = width - FRAME_BORDER * 2;
  const faceHeight = height - FRAME_BORDER * 2;
  // Dark boards take light lettering and light boards dark, off the face's own
  // brightness, so a board can change colour without its name going unreadable.
  const ink = luminance(face) > 0.5 ? SURFACE.frame : SURFACE.boardLight;

  // The accent tone only lights up on the board currently in camera focus;
  // elsewhere the active item sits in the grid like any other card.
  const resolvedCards = active
    ? cards
    : cards.map((card) =>
        card.tone === "accent" ? { ...card, tone: "default" as const } : card,
      );

  // Which written thing the pointer is over, by index; -1 is the `body`
  // region. Local because it changes on every pointer crossing and nothing
  // outside this board has any use for it.
  const [hovered, setHovered] = useState<number | null>(null);

  const trimmedBody = body?.trim();
  // The pressable regions, read from the same grid the face is drawn from, so
  // a hit target cannot drift away from the card it belongs to.
  const regions: Array<{ key: number; rect: BoardFaceRect; card: BoardCard | null }> = !onPress
    ? []
    : trimmedBody
      ? [{ key: -1, rect: boardBodyRect({ width: faceWidth, height: faceHeight, band: label ? LABEL_BAND : 0 }), card: null }]
      : boardCardRects({
          width: faceWidth,
          height: faceHeight,
          band: label ? LABEL_BAND : 0,
          count: resolvedCards.length,
          columns,
        }).map((rect, index) => ({ key: index, rect, card: resolvedCards[index] ?? null }));

  const drawn = useBoardFaceTexture({
    width: faceWidth,
    height: faceHeight,
    color: face,
    label,
    ink,
    band: label ? LABEL_BAND : 0,
    cards: resolvedCards,
    columns,
    cardColor,
    accentColor: SURFACE.accent,
    body,
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

      {/* One quad per written thing on the board, so pressing a constraint
          opens that constraint rather than just the board it is written on.
          They are invisible until hovered, when the card lifts a little out of
          the surface — the only cue that the writing is pressable, since the
          canvas itself carries no cursor affordances of its own. The press is
          stopped here: the board's zone would otherwise follow it with a
          second, item-less selection and undo the focus. */}
      {regions.map(({ key, rect, card }) => (
        <mesh
          key={key}
          position={[
            -faceWidth / 2 + rect.x + rect.width / 2,
            faceHeight / 2 - rect.y - rect.height / 2,
            HIT_LIFT,
          ]}
          renderOrder={3}
          onClick={(event) => {
            event.stopPropagation();
            onPress?.(card);
          }}
          /* Deliberately not stopped: the board's zone owns the pointer
             cursor and the zone highlight, and swallowing the crossing here
             would leave the writing looking unpressable. */
          onPointerOver={() => setHovered(key)}
          onPointerOut={() => setHovered((current) => (current === key ? null : current))}
        >
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicMaterial
            color={SURFACE.accent}
            transparent
            opacity={hovered === key ? 0.16 : 0}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Rough perceptual brightness of a `#rrggbb` colour, 0 to 1. */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
