"use client";

import {
  Component,
  Suspense,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import { Color, Vector3, type PerspectiveCamera as PerspectiveCameraImpl } from "three";
import { createPlaceholderVisualizationState } from "@/visualization/room-view-model";
import { CentralMeetingRoom } from "@/visualization/scene/central-meeting-room";
import {
  ease,
  fitPoseToFrame,
  flowFlightSeconds,
  PRE_MEETING_POSES,
  WELCOME_FRAME_FILL,
  WELCOME_FRAME_LIFT,
  WELCOME_FOV,
  type CameraPose,
  type PreMeetingPoseId,
} from "@/visualization/scene/camera-poses";
import { CAMERA } from "@/visualization/scene/meeting-room-layout";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * The 3D meeting room, as the pre-meeting flow's own stage.
 *
 * This is the same room the meeting shell renders, from one of the flow's
 * camera poses (`welcome` / `create` / `lobby`). Throughout the flow it is a
 * model resting on a surface, never standing on open ground: on welcome that
 * surface is a card on the page and the whole model is fitted inside it; by
 * the later screens the frame has opened into the window and the screen's
 * panel floats over the room.
 *
 * It stays decorative: `aria-hidden`, no pointer interaction, no workspace
 * dock, and it reads no canonical room state — every onboarding screen keeps
 * a complete DOM surface in front of it. If WebGL is missing or the canvas
 * throws, this renders nothing and the screen is unaffected.
 */

/**
 * What the room rests on at each pose: the welcome card, then the page ground
 * once the frame has opened into the window. The room itself never stands on
 * open ground here — through the whole flow it is a model on a surface, which
 * is what lets the surface change colour as one eased move instead of a cut.
 */
const SURFACE_TONE: Record<PreMeetingPoseId, string> = {
  welcome: "#f6f4ee",
  create: "#ede9e0",
  lobby: "#ede9e0",
};

class BackdropErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("Pre-meeting 3D stage failed to render", error, info.componentStack);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Where the camera stands for this pose, in a frame of this shape.
 *
 * Only the welcome shot is fitted: it presents the whole room as one object,
 * so it has to hold the model whatever the window does. The later poses are
 * inside the composition and are used exactly as authored.
 */
function resolvePose(pose: PreMeetingPoseId, aspect: number): CameraPose {
  const base = PRE_MEETING_POSES[pose];
  return pose === "welcome"
    ? fitPoseToFrame(
        base,
        aspect,
        WELCOME_FOV,
        WELCOME_FRAME_FILL,
        WELCOME_FRAME_LIFT,
      )
    : base;
}

/** The welcome shot has its own lens; every other pose uses the room's. */
function fovFor(pose: PreMeetingPoseId): number {
  return pose === "welcome" ? WELCOME_FOV : CAMERA.fov;
}

/**
 * Keeps the drawing surface the size of the frame it is drawn into.
 *
 * The frame opens from the welcome card into the window over the length of
 * the flight, and the canvas has to follow it every frame. React Three
 * Fiber's own measurement does not: it observes the container but reports the
 * new size once, after the transition has already finished, which lands as a
 * jump exactly when the next screen appears. Reading the container directly
 * each frame keeps the two together — through the flight, and through any
 * ordinary window resize.
 */
function StageSurface() {
  const setSize = useThree((state) => state.setSize);

  useFrame((state) => {
    const container = state.gl.domElement.parentElement;
    if (!container) return;

    const { clientWidth: width, clientHeight: height } = container;
    if (width === 0 || height === 0) return;
    if (width === state.size.width && height === state.size.height) return;

    setSize(width, height);
  });

  return null;
}

/**
 * Eases the whole shot between flow poses — position, the point it looks at,
 * the lens, and the tone of the surface the room rests on — then holds it
 * there with a slow idle drift so it is not dead-still.
 *
 * All four move on the same eased curve, which is what keeps the move
 * continuous: nothing cuts while the frame is still opening. Every frame
 * re-resolves the destination from the canvas's current shape, so the framing
 * survives a window resize — including the one the frame itself performs as
 * it opens out of the welcome card into the full window. The flight uses
 * `flowFlightSeconds`, the same duration the flow layout waits before it
 * navigates, so the panel appears exactly as the camera lands.
 */
function StageCamera({
  pose,
  reducedMotion,
}: {
  pose: PreMeetingPoseId;
  reducedMotion: boolean;
}) {
  const rig = useRef({
    pos: new Vector3(),
    target: new Vector3(),
    from: {
      pos: new Vector3(),
      target: new Vector3(),
      fov: fovFor(pose),
      tone: new Color(SURFACE_TONE[pose]),
    },
    to: { pos: new Vector3(), target: new Vector3(), tone: new Color() },
    tone: new Color(SURFACE_TONE[pose]),
    travel: 1,
    primed: false,
    pose,
  });

  useFrame((state, rawDelta) => {
    const r = rig.current;
    const camera = state.camera as PerspectiveCameraImpl;
    const aspect = state.size.height > 0 ? state.size.width / state.size.height : 1;
    const destination = resolvePose(pose, aspect);
    r.to.pos.set(...destination.position);
    r.to.target.set(...destination.target);
    r.to.tone.set(SURFACE_TONE[pose]);
    state.scene.background = r.tone;

    // First frame: sit exactly on the starting pose, no flight.
    if (!r.primed) {
      r.primed = true;
      r.from.pos.copy(r.to.pos);
      r.from.target.copy(r.to.target);
      r.from.tone.copy(r.to.tone);
      r.travel = 1;
    }

    // A new pose leaves from wherever the camera actually is, so a flight
    // interrupted halfway continues from there rather than snapping back.
    if (r.pose !== pose) {
      r.pose = pose;
      r.from.pos.copy(r.pos);
      r.from.target.copy(r.target);
      r.from.fov = camera.fov;
      r.from.tone.copy(r.tone);
      r.travel = 0;
    }

    if (r.travel < 1) {
      const duration = flowFlightSeconds(reducedMotion);
      r.travel = Math.min(1, r.travel + Math.min(rawDelta, 0.05) / duration);
    }

    const k = ease(r.travel);
    r.pos.lerpVectors(r.from.pos, r.to.pos, k);
    r.target.lerpVectors(r.from.target, r.to.target, k);
    r.tone.copy(r.from.tone).lerp(r.to.tone, k);

    // The lens opens out of the welcome shot's long framing and into the
    // room's own, so flying in reads as stepping inside rather than zooming.
    const fov = r.from.fov + (fovFor(pose) - r.from.fov) * k;
    if (camera.isPerspectiveCamera && Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const t = state.clock.elapsedTime;
    const drift = reducedMotion ? 0 : Math.sin(t * 0.16);
    const lift = reducedMotion ? 0 : Math.sin(t * 0.12);
    camera.position.set(
      r.pos.x + drift * 0.22,
      r.pos.y + lift * 0.1,
      r.pos.z + drift * 0.12,
    );
    camera.lookAt(r.target);
  });

  return null;
}

export function PreMeetingStage({
  pose,
  framed,
  seatCount = 6,
}: {
  pose: PreMeetingPoseId;
  /** Welcome holds the room in a card; the later screens fill the window. */
  framed: boolean;
  /** Placeholder figures around the table; identity is never implied. */
  seatCount?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [view] = useState(() =>
    createPlaceholderVisualizationState({ seatCount }),
  );
  // The camera's starting point is fixed at mount; `StageCamera` owns every
  // move after that, so drei never re-applies a `position` prop mid-flight.
  const [initialPose] = useState(pose);

  return (
    <div
      className={framed ? "flow-stage flow-stage-framed" : "flow-stage"}
      aria-hidden="true"
    >
      <BackdropErrorBoundary>
        <Suspense fallback={null}>
          <Canvas
            className="flow-stage-canvas"
            dpr={[1, 1.75]}
            gl={{ antialias: true, alpha: true }}
            shadows
          >
            <PerspectiveCamera
              makeDefault
              position={PRE_MEETING_POSES[initialPose].position}
              fov={fovFor(initialPose)}
            />
            <StageSurface />
            <StageCamera pose={pose} reducedMotion={reducedMotion} />

            <hemisphereLight args={["#ffffff", "#dfd8c9", 1.15]} />
            {/* The default shadow frustum is narrower than the room, which
                cropped the shadow halfway across the floor. Widened to the
                model, so the whole room casts. */}
            <directionalLight
              position={[9, 15, 11]}
              intensity={1.35}
              color="#fff7ea"
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-16}
              shadow-camera-right={16}
              shadow-camera-top={16}
              shadow-camera-bottom={-16}
              shadow-camera-far={60}
            />
            <directionalLight position={[-10, 7, -6]} intensity={0.32} color="#eaf1ff" />

            <CentralMeetingRoom
              view={view}
              activeWorkspace="room"
              reducedMotion={reducedMotion}
              footing="surface"
            />
          </Canvas>
        </Suspense>
      </BackdropErrorBoundary>
    </div>
  );
}
