"use client";

import { Suspense } from "react";
import { PerspectiveCamera } from "@react-three/drei";
import type { RoomVisualizationState } from "@/visualization/room-view-model";
import { CameraController, type CameraRequest } from "./camera-controller";
import { CAMERA_POSES } from "./camera-poses";
import { CAMERA } from "./meeting-room-layout";
import { CentralMeetingRoom } from "./central-meeting-room";
import type { WorkspaceId } from "./camera-poses";
import { useSceneInteraction } from "./scene-interaction";

/**
 * The room, assembled from one projection of canonical room state.
 *
 * BACKEND CONTRACT:
 * This subtree receives `RoomVisualizationState` and a camera request, and
 * nothing else. It never calls `RoomClient`, never touches the network, and
 * never derives authoritative phase, consensus, vote, or approval state.
 */
export function MeetingScene({
  view,
  request,
  reducedMotion,
  onArrive,
}: {
  view: RoomVisualizationState;
  request: CameraRequest;
  reducedMotion: boolean;
  onArrive: (workspace: WorkspaceId) => void;
}) {
  const { onSelect } = useSceneInteraction();

  return (
    <>
      <PerspectiveCamera
        makeDefault
        position={CAMERA_POSES[request.workspace].position}
        fov={CAMERA.fov}
      />
      <CameraController request={request} reducedMotion={reducedMotion} onArrive={onArrive} />

      {/* Linear fog fades the far ground into the page backdrop so no horizon
          seam swings into frame when the camera pulls back to the pre-meeting
          poses. `near` sits well beyond every workspace vantage point. */}
      <fog attach="fog" args={["#ede9e0", 34, 96]} />

      <hemisphereLight args={["#ffffff", "#dfd8c9", 1.15]} />
      <directionalLight position={[9, 15, 11]} intensity={1.35} color="#fff7ea" castShadow />
      <directionalLight position={[-10, 7, -6]} intensity={0.32} color="#eaf1ff" />

      {/* Clicking bare floor steps back out of whatever board was selected. */}
      <mesh
        position={[0, -0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => onSelect(null)}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* The room's own boundary, inside the canvas. The props suspend while
          their `.glb` files load, and without this the nearest boundary is the
          DOM one outside `<Canvas>` — which would tear down the canvas and
          rebuild the whole scene rather than waiting for five small files. */}
      <Suspense fallback={null}>
        <CentralMeetingRoom
          view={view}
          activeWorkspace={request.workspace}
          reducedMotion={reducedMotion}
        />
      </Suspense>
    </>
  );
}
