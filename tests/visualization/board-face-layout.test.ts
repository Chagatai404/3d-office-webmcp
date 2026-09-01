import { describe, expect, it } from "vitest";
import { boardBodyRect, boardCardRects } from "@/visualization/scene/textures";

/**
 * The board's card grid is solved once and used twice: the face is drawn from
 * it, and the pressable quads in front of the face are placed from it. These
 * cover the properties that make a press land on the card the viewer aimed at
 * — if the grid drifts, a constraint opens the constraint next to it.
 */
describe("boardCardRects", () => {
  const face = { width: 4, height: 3, band: 0.5 };

  it("fills its row before starting the next", () => {
    const rects = boardCardRects({ ...face, count: 4, columns: 2 });

    expect(rects).toHaveLength(4);
    expect(rects[0]?.y).toBe(rects[1]?.y);
    expect(rects[2]?.y).toBe(rects[3]?.y);
    expect(rects[0]?.x).toBeLessThan(rects[1]?.x ?? 0);
    expect(rects[0]?.y).toBeLessThan(rects[2]?.y ?? 0);
  });

  it("keeps every card inside the face and clear of the name band", () => {
    for (const [count, columns] of [
      [1, 1],
      [4, 1],
      [5, 2],
      [7, 2],
      [12, 4],
    ] as const) {
      const rects = boardCardRects({ ...face, count, columns });
      expect(rects).toHaveLength(count);

      for (const rect of rects) {
        expect(rect.y).toBeGreaterThanOrEqual(face.band);
        expect(rect.x).toBeGreaterThan(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(face.width + 1e-9);
        expect(rect.y + rect.height).toBeLessThanOrEqual(face.height + 1e-9);
      }
    }
  });

  it("never overlaps two cards, so a press picks exactly one", () => {
    const rects = boardCardRects({ ...face, count: 6, columns: 2 });

    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const one = rects[a];
        const other = rects[b];
        if (!one || !other) throw new Error("missing rect");
        const apart =
          one.x + one.width <= other.x + 1e-9 ||
          other.x + other.width <= one.x + 1e-9 ||
          one.y + one.height <= other.y + 1e-9 ||
          other.y + other.height <= one.y + 1e-9;
        expect(apart).toBe(true);
      }
    }
  });

  it("gives every card the same size whatever the count", () => {
    const rects = boardCardRects({ ...face, count: 5, columns: 2 });
    const first = rects[0];
    if (!first) throw new Error("missing rect");

    for (const rect of rects) {
      expect(rect.width).toBeCloseTo(first.width, 10);
      expect(rect.height).toBeCloseTo(first.height, 10);
    }
  });

  it("holds a footer strip clear below the grid when asked", () => {
    const withoutFooter = boardCardRects({ ...face, count: 4, columns: 2 });
    const withFooter = boardCardRects({ ...face, count: 4, columns: 2, footer: 0.4 });

    // Same grid, shorter cards: the "+N more" line lives in the reserved strip.
    expect(withFooter[0]?.height).toBeLessThan(withoutFooter[0]?.height ?? 0);
    for (const rect of withFooter) {
      expect(rect.y + rect.height).toBeLessThanOrEqual(face.height - 0.4 + 1e-9);
    }
  });

  it("draws and hits nothing where the cards cannot fit", () => {
    expect(boardCardRects({ ...face, count: 0, columns: 2 })).toEqual([]);
    expect(boardCardRects({ ...face, count: 4, columns: 0 })).toEqual([]);
    // A band taller than the board leaves no height to lay cards out in.
    expect(boardCardRects({ width: 4, height: 1, band: 2, count: 2, columns: 2 })).toEqual([]);
  });
});

describe("boardBodyRect", () => {
  it("sits below the name band and inside the face", () => {
    const rect = boardBodyRect({ width: 4, height: 3, band: 0.5 });

    expect(rect.y).toBeGreaterThan(0.5);
    expect(rect.x).toBeGreaterThan(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(4);
    expect(rect.y + rect.height).toBeLessThanOrEqual(3);
  });

  it("collapses rather than inverting when the band leaves no room", () => {
    const rect = boardBodyRect({ width: 4, height: 1, band: 2 });

    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBe(0);
  });
});
