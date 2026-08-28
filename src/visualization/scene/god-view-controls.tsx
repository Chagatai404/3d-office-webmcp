"use client";

import { useEffect, useRef, type ComponentRef } from "react";
import { MapControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { MathUtils, Vector3 } from "three";
import {
  cameraPose,
  cameraPosition,
  PAN_BOUNDS,
  type SceneZoneId,
} from "./scene-focus";

/**
 * The god-view camera rig.
 *
 * Drag to move over the office, right-drag to swing around, wheel to come
 * closer, WASD or the arrow keys to walk the view, Q and E to turn. Picking a
 * place — in the scene or from the dock — flies the camera there, and the
 * first thing the viewer does with the mouse takes control back.
 */

/** World units per second at a typical viewing distance. */
const PAN_SPEED = 20;
const ROTATE_SPEED = 1.1;
const ZOOM_SPEED = 18;
/** Higher converges on a flight faster. */
const FLIGHT_DAMPING = 3.6;

const UP = new Vector3(0, 1, 0);

const PAN_KEYS = new Map<string, [number, number]>([
  ["KeyW", [0, 1]],
  ["ArrowUp", [0, 1]],
  ["KeyS", [0, -1]],
  ["ArrowDown", [0, -1]],
  ["KeyA", [-1, 0]],
  ["ArrowLeft", [-1, 0]],
  ["KeyD", [1, 0]],
  ["ArrowRight", [1, 0]],
]);

const CONTROL_KEYS = new Set([
  ...PAN_KEYS.keys(),
  "KeyQ",
  "KeyE",
  "Equal",
  "NumpadAdd",
  "Minus",
  "NumpadSubtract",
]);

/**
 * Keyboard camera control yields to the windows: while focus is inside one,
 * the keys belong to whatever is focused there.
 */
function keysBelongToTheWorld(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return true;
  if (active.isContentEditable) return false;
  if (active.closest(".os-window")) return false;
  return !["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

export interface CameraFlight {
  zone: SceneZoneId;
  nonce: number;
}

export function GodViewControls({ focus }: { focus: CameraFlight }) {
  const controlsRef = useRef<ComponentRef<typeof MapControls>>(null);
  const pressed = useRef(new Set<string>());
  const flight = useRef<{
    target: Vector3;
    position: Vector3;
    /** Set when the viewer asked for less motion: arrive without the travel. */
    instant: boolean;
  } | null>(null);
  const scratch = useRef({
    forward: new Vector3(),
    right: new Vector3(),
    move: new Vector3(),
    offset: new Vector3(),
  });

  // A new focus request — including a repeat of the current one — starts a
  // flight. The nonce is what makes "take me there again" work.
  useEffect(() => {
    const pose = cameraPose(focus.zone);
    flight.current = {
      target: new Vector3(...pose.target),
      position: new Vector3(...cameraPosition(pose)),
      instant: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    };
  }, [focus.zone, focus.nonce]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!CONTROL_KEYS.has(event.code)) return;
      if (!keysBelongToTheWorld()) return;
      event.preventDefault();
      pressed.current.add(event.code);
      flight.current = null;
    }

    function onKeyUp(event: KeyboardEvent) {
      pressed.current.delete(event.code);
    }

    function clear() {
      pressed.current.clear();
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clear);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clear);
    };
  }, []);

  useFrame((state, rawDelta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const { camera } = state;

    // Long frames must not teleport the camera across the room.
    const delta = Math.min(rawDelta, 0.05);
    const { forward, right, move, offset } = scratch.current;
    const inFlight = flight.current;

    if (inFlight) {
      if (inFlight.instant) {
        camera.position.copy(inFlight.position);
        controls.target.copy(inFlight.target);
        flight.current = null;
        controls.update();
        return;
      }

      camera.position.set(
        MathUtils.damp(camera.position.x, inFlight.position.x, FLIGHT_DAMPING, delta),
        MathUtils.damp(camera.position.y, inFlight.position.y, FLIGHT_DAMPING, delta),
        MathUtils.damp(camera.position.z, inFlight.position.z, FLIGHT_DAMPING, delta),
      );
      controls.target.set(
        MathUtils.damp(controls.target.x, inFlight.target.x, FLIGHT_DAMPING, delta),
        MathUtils.damp(controls.target.y, inFlight.target.y, FLIGHT_DAMPING, delta),
        MathUtils.damp(controls.target.z, inFlight.target.z, FLIGHT_DAMPING, delta),
      );

      if (
        camera.position.distanceTo(inFlight.position) < 0.02 &&
        controls.target.distanceTo(inFlight.target) < 0.02
      ) {
        camera.position.copy(inFlight.position);
        controls.target.copy(inFlight.target);
        flight.current = null;
      }

      controls.update();
      return;
    }

    if (pressed.current.size > 0) {
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, UP).normalize();

      let sideways = 0;
      let ahead = 0;
      for (const code of pressed.current) {
        const pan = PAN_KEYS.get(code);
        if (pan) {
          sideways += pan[0];
          ahead += pan[1];
        }
      }

      if (sideways !== 0 || ahead !== 0) {
        // Panning scales with height, so the same key feels right up close and
        // from the overview.
        const reach = MathUtils.clamp(
          camera.position.distanceTo(controls.target) / 22,
          0.45,
          2,
        );
        move
          .set(0, 0, 0)
          .addScaledVector(forward, ahead)
          .addScaledVector(right, sideways)
          .normalize()
          .multiplyScalar(PAN_SPEED * reach * delta);

        controls.target.add(move);
        camera.position.add(move);
      }

      const turn =
        (pressed.current.has("KeyE") ? 1 : 0) -
        (pressed.current.has("KeyQ") ? 1 : 0);
      if (turn !== 0) {
        offset.copy(camera.position).sub(controls.target);
        offset.applyAxisAngle(UP, turn * ROTATE_SPEED * delta);
        camera.position.copy(controls.target).add(offset);
      }

      const dolly =
        (pressed.current.has("Minus") || pressed.current.has("NumpadSubtract")
          ? 1
          : 0) -
        (pressed.current.has("Equal") || pressed.current.has("NumpadAdd")
          ? 1
          : 0);
      if (dolly !== 0) {
        offset.copy(camera.position).sub(controls.target);
        const distance = MathUtils.clamp(
          offset.length() + dolly * ZOOM_SPEED * delta,
          controls.minDistance,
          controls.maxDistance,
        );
        offset.setLength(distance);
        camera.position.copy(controls.target).add(offset);
      }
    }

    // The office has edges. Dragging or walking past them pulls the whole rig
    // back rather than letting the target escape into empty space.
    const boundedX = MathUtils.clamp(controls.target.x, -PAN_BOUNDS.x, PAN_BOUNDS.x);
    const boundedZ = MathUtils.clamp(controls.target.z, -PAN_BOUNDS.z, PAN_BOUNDS.z);
    if (boundedX !== controls.target.x || boundedZ !== controls.target.z) {
      camera.position.x += boundedX - controls.target.x;
      camera.position.z += boundedZ - controls.target.z;
      controls.target.x = boundedX;
      controls.target.z = boundedZ;
    }

    controls.update();
  });

  return (
    <MapControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.09}
      minDistance={9}
      maxDistance={58}
      minPolarAngle={Math.PI / 9}
      maxPolarAngle={Math.PI / 2.3}
      zoomSpeed={0.85}
      panSpeed={0.9}
      /* Any hand on the controls cancels an in-progress flight. */
      onStart={() => {
        flight.current = null;
      }}
    />
  );
}
