"use client";

import type { ReactNode } from "react";

/**
 * Temporary procedural props used while the product UX is being rebuilt.
 *
 * These are intentionally simple. They keep the current scene functional
 * without committing a generic low-poly office asset pack. The new meeting
 * scene should wrap final Blender-authored GLB assets behind the same kind of
 * semantic component boundaries.
 */

export type ProceduralPropName =
  | "desk"
  | "chair"
  | "wheelchair"
  | "meeting-table"
  | "whiteboard"
  | "monitor"
  | "plant"
  | "door";

function Material({ color, roughness = 0.78 }: { color: string; roughness?: number }) {
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0.02} />;
}

function Desk({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  const top = colors[0] ?? "#d8d1c8";
  const frame = colors[1] ?? "#343434";
  return (
    <group>
      <mesh position={[0, 0.72, 0]}>
        <boxGeometry args={[1.5, 0.1, 0.72]} />
        <Material color={top} roughness={roughness} />
      </mesh>
      {[-0.58, 0.58].flatMap((x) =>
        [-0.23, 0.23].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, 0.35, z]}>
            <boxGeometry args={[0.08, 0.7, 0.08]} />
            <Material color={frame} roughness={0.68} />
          </mesh>
        )),
      )}
    </group>
  );
}

function Chair({
  colors,
  roughness,
  wheelchair = false,
}: {
  colors: readonly string[];
  roughness: number;
  wheelchair?: boolean;
}) {
  const seat = colors[0] ?? "#777777";
  const frame = colors[1] ?? "#303030";
  return (
    <group>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.62, 0.12, 0.62]} />
        <Material color={seat} roughness={roughness} />
      </mesh>
      <mesh position={[0, 0.82, -0.27]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[0.62, 0.65, 0.1]} />
        <Material color={seat} roughness={roughness} />
      </mesh>
      {wheelchair ? (
        <>
          {[-0.37, 0.37].map((x) => (
            <mesh key={x} position={[x, 0.36, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.34, 0.045, 10, 32]} />
              <Material color={frame} roughness={0.55} />
            </mesh>
          ))}
        </>
      ) : (
        <>
          {[-0.23, 0.23].flatMap((x) =>
            [-0.2, 0.2].map((z) => (
              <mesh key={`${x}:${z}`} position={[x, 0.22, z]}>
                <cylinderGeometry args={[0.025, 0.025, 0.44, 8]} />
                <Material color={frame} roughness={0.6} />
              </mesh>
            )),
          )}
        </>
      )}
    </group>
  );
}

function MeetingTable({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  const top = colors[0] ?? "#d6c6ae";
  const base = colors[1] ?? "#3a342f";
  return (
    <group>
      <mesh position={[0, 0.72, 0]}>
        <boxGeometry args={[2.2, 0.12, 1.15]} />
        <Material color={top} roughness={roughness} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, 0.35, 0]}>
          <boxGeometry args={[0.2, 0.7, 0.55]} />
          <Material color={base} roughness={0.66} />
        </mesh>
      ))}
    </group>
  );
}

function Whiteboard({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  const panel = colors[0] ?? "#f5f3ee";
  const frame = colors[1] ?? "#333333";
  return (
    <group>
      <mesh position={[0, 0.96, 0]}>
        <boxGeometry args={[1.65, 1.5, 0.06]} />
        <Material color={frame} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.96, 0.035]}>
        <boxGeometry args={[1.5, 1.35, 0.03]} />
        <Material color={panel} roughness={roughness} />
      </mesh>
    </group>
  );
}

function Monitor({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  const screen = colors[0] ?? "#1e2328";
  const stand = colors[1] ?? "#555555";
  return (
    <group>
      <mesh position={[0, 0.38, 0]}>
        <boxGeometry args={[0.75, 0.45, 0.06]} />
        <Material color={screen} roughness={roughness} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <boxGeometry args={[0.08, 0.28, 0.08]} />
        <Material color={stand} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.025, 0]}>
        <boxGeometry args={[0.34, 0.05, 0.22]} />
        <Material color={stand} roughness={0.6} />
      </mesh>
    </group>
  );
}

function Plant({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  const leaf = colors[0] ?? "#607c57";
  const pot = colors[1] ?? "#4b4038";
  return (
    <group>
      <mesh position={[0, 0.22, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.44, 16]} />
        <Material color={pot} roughness={roughness} />
      </mesh>
      {[0, 0.5, 1, 1.5, 2].map((angle, index) => (
        <mesh
          key={angle}
          position={[Math.cos(angle) * 0.16, 0.65 + (index % 2) * 0.12, Math.sin(angle) * 0.16]}
          rotation={[0.2, -angle, 0.55]}
        >
          <sphereGeometry args={[0.17, 10, 8]} />
          <Material color={leaf} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Door({ colors, roughness }: { colors: readonly string[]; roughness: number }) {
  return (
    <mesh position={[0, 1.1, 0]}>
      <boxGeometry args={[0.92, 2.2, 0.08]} />
      <Material color={colors[0] ?? "#5a5048"} roughness={roughness} />
    </mesh>
  );
}

export function ProceduralProp({
  name,
  colors,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  roughness = 0.78,
}: {
  name: ProceduralPropName;
  colors: readonly string[];
  position?: [number, number, number];
  rotationY?: number;
  scale?: number | [number, number, number];
  roughness?: number;
}) {
  let body: ReactNode = null;

  switch (name) {
    case "desk":
      body = <Desk colors={colors} roughness={roughness} />;
      break;
    case "chair":
      body = <Chair colors={colors} roughness={roughness} />;
      break;
    case "wheelchair":
      body = <Chair colors={colors} roughness={roughness} wheelchair />;
      break;
    case "meeting-table":
      body = <MeetingTable colors={colors} roughness={roughness} />;
      break;
    case "whiteboard":
      body = <Whiteboard colors={colors} roughness={roughness} />;
      break;
    case "monitor":
      body = <Monitor colors={colors} roughness={roughness} />;
      break;
    case "plant":
      body = <Plant colors={colors} roughness={roughness} />;
      break;
    case "door":
      body = <Door colors={colors} roughness={roughness} />;
      break;
  }

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      {body}
    </group>
  );
}
