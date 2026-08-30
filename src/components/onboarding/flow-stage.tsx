"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { PreMeetingStageMount } from "./pre-meeting-stage-mount";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import {
  flowHandoverSeconds,
  type PreMeetingPoseId,
} from "@/visualization/scene/camera-poses";

/**
 * The pre-meeting flow as one continuous room, not three pages.
 *
 * Welcome, create and lobby share a single mounted `<Canvas>`, so moving
 * between them is a camera move rather than a page load. This owns two
 * things the screens cannot own separately:
 *
 *  - where the camera stands, and whether the room is framed as an object on
 *    the page (welcome) or fills the window (create, lobby);
 *  - the flight itself: `enter()` sends the camera to the next pose first and
 *    navigates only once it has arrived, so the next screen's panel is
 *    revealed by the camera instead of cutting over it.
 *
 * The handover is timed against the camera rig's own flight, so the two
 * cannot drift apart. Navigation is still a real `<Link>` underneath: with no
 * JavaScript, or with no stage mounted, `enter` is null and the link simply
 * follows itself.
 */

interface FlowStageValue {
  /** The room is held inside a frame on the page, not filling the window. */
  framed: boolean;
  /** A flight has started; this screen is on its way out. */
  leaving: boolean;
  /** Fly to `pose`, then navigate to `href`. Null when no stage is mounted. */
  enter: ((href: string, pose: PreMeetingPoseId) => void) | null;
}

const FLOW_STAGE_FALLBACK: FlowStageValue = {
  framed: true,
  leaving: false,
  enter: null,
};

const FlowStageContext = createContext<FlowStageValue>(FLOW_STAGE_FALLBACK);

export function useFlowStage(): FlowStageValue {
  return useContext(FlowStageContext);
}

/** Where the camera stands on each screen of the flow. */
function poseForPath(pathname: string): PreMeetingPoseId {
  if (pathname.startsWith("/new")) return "create";
  if (pathname.startsWith("/join")) return "join";
  if (pathname.endsWith("/setup")) return "lobby";
  return "welcome";
}

export function FlowStage({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const reducedMotion = usePrefersReducedMotion();
  const [flight, setFlight] = useState<{
    href: string;
    pose: PreMeetingPoseId;
  } | null>(null);
  const [flightPath, setFlightPath] = useState(pathname);
  const pendingNavigation = useRef<number | null>(null);

  const cancelPendingNavigation = useCallback(() => {
    if (pendingNavigation.current === null) return;
    window.clearTimeout(pendingNavigation.current);
    pendingNavigation.current = null;
  }, []);

  // A route change lands the flight — the arrival it asked for, or a back
  // button pressed mid-air, which also cancels the push it was about to make.
  // A landed flight has to be cleared, not just ignored: coming back to the
  // screen it left from would otherwise re-arm it and hold the camera there.
  if (flightPath !== pathname) {
    setFlightPath(pathname);
    setFlight(null);
  }

  useEffect(() => cancelPendingNavigation, [pathname, cancelPendingNavigation]);

  // The camera flight is the only thing that should take time. Warming the
  // next screen means the push at the end of it resolves against a route that
  // is already there, rather than leaving the room empty while it loads.
  useEffect(() => {
    if (poseForPath(pathname) === "welcome") {
      router.prefetch("/new");
      router.prefetch("/join");
    }
  }, [pathname, router]);

  const enter = useCallback(
    (href: string, pose: PreMeetingPoseId) => {
      if (pendingNavigation.current !== null) return;
      setFlight({ href, pose });
      pendingNavigation.current = window.setTimeout(() => {
        pendingNavigation.current = null;
        router.push(href);
      }, flowHandoverSeconds(reducedMotion) * 1000);
    },
    [reducedMotion, router],
  );

  // Mid-flight the camera already holds the destination pose, so arriving is
  // not a second animation.
  const pose = flight?.pose ?? poseForPath(pathname);
  const value = useMemo<FlowStageValue>(
    () => ({ framed: pose === "welcome", leaving: flight !== null, enter }),
    [pose, flight, enter],
  );

  return (
    <FlowStageContext.Provider value={value}>
      <PreMeetingStageMount pose={pose} framed={value.framed} />
      {children}
    </FlowStageContext.Provider>
  );
}
