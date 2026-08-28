"use client";

import { Html } from "@react-three/drei";
import type { ReactNode } from "react";

/**
 * Text inside the scene.
 *
 * Rendered as a DOM overlay rather than 3D type: it stays crisp, needs no font
 * asset, and is hidden from assistive technology because the surrounding
 * panels already carry the same information in semantic markup.
 */
export function SceneLabel({
  position,
  variant = "default",
  distanceFactor = 14,
  children,
}: {
  position: [number, number, number];
  variant?: "default" | "zone" | "office" | "muted" | "alert" | "focus";
  distanceFactor?: number;
  children: ReactNode;
}) {
  return (
    <Html
      position={position}
      center
      distanceFactor={distanceFactor}
      zIndexRange={[10, 0]}
      wrapperClass="scene-label-wrapper"
      pointerEvents="none"
    >
      <span className={`scene-label scene-label-${variant}`} aria-hidden="true">
        {children}
      </span>
    </Html>
  );
}
