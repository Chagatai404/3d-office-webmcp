"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Edges } from "@react-three/drei";
import type { SceneZoneId } from "./scene-focus";

/**
 * Makes the office clickable.
 *
 * The scene reports which place the pointer is on and which place was picked.
 * It never decides what that means: the shell above translates a zone into a
 * camera move and an open window. Nothing here reads or writes room state, and
 * every zone has a keyboard-reachable equivalent in the dock, so the canvas
 * stays an alternative route rather than the only one.
 */

/** What the shell hands the scene. */
export interface SceneInteraction {
  selectedZone: SceneZoneId | null;
  /** `null` means the viewer clicked empty floor: nothing is selected. */
  onSelect(zone: SceneZoneId | null): void;
  onHover(zone: SceneZoneId | null): void;
  /**
   * One written thing inside a zone was pressed rather than the zone at
   * large: a single constraint card, an objection, the brief's paragraph.
   * `itemId` is `null` where the pressed thing has no room item behind it
   * (a "+N more" tail, a blank whiteboard card) — the zone still opens, just
   * with nothing singled out. Optional so a decorative scene can leave it
   * out and stay inert.
   */
  onOpenItem?: ((zone: SceneZoneId, itemId: string | null) => void) | undefined;
}

/** The same, plus the hover the canvas keeps to itself. */
interface ZoneContext extends SceneInteraction {
  hoveredZone: SceneZoneId | null;
}

const INERT: ZoneContext = {
  selectedZone: null,
  hoveredZone: null,
  onSelect: () => {},
  onHover: () => {},
  onOpenItem: () => {},
};

const SceneInteractionContext = createContext<ZoneContext>(INERT);

/**
 * Hover lives here, inside the canvas, rather than in the shell.
 *
 * Keeping it below `children` means moving the pointer across the office
 * re-renders the zone wrappers and nothing else — the scene itself is not
 * rebuilt on every crossing.
 */
export function SceneInteractionProvider({
  value,
  children,
}: {
  value: SceneInteraction;
  children: ReactNode;
}) {
  const [hoveredZone, setHoveredZone] = useState<SceneZoneId | null>(null);
  const { selectedZone, onSelect, onHover, onOpenItem } = value;

  // A stale pointer cursor would outlive the scene it belonged to.
  useEffect(() => () => {
    document.body.style.cursor = "";
  }, []);

  const zoneValue = useMemo<ZoneContext>(
    () => ({
      selectedZone,
      hoveredZone,
      onSelect,
      onOpenItem,
      onHover: (zone) => {
        // Only places worth visiting take a pointer cursor.
        document.body.style.cursor = zone === null ? "" : "pointer";
        setHoveredZone(zone);
        onHover(zone);
      },
    }),
    [selectedZone, hoveredZone, onSelect, onHover, onOpenItem],
  );

  return (
    <SceneInteractionContext.Provider value={zoneValue}>
      {children}
    </SceneInteractionContext.Provider>
  );
}

export function useSceneInteraction(): ZoneContext {
  return useContext(SceneInteractionContext);
}

export interface ZoneHighlight {
  /** Width and height of the highlight quad, in local zone space. */
  size: [number, number];
  position: [number, number, number];
  /** Defaults to flat on the floor. */
  rotation?: [number, number, number];
}

const FLOOR_ROTATION: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * One pickable place in the office.
 *
 * Hover state is shared rather than local, so moving the pointer between two
 * meshes of the same zone resolves in a single render instead of flickering
 * the highlight off and on.
 */
export function SelectableZone({
  zone,
  highlight,
  children,
}: {
  zone: SceneZoneId;
  highlight: ZoneHighlight;
  children: ReactNode;
}) {
  const { selectedZone, hoveredZone, onSelect, onHover } =
    useSceneInteraction();

  const selected = selectedZone === zone;
  const hovered = hoveredZone === zone;
  const color = selected ? "#6ee7b7" : "#8ec5ff";

  return (
    <group
      onClick={(event) => {
        event.stopPropagation();
        onSelect(zone);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(zone);
      }}
      onPointerOut={() => {
        // Only the zone the pointer actually left may clear the readout.
        if (hoveredZone === zone) onHover(null);
      }}
    >
      {children}

      {selected || hovered ? (
        <mesh
          position={highlight.position}
          rotation={highlight.rotation ?? FLOOR_ROTATION}
          renderOrder={2}
        >
          <planeGeometry args={highlight.size} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.22 : 0.1}
            depthWrite={false}
          />
          <Edges color={color} lineWidth={selected ? 2.5 : 1.5} />
        </mesh>
      ) : null}
    </group>
  );
}
