"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { CAMERA_POSES, ease, flightDuration, type WorkspaceId } from "./camera-poses";

/** What the shell hands the scene: a workspace, and a nonce so re-selecting
 * the same workspace still flies (rather than being a no-op). */
export interface CameraRequest {
  workspace: WorkspaceId;
  nonce: number;
}

/**
 * Drives the camera between the room's eight named poses.
 *
 * There is no free orbit, pan, or WASD here on purpose: the product's camera
 * design rule is a small set of named states reached by semantic navigation,
 * not unrestricted FPS-style movement. Every transition eases the same way
 * the imported design does, and collapses to an instant cut under
 * `prefers-reduced-motion`.
 */
export function CameraController({
  request,
  reducedMotion,
  onArrive,
}: {
  request: CameraRequest;
  reducedMotion: boolean;
  onArrive?: (workspace: WorkspaceId) => void;
}) {
  const initialPose = CAMERA_POSES[request.workspace];
  const camPos = useRef(new Vector3(...initialPose.position));
  const camTarget = useRef(new Vector3(...initialPose.target));
  const from = useRef({ pos: new Vector3(...initialPose.position), target: new Vector3(...initialPose.target) });
  const to = useRef({ pos: new Vector3(...initialPose.position), target: new Vector3(...initialPose.target) });
  const travel = useRef(1);
  const duration = useRef(0.001);
  const arrivedFor = useRef<number | null>(request.nonce);

  useEffect(() => {
    const pose = CAMERA_POSES[request.workspace];
    const targetPos = new Vector3(...pose.position);
    const targetLook = new Vector3(...pose.target);

    from.current = { pos: camPos.current.clone(), target: camTarget.current.clone() };
    to.current = { pos: targetPos, target: targetLook };
    duration.current = flightDuration(camPos.current.distanceTo(targetPos), reducedMotion);
    travel.current = 0;
    arrivedFor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.workspace, request.nonce]);

  useFrame((state, rawDelta) => {
    if (travel.current < 1) {
      const delta = Math.min(rawDelta, 0.05);
      travel.current = Math.min(1, travel.current + delta / duration.current);
      const k = ease(travel.current);
      camPos.current.lerpVectors(from.current.pos, to.current.pos, k);
      camTarget.current.lerpVectors(from.current.target, to.current.target, k);

      if (travel.current === 1 && arrivedFor.current !== request.nonce) {
        arrivedFor.current = request.nonce;
        onArrive?.(request.workspace);
      }
    }

    state.camera.position.copy(camPos.current);
    state.camera.lookAt(camTarget.current);
  });

  return null;
}
