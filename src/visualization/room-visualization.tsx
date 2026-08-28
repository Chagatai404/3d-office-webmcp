"use client";

import { Component, memo, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OfficeScene } from "./scene/office-scene";
import type { CameraFlight } from "./scene/god-view-controls";
import {
  SceneInteractionProvider,
  type SceneInteraction,
} from "./scene/scene-interaction";
import type {
  RoomVisualizationState,
  VisualParticipant,
} from "./room-view-model";

/**
 * The boundary between the application and the 3D office.
 *
 * The office is the page now, so this fills the viewport and everything else
 * floats above it. It is still not the only way to reach anything: every place
 * you can click here has a keyboard-reachable button in the dock, and every
 * fact it shows is readable in the windows. If WebGL is unavailable or the
 * canvas throws, the room keeps working and this degrades to a text summary of
 * the same projection.
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
  const seated = view.officeSlots.filter(
    (slot) => slot.status === "occupied",
  ).length;
  const countIn = (presence: VisualParticipant["presence"]) =>
    view.participants.filter(
      (participant) => participant.presence === presence,
    ).length;

  return (
    <div className="scene-fallback">
      <p className="panel-note">{reason}</p>
      <ul>
        <li>
          {seated} of {view.officeSlots.length} offices occupied
        </li>
        <li>
          {countIn("meeting")} in the meeting room, {countIn("office")} at their
          desk, {countIn("roaming")} moving about the office
        </li>
        <li>{view.constraints.length} constraints on the constraint wall</li>
        <li>
          {view.activeProposal
            ? `Active proposal: ${view.activeProposal.title}`
            : "No proposal on the central table"}
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
  focus,
  interaction,
}: {
  view: RoomVisualizationState;
  focus: CameraFlight;
  interaction: SceneInteraction;
}) {
  return (
    <div className="scene-frame">
      <SceneErrorBoundary
        fallback={
          <SceneSummary
            view={view}
            reason="The 3D office could not be displayed. The room is unchanged; here is the same state in text."
          />
        }
      >
        <Suspense
          fallback={
            <SceneSummary view={view} reason="Loading the 3D office…" />
          }
        >
          <Canvas
            className="scene-canvas"
            dpr={[1, 1.75]}
            gl={{ antialias: true }}
            /* Clicking past every object steps back out of the selection. */
            onPointerMissed={() => interaction.onSelect(null)}
            /* The windows and the dock carry the same semantics in the DOM. */
            aria-hidden="true"
          >
            <color attach="background" args={["#0b1119"]} />
            <fog attach="fog" args={["#0b1119", 60, 130]} />
            <SceneInteractionProvider value={interaction}>
              <OfficeScene view={view} focus={focus} />
            </SceneInteractionProvider>
          </Canvas>
        </Suspense>
      </SceneErrorBoundary>
    </div>
  );
});
