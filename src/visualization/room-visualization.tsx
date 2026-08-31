"use client";

import { Component, memo, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { MeetingScene } from "./scene/meeting-scene";
import type { CameraRequest } from "./scene/camera-controller";
import type { WorkspaceId } from "./scene/camera-poses";
import {
  SceneInteractionProvider,
  type SceneInteraction,
} from "./scene/scene-interaction";
import type { RoomVisualizationState } from "./room-view-model";

/**
 * The boundary between the application and the 3D meeting room.
 *
 * The room is the page now, so this fills the viewport and everything else
 * floats above it. It is still not the only way to reach anything: every
 * board you can click here has a keyboard-reachable tab in the workspace
 * dock, and every fact it shows is readable in the matching panel. If WebGL
 * is unavailable or the canvas throws, the room keeps working and this
 * degrades to a text summary of the same projection.
 */

class SceneErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("3D office failed to render", error, info.componentStack);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function SceneSummary({
  view,
  reason,
}: {
  view: RoomVisualizationState;
  reason: string;
}) {
  return (
    <div className="scene-fallback">
      <p className="panel-note">{reason}</p>
      <ul>
        <li>{view.participants.length} participants seated at the table</li>
        <li>{view.constraints.length} constraints on the constraints board</li>
        <li>
          {view.activeProposal
            ? `Active proposal: ${view.activeProposal.title}`
            : "No proposal on the table yet"}
        </li>
        <li>
          {view.conflicts.filter((conflict) => conflict.status === "open").length}{" "}
          open objections
        </li>
      </ul>
    </div>
  );
}

/**
 * Memoised because the shell above re-renders whenever anything in the room
 * or the window layout moves, and rebuilding the office for that would be
 * wasted work: the scene only depends on these three values.
 */
export const RoomVisualization = memo(function RoomVisualization({
  view,
  request,
  reducedMotion,
  onArrive,
  interaction,
}: {
  view: RoomVisualizationState;
  request: CameraRequest;
  reducedMotion: boolean;
  onArrive: (workspace: WorkspaceId) => void;
  interaction: SceneInteraction;
}) {
  return (
    <div className="scene-frame">
      <SceneErrorBoundary
        fallback={
          <SceneSummary
            view={view}
            reason="The 3D room could not be displayed. The room is unchanged; here is the same state in text."
          />
        }
      >
        <Suspense
          fallback={
            <SceneSummary view={view} reason="Preparing the meeting room…" />
          }
        >
          <Canvas
            className="scene-canvas"
            dpr={[1, 1.75]}
            gl={{ antialias: true, alpha: true }}
            shadows
            /* Clicking past every object steps back out of the selection. */
            onPointerMissed={() => interaction.onSelect(null)}
            /* The dock carries the same semantics in the DOM. */
            aria-hidden="true"
          >
            <color attach="background" args={["#ede9e0"]} />
            <SceneInteractionProvider value={interaction}>
              <MeetingScene
                view={view}
                request={request}
                reducedMotion={reducedMotion}
                onArrive={onArrive}
              />
            </SceneInteractionProvider>
          </Canvas>
        </Suspense>
      </SceneErrorBoundary>
    </div>
  );
});
