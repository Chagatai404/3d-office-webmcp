"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { SURFACE } from "./meeting-room-layout";

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
 * The name and the cards are drawn into the surface the board is made of, so
 * there is nothing to stand off it: what you see is the board. Each card now
 * carries the concise real text the matching workspace panel shows — the panel
 * stays the accessible source of truth (the canvas is `aria-hidden`), and the
 * board is its echo on the wall, the way a real meeting room's whiteboard is.
 *
 * The layout is done in metres and converted to pixels at the end, so a card
 * is the same size on a 7.4m wall panel as on a 4.6m one, and the grid keeps
 * equal margins whatever the count.
 */
export type BoardCardTone = "default" | "accent" | "attention" | "quiet";

export interface BoardCard {
  /**
   * The room item this card echoes — a constraint, proposal or conflict id.
   * Drawn nowhere: it exists so pressing the card can say *which* item was
   * pressed. Cards with nothing behind them (the "+N more" tail, the
   * whiteboard's blanks) leave it undefined and open the workspace unfocused.
   */
  id?: string | undefined;
  /** The line(s) of text drawn in the card; wrapped and clamped to fit. */
  text: string;
  /** Optional category drawn small above the text. */
  label?: string | undefined;
  tone?: BoardCardTone | undefined;
}

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
  /** Concise real text, one card per item, laid out in a grid. */
  cards: BoardCard[];
  columns: number;
  cardColor: string;
  accentColor: string;
  /** A flowing paragraph drawn below the name band instead of cards (Brief). */
  body?: string | undefined;
  /** How many further items the grid does not show — drawn as one "+N more" line. */
  more?: number | undefined;
}

const FACE_MARGIN = 0.22;
const FACE_GUTTER = 0.16;
/** Gap between the name band's rule and the first line of a `body` paragraph. */
const FACE_BODY_TOP_GAP = 0.28;
/** Height reserved below the card grid for the "+N more" line, when there is one. */
export const FACE_MORE_FOOTER = 0.3;
/** Long side of the drawn face. Enough that the name stays crisp at the
 *  board's own camera pose without a 2048px canvas per board. */
const FACE_RESOLUTION = 1536;

const FACE_FONT = 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif';

/**
 * A rectangle on the face, in metres, measured from its top-left corner.
 *
 * The same frame the drawing code works in. `Board` converts these into
 * meshes so the pressable area of a card is the card, by construction: there
 * is one grid, and both the pixels and the hit targets are laid out from it.
 */
export interface BoardFaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where each card sits on a face — the grid, solved once.
 *
 * Returns an empty list when the cards cannot fit (no columns, or a band and
 * margins that leave no height), which is the same condition the drawing code
 * treats as "draw nothing".
 */
export function boardCardRects({
  width,
  height,
  band,
  count,
  columns,
  footer = 0,
}: {
  width: number;
  height: number;
  band: number;
  count: number;
  columns: number;
  /** Height held clear below the grid (the "+N more" line lives there). */
  footer?: number;
}): BoardFaceRect[] {
  if (count <= 0 || columns <= 0) return [];

  const rows = Math.ceil(count / columns);
  const cardWidth = (width - 2 * FACE_MARGIN - (columns - 1) * FACE_GUTTER) / columns;
  const cardHeight =
    (height - band - 2 * FACE_MARGIN - footer - (rows - 1) * FACE_GUTTER) / rows;
  if (cardWidth <= 0 || cardHeight <= 0) return [];

  return Array.from({ length: count }, (_, index) => ({
    x: FACE_MARGIN + (index % columns) * (cardWidth + FACE_GUTTER),
    y: band + FACE_MARGIN + Math.floor(index / columns) * (cardHeight + FACE_GUTTER),
    width: cardWidth,
    height: cardHeight,
  }));
}

/** Where a `body` paragraph sits on a face — the Brief board's one region. */
export function boardBodyRect({
  width,
  height,
  band,
}: {
  width: number;
  height: number;
  band: number;
}): BoardFaceRect {
  const y = band + FACE_BODY_TOP_GAP;
  return {
    x: FACE_MARGIN,
    y,
    width: Math.max(0, width - FACE_MARGIN * 2),
    height: Math.max(0, height - y - FACE_MARGIN),
  };
}

/** Fill colour for a card of the given tone. */
function toneFill(tone: BoardCardTone | undefined, cardColor: string, accentColor: string): string {
  switch (tone) {
    case "accent":
      return accentColor;
    case "attention":
      // A high-priority / blocked card is flagged with a left edge bar, not a
      // full fill: a Constraints board where half the items are "high" was a
      // wall of loud orange rectangles and read as a warning, not a list.
      return cardColor;
    case "quiet":
      return SURFACE.quiet;
    default:
      return cardColor;
  }
}

/** Greedy word-wrap into lines that fit `maxWidth` at the context's font. */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Clamp to `maxLines`, marking the last kept line with an ellipsis. */
function clampLines(lines: string[], maxLines: number): string[] {
  if (maxLines <= 0) return [];
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept.length - 1;
  kept[last] = `${(kept[last] ?? "").replace(/[\s.,;:]+$/, "")}…`;
  return kept;
}

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
    cards,
    columns,
    cardColor,
    accentColor,
    body,
    more,
  } = spec;

  // `cards` is rebuilt every render by the scene, so the redraw keys off the
  // serialised spec rather than array identity: same text, same texture.
  const signature = JSON.stringify({
    width,
    height,
    color,
    label,
    ink,
    band,
    columns,
    cardColor,
    accentColor,
    body,
    more,
    cards,
  });

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
      const size = px(0.24);
      ctx.font = `600 ${size}px ${FACE_FONT}`;
      ctx.fillStyle = ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = `${size * 0.1}px`;
      ctx.fillText(label.toUpperCase(), canvas.width / 2, px(band / 2));
      ctx.letterSpacing = "0px";

      // A hairline under the name, the way a real board has a header rule.
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = Math.max(1, px(0.006));
      ctx.beginPath();
      ctx.moveTo(px(FACE_MARGIN), px(band));
      ctx.lineTo(canvas.width - px(FACE_MARGIN), px(band));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const trimmedBody = body?.trim();

    if (trimmedBody) {
      const size = px(0.18);
      const lineHeight = size * 1.4;
      const top = px(band) + px(FACE_BODY_TOP_GAP);
      const innerWidth = canvas.width - px(FACE_MARGIN) * 2;
      const maxLines = Math.max(
        1,
        Math.floor((canvas.height - top - px(FACE_MARGIN)) / lineHeight),
      );
      ctx.font = `400 ${size}px ${FACE_FONT}`;
      ctx.fillStyle = ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      clampLines(wrapLines(ctx, trimmedBody, innerWidth), maxLines).forEach(
        (line, index) => ctx.fillText(line, px(FACE_MARGIN), top + index * lineHeight),
      );
    } else if (cards.length > 0) {
      const overflow = more && more > 0 ? more : 0;
      const footer = overflow ? FACE_MORE_FOOTER : 0;
      const rects = boardCardRects({
        width,
        height,
        band,
        count: cards.length,
        columns,
        footer,
      });
      if (rects.length > 0) {
        const pad = px(0.12);
        const labelSize = px(0.105);
        const textSize = px(0.14);
        const textLine = textSize * 1.28;
        const radius = px(0.04);

        cards.forEach((card, index) => {
          const rect = rects[index];
          if (!rect) return;
          const { x, y, width: cardWidth, height: cardHeight } = rect;

          // A crisp note lifted off the surface: a soft shadow and a near-white
          // fill, so the card reads as laid on the board rather than as a faint
          // patch the same value as the board behind it.
          ctx.save();
          ctx.shadowColor = "rgba(46, 43, 39, 0.16)";
          ctx.shadowBlur = px(0.055);
          ctx.shadowOffsetY = px(0.018);
          ctx.fillStyle = toneFill(card.tone, cardColor, accentColor);
          roundedRect(ctx, px(x), px(y), px(cardWidth), px(cardHeight), radius);
          ctx.fill();
          ctx.restore();

          // A hairline settling the card onto the surface (the accent card is a
          // bold fill and needs none).
          if (card.tone !== "accent") {
            ctx.strokeStyle = ink;
            ctx.globalAlpha = 0.12;
            ctx.lineWidth = Math.max(1, px(0.005));
            roundedRect(ctx, px(x), px(y), px(cardWidth), px(cardHeight), radius);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

          // A restrained left-edge flag, clipped to the card's own corners, in
          // place of flooding the whole card. Enough to pick the urgent items
          // out of the grid at a glance without the board shouting.
          if (card.tone === "attention") {
            ctx.save();
            roundedRect(ctx, px(x), px(y), px(cardWidth), px(cardHeight), radius);
            ctx.clip();
            ctx.fillStyle = SURFACE.attention;
            ctx.fillRect(px(x), px(y), px(0.05), px(cardHeight));
            ctx.restore();
          }

          // The text is drawn dark: every card tone here is a light fill.
          const innerX = px(x) + pad;
          const innerWidth = px(cardWidth) - pad * 2;
          const bottom = px(y) + px(cardHeight) - pad;
          let cursorY = px(y) + pad;
          ctx.fillStyle = SURFACE.frame;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";

          if (card.label) {
            ctx.font = `600 ${labelSize}px ${FACE_FONT}`;
            ctx.globalAlpha = 0.5;
            ctx.letterSpacing = `${labelSize * 0.06}px`;
            ctx.fillText(
              card.label.toUpperCase().slice(0, 34),
              innerX,
              cursorY,
            );
            ctx.letterSpacing = "0px";
            ctx.globalAlpha = 1;
            cursorY += labelSize * 1.55;
          }

          ctx.font = `500 ${textSize}px ${FACE_FONT}`;
          const maxLines = Math.max(1, Math.floor((bottom - cursorY) / textLine));
          clampLines(wrapLines(ctx, card.text, innerWidth), maxLines).forEach(
            (line, lineIndex) =>
              ctx.fillText(line, innerX, cursorY + lineIndex * textLine),
          );
        });
      }

      // The rest of the list, as one quiet line under the grid — a pointer to
      // the workspace, never a card competing with the real ones.
      if (overflow) {
        const size = px(0.135);
        ctx.font = `500 ${size}px ${FACE_FONT}`;
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.5;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(
          `+${overflow} more`,
          px(FACE_MARGIN),
          px(height - FACE_MARGIN - FACE_MORE_FOOTER / 2),
        );
        ctx.globalAlpha = 1;
      }
    } else {
      const size = px(0.15);
      ctx.font = `400 ${size}px ${FACE_FONT}`;
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.4;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        "Nothing here yet",
        canvas.width / 2,
        (px(band) + canvas.height) / 2,
      );
      ctx.globalAlpha = 1;
    }

    const drawn = new CanvasTexture(canvas);
    drawn.colorSpace = SRGBColorSpace;
    drawn.anisotropy = 8;
    return drawn;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the serialised spec; redrawing on it and nothing else is intentional.
  }, [signature]);

  // The face is redrawn whenever the room's text changes, so the texture it
  // replaces has to go back to the GPU rather than accumulate there.
  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}
