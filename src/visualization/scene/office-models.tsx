"use client";

import { Suspense, useMemo, type ReactNode } from "react";
import {
  Box3,
  BufferGeometry,
  Matrix4,
  Mesh,
  Vector3,
  type Object3D,
} from "three";
import { useLoader } from "@react-three/fiber";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ModelErrorBoundary } from "./model-error-boundary";

/**
 * Low-poly office props.
 *
 * The source packs ship OBJ geometry with unusable MTL sidecars (fully
 * transparent materials and absolute Windows texture paths), so geometry is
 * loaded on its own and the scene supplies its own palette. Every model is
 * normalized to a known height and seated on the floor, which keeps placement
 * in `office-layout.ts` free of per-asset magic numbers.
 */

export type OfficeModelName =
  | "desk"
  | "chair"
  | "wheelchair"
  | "meeting-table"
  | "whiteboard"
  | "monitor"
  | "plant"
  | "door";

const MODEL_URL: Record<OfficeModelName, string> = {
  desk: "/models/office/desk.obj",
  chair: "/models/office/chair.obj",
  wheelchair: "/models/office/wheelchair.obj",
  "meeting-table": "/models/office/meeting-table.obj",
  whiteboard: "/models/office/whiteboard.obj",
  monitor: "/models/office/monitor.obj",
  plant: "/models/office/plant.obj",
  door: "/models/office/door.obj",
};

/** Target height in scene units, so props read at a consistent scale. */
const MODEL_HEIGHT: Record<OfficeModelName, number> = {
  desk: 0.78,
  chair: 1.05,
  wheelchair: 1.05,
  "meeting-table": 0.78,
  whiteboard: 1.9,
  monitor: 0.5,
  plant: 1.25,
  door: 2.2,
};

const normalizedCache = new Map<string, BufferGeometry[]>();

/**
 * Flattens an OBJ hierarchy into world-space geometries, centred on X/Z and
 * resting on Y = 0 at the requested height.
 */
function normalize(root: Object3D, targetHeight: number): BufferGeometry[] {
  root.updateMatrixWorld(true);

  const geometries: BufferGeometry[] = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = (child.geometry as BufferGeometry).clone();
    geometry.applyMatrix4(child.matrixWorld);
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    geometries.push(geometry);
  });

  if (geometries.length === 0) return geometries;

  const bounds = new Box3();
  for (const geometry of geometries) {
    geometry.computeBoundingBox();
    if (geometry.boundingBox) bounds.union(geometry.boundingBox);
  }

  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const scale = size.y > 0 ? targetHeight / size.y : 1;

  const transform = new Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(
      new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z),
    );

  for (const geometry of geometries) {
    geometry.applyMatrix4(transform);
    geometry.computeBoundingSphere();
  }

  return geometries;
}

/** Geometry is shared across every instance of a model; only colour varies. */
function useOfficeModel(name: OfficeModelName): BufferGeometry[] {
  const loaded = useLoader(OBJLoader, MODEL_URL[name]);

  return useMemo(() => {
    const cached = normalizedCache.get(name);
    if (cached) return cached;
    const geometries = normalize(loaded, MODEL_HEIGHT[name]);
    normalizedCache.set(name, geometries);
    return geometries;
  }, [loaded, name]);
}

function ModelMeshes({
  name,
  colors,
  roughness,
}: {
  name: OfficeModelName;
  colors: readonly string[];
  roughness: number;
}) {
  const geometries = useOfficeModel(name);

  return (
    <>
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshStandardMaterial
            color={colors[index % colors.length] ?? "#94a3b8"}
            roughness={roughness}
            metalness={0.04}
          />
        </mesh>
      ))}
    </>
  );
}

/**
 * A prop, with a procedural stand-in while it loads or if it fails.
 *
 * The DOM interface carries the full semantics, so a missing asset degrades
 * the picture and nothing else.
 */
export function OfficeModel({
  name,
  colors,
  position = [0, 0, 0],
  rotationY = 0,
  scale = 1,
  roughness = 0.78,
  fallback,
}: {
  name: OfficeModelName;
  colors: readonly string[];
  position?: [number, number, number];
  rotationY?: number;
  /** A tuple stretches footprint without changing the normalized height. */
  scale?: number | [number, number, number];
  roughness?: number;
  fallback?: ReactNode;
}) {
  const placeholder = fallback ?? (
    <mesh position={[0, MODEL_HEIGHT[name] / 2, 0]}>
      <boxGeometry args={[0.8, MODEL_HEIGHT[name], 0.8]} />
      <meshStandardMaterial color={colors[0] ?? "#94a3b8"} roughness={0.9} />
    </mesh>
  );

  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={scale}>
      <ModelErrorBoundary fallback={placeholder}>
        <Suspense fallback={placeholder}>
          <ModelMeshes name={name} colors={colors} roughness={roughness} />
        </Suspense>
      </ModelErrorBoundary>
    </group>
  );
}
