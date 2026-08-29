"use client";

import { SURFACE } from "./meeting-room-layout";

/**
 * A wall-mounted surface: slim dark frame, inset face, optional card grid.
 *
 * Transcribed from the imported design's `board()` factory. The card count
 * and the accent card are driven by real room state (constraint count, open
 * issue count, and so on) rather than fixed numbers, so the room's geometry
 * says something true about the decision without any text baked into it.
 */
export function Board({
  width,
  height,
  face = SURFACE.boardLight,
  cardCount = 0,
  columns = 4,
  cardColor = SURFACE.card,
  accentIndex = -1,
  active = false,
}: {
  width: number;
  height: number;
  face?: string;
  cardCount?: number;
  columns?: number;
  cardColor?: string;
  accentIndex?: number;
  /** True when this is the workspace currently in camera focus. */
  active?: boolean;
}) {
  const rows = cardCount > 0 ? Math.ceil(cardCount / columns) : 0;
  const cardWidth = width / columns - 0.16;
  const cardHeight = rows > 0 ? height / rows - 0.16 : 0;

  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[width, height, 0.08]} />
        <meshStandardMaterial color={SURFACE.frame} roughness={0.6} metalness={0.02} />
      </mesh>
      <mesh position={[0, 0, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.16, height - 0.16, 0.06]} />
        <meshStandardMaterial color={face} roughness={0.92} metalness={0.02} />
      </mesh>

      {Array.from({ length: cardCount }, (_unused, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = -width / 2 + 0.3 + cardWidth / 2 + col * (cardWidth + 0.16);
        const y = height / 2 - 0.3 - cardHeight / 2 - row * (cardHeight + 0.16);
        const color = active && index === accentIndex ? SURFACE.accent : cardColor;

        return (
          <mesh key={index} position={[x, y, 0.1]} castShadow receiveShadow>
            <boxGeometry args={[cardWidth, cardHeight, 0.03]} />
            <meshStandardMaterial color={color} roughness={0.9} metalness={0.02} />
          </mesh>
        );
      })}
    </group>
  );
}
