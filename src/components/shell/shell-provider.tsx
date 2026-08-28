"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { SceneZoneId } from "@/visualization/scene/scene-focus";
import {
  createWindows,
  windowReducer,
  type Viewport,
  type WindowFrame,
  type WindowId,
  type WindowMap,
} from "./window-state";
import { windowForZone } from "./zone-windows";

/**
 * The shell that turns the room into a place you move around in.
 *
 * BACKEND CONTRACT:
 * Everything here is presentation. Window positions, the selected zone, and
 * where the camera is looking are not room state, are never sent anywhere, and
 * never reach `RoomClient`. Swapping `MockRoomClient` for `ApiRoomClient`
 * changes nothing in this file.
 */

/** Used while rendering on the server, where there is no window to measure. */
const ASSUMED_VIEWPORT: Viewport = { width: 1440, height: 900 };

function subscribeToViewport(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/** A string, so repeated reads compare equal and never loop the store. */
function measureViewport(): string {
  return `${window.innerWidth}x${window.innerHeight}`;
}

function readViewport(measurement: string | null): Viewport {
  if (!measurement) return ASSUMED_VIEWPORT;
  const [width, height] = measurement.split("x").map(Number);
  return {
    width: width ?? ASSUMED_VIEWPORT.width,
    height: height ?? ASSUMED_VIEWPORT.height,
  };
}

/** The camera flight the scene should perform, re-issued on every request. */
export interface CameraFocus {
  zone: SceneZoneId;
  /** Increments even when the zone repeats, so "go there again" still flies. */
  nonce: number;
}

export interface ShellContextValue {
  windows: WindowMap;
  viewport: Viewport;
  /** False until the real viewport is measured in the browser. */
  ready: boolean;
  camera: CameraFocus;
  selectedZone: SceneZoneId | null;
  hoveredZone: SceneZoneId | null;
  openWindow(id: WindowId): void;
  closeWindow(id: WindowId): void;
  toggleWindow(id: WindowId): void;
  focusWindow(id: WindowId): void;
  /** Records a moved or resized window; until then it follows its anchor. */
  placeWindow(id: WindowId, frame: WindowFrame): void;
  resetLayout(): void;
  /** Fly to a place and open whatever panel explains it. */
  visitZone(zone: SceneZoneId): void;
  /** Fly to a place without touching the windows. */
  flyTo(zone: SceneZoneId): void;
  /** Step back out of the current selection, leaving the camera alone. */
  clearSelection(): void;
  setHoveredZone(zone: SceneZoneId | null): void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/** The shell is optional: panels also render outside it, as the tests do. */
export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell must be used inside a WorldShellProvider.");
  }
  return value;
}

export function WorldShellProvider({ children }: { children: ReactNode }) {
  // Read straight from the browser rather than mirroring the size into state,
  // so a resized window needs no effect and no cascading render.
  const measurement = useSyncExternalStore(
    subscribeToViewport,
    measureViewport,
    () => null,
  );
  const viewport = useMemo(() => readViewport(measurement), [measurement]);

  const [windows, dispatch] = useReducer(windowReducer, undefined, createWindows);
  const [camera, setCamera] = useState<CameraFocus>({
    zone: "overview",
    nonce: 0,
  });
  const [selectedZone, setSelectedZone] = useState<SceneZoneId | null>(null);
  const [hoveredZone, setHoveredZone] = useState<SceneZoneId | null>(null);

  const flyTo = useCallback((zone: SceneZoneId) => {
    setCamera((current) => ({ zone, nonce: current.nonce + 1 }));
    setSelectedZone(zone === "overview" ? null : zone);
  }, []);

  // Every action keeps a stable identity across renders. The scene is
  // memoised on the interaction object built from them, so a hover or a moved
  // window must not look like a new callback and rebuild the office.
  const openWindow = useCallback((id: WindowId) => {
    dispatch({ type: "open", id });
  }, []);
  const closeWindow = useCallback((id: WindowId) => {
    dispatch({ type: "close", id });
  }, []);
  const toggleWindow = useCallback((id: WindowId) => {
    dispatch({ type: "toggle", id });
  }, []);
  const focusWindow = useCallback((id: WindowId) => {
    dispatch({ type: "focus", id });
  }, []);
  const resetLayout = useCallback(() => {
    dispatch({ type: "reset" });
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedZone(null);
  }, []);

  const placeWindow = useCallback(
    (id: WindowId, frame: WindowFrame) => {
      dispatch({ type: "place", id, frame, viewport });
    },
    [viewport],
  );

  const visitZone = useCallback(
    (zone: SceneZoneId) => {
      flyTo(zone);
      const id = windowForZone(zone);
      if (id) dispatch({ type: "open", id });
    },
    [flyTo],
  );

  const value = useMemo<ShellContextValue>(
    () => ({
      windows,
      viewport,
      ready: measurement !== null,
      camera,
      selectedZone,
      hoveredZone,
      openWindow,
      closeWindow,
      toggleWindow,
      focusWindow,
      placeWindow,
      resetLayout,
      flyTo,
      clearSelection,
      visitZone,
      setHoveredZone,
    }),
    [
      windows,
      viewport,
      measurement,
      camera,
      selectedZone,
      hoveredZone,
      openWindow,
      closeWindow,
      toggleWindow,
      focusWindow,
      placeWindow,
      resetLayout,
      flyTo,
      clearSelection,
      visitZone,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
