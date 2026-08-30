"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { Mesh } from "three";

/**
 * The room's authored props.
 *
 * These are the only meshes in the room that are not procedural. Each one is
 * built by `scripts/assets/convert.py` from a single source model, stripped of
 * its original materials and re-shaded from `SURFACE`, so a prop contributes
 * silhouette — the thing primitives cannot fake — and never its own palette.
 * The sources are not part of the repository; the `.glb` files under
 * `public/models/meeting-room/` are the committed artefact.
 *
 * Nothing here reads room state. A prop is furniture: it says a meeting
 * happens in a real place, and it never stands for a constraint, a proposal,
 * a vote, or a decision. Only the boards, the plinth and the pedestal do that.
 */

const MODELS = {
  chair: "/models/meeting-room/office-chair.glb",
  rug: "/models/meeting-room/rug-round.glb",
  plant: "/models/meeting-room/plant.glb",
  mug: "/models/meeting-room/mug.glb",
  notebook: "/models/meeting-room/notebook.glb",
  bookshelf: "/models/meeting-room/bookshelf.glb",
  bookStack: "/models/meeting-room/book-stack.glb",
  boxes: "/models/meeting-room/cardboard-boxes.glb",
  cabinet: "/models/meeting-room/file-cabinet.glb",
  printer: "/models/meeting-room/printer.glb",
  soda: "/models/meeting-room/soda-can.glb",
  pens: "/models/meeting-room/pens.glb",
  phone: "/models/meeting-room/phone.glb",
} as const;

type PropId = keyof typeof MODELS;

export interface PlacedProp {
  position: [number, number, number];
  rotation?: [number, number, number];
}

/**
 * A prop, ready to place.
 *
 * Every model is cloned per instance because a `THREE.Object3D` can only sit
 * at one point in one scene graph, and the room seats up to eight of the same
 * chair. The clone is shallow where it matters: geometry and materials stay
 * shared with the cached original, so eight chairs cost eight transforms
 * rather than eight uploads.
 */
function useProp(id: PropId, cast: boolean, receive: boolean) {
  const { scene } = useGLTF(MODELS[id]);
  return useMemo(() => {
    const model = scene.clone(true);
    model.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
      }
    });
    return model;
  }, [scene, cast, receive]);
}

/** A task chair. Unrotated it faces +Z, the way seats and avatars do. */
export function OfficeChair({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("chair", true, true)} position={position} rotation={rotation} />;
}

/**
 * The round rug under the table.
 *
 * It replaces a flat inlay disc, so it is the one prop that only receives
 * shadow: casting from a 30mm slab lying on the floor buys nothing but
 * shadow-map noise along its own rim.
 */
export function RugRound({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("rug", false, true)} position={position} rotation={rotation} />;
}

export function Plant({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("plant", true, false)} position={position} rotation={rotation} />;
}

export function Mug({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("mug", true, false)} position={position} rotation={rotation} />;
}

export function Notebook({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("notebook", true, false)} position={position} rotation={rotation} />;
}

/**
 * The room's edges: storage, not workspaces.
 *
 * Everything below stands against a wall or on the table and reports nothing.
 * A meeting room that holds only the furniture a meeting strictly needs reads
 * as a showroom; the shelf, the boxes waiting to be unpacked and the odd can
 * left on the table are what make it somewhere people actually work. Like
 * every prop here they front onto +Z unrotated.
 */
export function Bookshelf({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("bookshelf", true, true)} position={position} rotation={rotation} />;
}

/**
 * A cluster of books for a shelf. Placed a few to a run with gaps between
 * them, so the shelf reads as one somebody actually takes books off rather
 * than a full set bought by the metre.
 */
export function BookStack({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("bookStack", true, false)} position={position} rotation={rotation} />;
}

export function CardboardBoxes({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("boxes", true, true)} position={position} rotation={rotation} />;
}

export function FileCabinet({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("cabinet", true, true)} position={position} rotation={rotation} />;
}

export function Printer({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("printer", true, false)} position={position} rotation={rotation} />;
}

export function SodaCan({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("soda", true, false)} position={position} rotation={rotation} />;
}

export function Pens({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("pens", true, false)} position={position} rotation={rotation} />;
}

export function Phone({ position, rotation }: PlacedProp) {
  return <primitive object={useProp("phone", true, false)} position={position} rotation={rotation} />;
}

// Fetched as soon as the scene module is imported, so the room is not
// assembled twice: the procedural shell would otherwise draw first and the
// furniture pop in behind it a frame later.
for (const url of Object.values(MODELS)) {
  useGLTF.preload(url);
}
