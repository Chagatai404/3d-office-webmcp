"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

/**
 * Surface texture for the room, drawn at runtime.
 *
 * Every large surface here used to be one flat colour, which is what made the
 * room read as washed out however carefully the palette was chosen: a real
 * floor is not one value, and neither is plaster or a table top. These are
 * canvas textures rather than image files on purpose — they weigh nothing,
 * they take their colour from `SURFACE` so the palette stays the single source
 * of truth, and they keep the promise that no third-party asset ships here.
 *
 * Everything is generated once and memoised per colour. Canvas work is
 * client-only; each helper returns `null` where there is no `document`, and a
 * material with a null map simply falls back to its flat colour.
 */

/**
 * One texture per distinct look, however many meshes ask for it.
 *
 * The credenza run renders once per board and the wood is the same wood every
 * time; without this each of the five would carry its own 512px canvas to the
 * GPU. Keyed by everything that changes the pixels.
 */
const cache = new Map<string, CanvasTexture>();

function shared(key: string, draw: () => HTMLCanvasElement | null, repeat: number) {
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = draw();
  if (!canvas) return null;
  const texture = finish(canvas, repeat);
  cache.set(key, texture);
  return texture;
}

const canvasOf = (width: number, height: number) => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

function finish(canvas: HTMLCanvasElement, repeat: number) {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Fine speckle, for floor and plaster.
 *
 * Dots that cross an edge are drawn again on the opposite side, so the tile
 * repeats without a seam running through the room.
 */
function speckle(base: string, dark: string, light: string, density: number, dot: number) {
  const size = 256;
  const canvas = canvasOf(size, size);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  let seed = 20260830;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let i = 0; i < density; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = dot * (0.4 + random() * 0.9);
    ctx.fillStyle = random() > 0.5 ? dark : light;
    ctx.globalAlpha = 0.05 + random() * 0.16;
    for (const offsetX of [-size, 0, size]) {
      for (const offsetY of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + offsetX, y + offsetY, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  return canvas;
}

/**
 * Wood grain: streaks that run the full width of the tile.
 *
 * Full-width strokes mean the tile already repeats cleanly along the grain,
 * which is the direction a table top and a run of cabinet doors both read in.
 */
function grain(base: string, dark: string, light: string) {
  const size = 512;
  const canvas = canvasOf(size, size);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  let seed = 987654321;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let i = 0; i < 190; i += 1) {
    const y = random() * size;
    const thickness = 0.6 + random() * 2.6;
    const wobble = 3 + random() * 9;
    ctx.strokeStyle = random() > 0.42 ? dark : light;
    // Kept light on purpose: at full strength the grain multiplied the base
    // down into a saturated walnut, where the room wants pale oak.
    ctx.globalAlpha = 0.03 + random() * 0.075;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 32) {
      ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * wobble);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

export function useFloorTexture(base: string, repeat = 26) {
  return useMemo(
    () => shared(`floor:${base}:${repeat}`, () => speckle(base, "#6d675d", "#ffffff", 2600, 1.5), repeat),
    [base, repeat],
  );
}

export function useWallTexture(base: string, repeat = 9) {
  return useMemo(
    () => shared(`wall:${base}:${repeat}`, () => speckle(base, "#7c766c", "#ffffff", 900, 3.4), repeat),
    [base, repeat],
  );
}

export function useWoodTexture(base: string, repeat = 1) {
  return useMemo(
    () => shared(`wood:${base}:${repeat}`, () => grain(base, "#ac8552", "#fdf1de"), repeat),
    [base, repeat],
  );
}

/**
 * A board's whole face, drawn as one image.
 *
 * The name and the cards used to be separate meshes standing in front of the
 * board — a 30mm slab per card, floating 5mm off a panel that itself stood
 * 40mm proud of its frame. Close up they read as tiles propped against the
 * board rather than anything written on it. Drawing them into the surface the
 * board is made of means there is nothing to stand off it: what you see is
 * the board.
 *
 * The layout is done in metres and converted to pixels at the end, so a card
 * is the same size on a 7.4m wall panel as on a 4.6m one, and the grid keeps
 * equal margins whatever the count. Nothing here invents content: the cards
 * are blocks whose number is the real count, and the only text is the
 * workspace's own name.
 */
export interface BoardFaceSpec {
  /** The face's size in metres — the panel inside the frame, not the board. */
  width: number;
  height: number;
  color: string;
  /** Explicitly optional: the caller passes `undefined` for an unnamed board. */
  label?: string | undefined;
  ink: string;
  /** Height reserved for the name across the top, in metres. */
  band: number;
  cardCount: number;
  columns: number;
  cardColor: string;
  accentColor: string;
  /** Which card is highlighted, or -1. */
  accentIndex: number;
}

const FACE_MARGIN = 0.22;
const FACE_GUTTER = 0.16;
/** Long side of the drawn face. Enough that the name stays crisp at the
 *  board's own camera pose without a 2048px canvas per board. */
const FACE_RESOLUTION = 1536;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function useBoardFaceTexture(spec: BoardFaceSpec): CanvasTexture | null {
  const {
    width,
    height,
    color,
    label,
    ink,
    band,
    cardCount,
    columns,
    cardColor,
    accentColor,
    accentIndex,
  } = spec;

  const texture = useMemo(() => {
    const landscape = width >= height;
    const pixelsPerMetre = FACE_RESOLUTION / (landscape ? width : height);
    const canvas = canvasOf(
      Math.round(width * pixelsPerMetre),
      Math.round(height * pixelsPerMetre),
    );
    if (!canvas) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const px = (metres: number) => metres * pixelsPerMetre;

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (label) {
      const size = px(0.3);
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif`;
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = `${size * 0.16}px`;
      ctx.fillText(label.toUpperCase(), canvas.width / 2, px(band / 2));
      ctx.letterSpacing = "0px";

      // A hairline under the name, the way a real board has a header rule.
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = Math.max(1, px(0.008));
      ctx.beginPath();
      ctx.moveTo(px(FACE_MARGIN), px(band));
      ctx.lineTo(canvas.width - px(FACE_MARGIN), px(band));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (cardCount > 0) {
      const rows = Math.ceil(cardCount / columns);
      const cardWidth =
        (width - 2 * FACE_MARGIN - (columns - 1) * FACE_GUTTER) / columns;
      const cardHeight =
        (height - band - 2 * FACE_MARGIN - (rows - 1) * FACE_GUTTER) / rows;
      if (cardWidth > 0 && cardHeight > 0) {
        for (let index = 0; index < cardCount; index += 1) {
          const column = index % columns;
          const row = Math.floor(index / columns);
          const x = FACE_MARGIN + column * (cardWidth + FACE_GUTTER);
          const y = band + FACE_MARGIN + row * (cardHeight + FACE_GUTTER);

          ctx.fillStyle = index === accentIndex ? accentColor : cardColor;
          roundedRect(ctx, px(x), px(y), px(cardWidth), px(cardHeight), px(0.04));
          ctx.fill();

          // The edge a written block has against the surface under it.
          ctx.strokeStyle = ink;
          ctx.globalAlpha = 0.1;
          ctx.lineWidth = Math.max(1, px(0.006));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    const drawn = new CanvasTexture(canvas);
    drawn.colorSpace = SRGBColorSpace;
    drawn.anisotropy = 8;
    return drawn;
  }, [width, height, color, label, ink, band, cardCount, columns, cardColor, accentColor, accentIndex]);

  // The face is redrawn whenever the room's counts change, so the texture it
  // replaces has to go back to the GPU rather than accumulate there.
  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}
