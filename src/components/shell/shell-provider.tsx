"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { CameraRequest } from "@/visualization/scene/camera-controller";
import type { WorkspaceId } from "@/visualization/scene/camera-poses";

/**
 * The shell that turns the room into a place with one focus at a time.
 *
 * BACKEND CONTRACT:
 * Everything here is presentation. The active workspace, the open drawer, and
 * where the camera is looking are not room state, are never sent anywhere,
 * and never reach `RoomClient`. Swapping `MockRoomClient` for `ApiRoomClient`
 * changes nothing in this file.
 */

export type DrawerId =
  | "participants"
  | "role"
  | "activity"
  | "agents"
  | "settings"
  | "leave"
  | "help"
  | "attention";

export interface ShellContextValue {
  request: CameraRequest;
  activeWorkspace: WorkspaceId;
  activeDrawer: DrawerId | null;
  /** True while the camera is still easing toward the active workspace. */
  moving: boolean;
  /** True when the OS prefers reduced motion, or the viewer asked for it below. */
  reducedMotion: boolean;
  /** The viewer's own override, independent of the OS preference. */
  forceReducedMotion: boolean;
  setForceReducedMotion(value: boolean): void;
  /** Move the camera to a workspace and close whatever drawer is open. */
  goToWorkspace(workspace: WorkspaceId): void;
  openDrawer(id: DrawerId): void;
  closeDrawer(): void;
  toggleDrawer(id: DrawerId): void;
  /** The scene calls this once a requested camera flight settles. */
  handleArrive(workspace: WorkspaceId): void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell must be used inside a MeetingShellProvider.");
  }
  return value;
}

function subscribeToReducedMotion(callback: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function readOsReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MeetingShellProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<CameraRequest>({ workspace: "room", nonce: 0 });
  const [activeDrawer, setActiveDrawer] = useState<DrawerId | null>(null);
  const [moving, setMoving] = useState(false);
  const [forceReducedMotion, setForceReducedMotion] = useState(false);
  const osReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    readOsReducedMotion,
    () => false,
  );
  const reducedMotion = osReducedMotion || forceReducedMotion;

  const goToWorkspace = useCallback((workspace: WorkspaceId) => {
    setActiveDrawer(null);
    setRequest((current) => ({ workspace, nonce: current.nonce + 1 }));
    setMoving(true);
  }, []);

  const openDrawer = useCallback((id: DrawerId) => {
    setActiveDrawer(id);
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveDrawer((current) => (current ? null : current));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleDrawer = useCallback((id: DrawerId) => {
    setActiveDrawer((current) => (current === id ? null : id));
  }, []);

  const handleArrive = useCallback((workspace: WorkspaceId) => {
    setMoving((current) => (current ? false : current));
    void workspace;
  }, []);

  const value = useMemo<ShellContextValue>(
    () => ({
      request,
      activeWorkspace: request.workspace,
      activeDrawer,
      moving,
      reducedMotion,
      forceReducedMotion,
      setForceReducedMotion,
      goToWorkspace,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      handleArrive,
    }),
    [
      request,
      activeDrawer,
      moving,
      reducedMotion,
      forceReducedMotion,
      goToWorkspace,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      handleArrive,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
