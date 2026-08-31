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

/**
 * The workspace currently open over the room, and what it was opened *at*.
 *
 * `itemId` is the one constraint, proposal or objection that was pressed on a
 * board; `null` when the whole workspace was opened (a dock tab, the board's
 * frame, a "+N more" tail). `nonce` makes pressing the same item twice a new
 * opening, so the panel re-finds and re-marks it rather than sitting still.
 */
export interface WorkspaceFocus {
  workspace: WorkspaceId;
  itemId: string | null;
  nonce: number;
}

export interface ShellContextValue {
  request: CameraRequest;
  activeWorkspace: WorkspaceId;
  activeDrawer: DrawerId | null;
  /** The workspace open over the scene, or `null` when the room is clear. */
  openPanel: WorkspaceFocus | null;
  /**
   * True when a participant's own agent prepared the exact final decision and
   * handed the last step back to them.
   *
   * Presentation only, and deliberately not an error: the agent did not fail,
   * it stopped where it is supposed to stop. The Decision workspace reads this
   * to say so in the person's own words rather than leaving them to guess why
   * the room moved.
   */
  agentPreparedDecision: boolean;
  /** True while the camera is still easing toward the active workspace. */
  moving: boolean;
  /** True when the OS prefers reduced motion, or the viewer asked for it below. */
  reducedMotion: boolean;
  /** The viewer's own override, independent of the OS preference. */
  forceReducedMotion: boolean;
  setForceReducedMotion(value: boolean): void;
  /**
   * Move the camera to a workspace, open its panel over the scene, and close
   * whatever drawer was open. `itemId` singles out the one board item that was
   * pressed, where there was one.
   */
  goToWorkspace(workspace: WorkspaceId, itemId?: string | null): void;
  /** Dismiss the open workspace panel; the camera stays where it is. */
  closeWorkspacePanel(): void;
  /**
   * Go to the Decision surface *because an agent asked a human to finish*.
   * Same navigation as `goToWorkspace("decision")`, plus the hand-off notice.
   */
  openDecisionReviewForHuman(): void;
  /** Drop the hand-off notice once the person has acted on it. */
  clearDecisionHandoff(): void;
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
  const [openPanel, setOpenPanel] = useState<WorkspaceFocus | null>(null);
  const [moving, setMoving] = useState(false);
  const [agentPreparedDecision, setAgentPreparedDecision] = useState(false);
  const [forceReducedMotion, setForceReducedMotion] = useState(false);
  const osReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    readOsReducedMotion,
    () => false,
  );
  const reducedMotion = osReducedMotion || forceReducedMotion;

  const goToWorkspace = useCallback((workspace: WorkspaceId, itemId: string | null = null) => {
    setActiveDrawer(null);
    setRequest((current) => ({ workspace, nonce: current.nonce + 1 }));
    setMoving(true);
    // The hand-off notice belongs to the Decision surface. Walking away from
    // it is an answer of a kind, and the notice should not be waiting when you
    // come back for an unrelated reason.
    if (workspace !== "decision") setAgentPreparedDecision(false);
    // Room is the home state rather than a workspace: arriving there clears
    // the scene instead of opening a panel over it.
    setOpenPanel((current) =>
      workspace === "room"
        ? null
        : { workspace, itemId, nonce: (current?.nonce ?? 0) + 1 },
    );
  }, []);

  const closeWorkspacePanel = useCallback(() => {
    setOpenPanel(null);
  }, []);

  /*
   * The one entry point for "your agent got as far as it may, the rest is
   * yours". It navigates exactly like any other workspace move, so nothing
   * about the camera is special-cased; the flag beside it is what lets the
   * Decision workspace explain *why* the room just moved, instead of leaving
   * a person to read a refusal code as a failure.
   */
  const openDecisionReviewForHuman = useCallback(() => {
    goToWorkspace("decision");
    setAgentPreparedDecision(true);
  }, [goToWorkspace]);

  const clearDecisionHandoff = useCallback(() => {
    setAgentPreparedDecision((current) => (current ? false : current));
  }, []);

  // A drawer is meeting metadata and a workspace panel is decision content:
  // one cognitive context at a time means opening either one puts the other
  // away, rather than stacking two cards over the same room.
  const openDrawer = useCallback((id: DrawerId) => {
    setOpenPanel(null);
    setActiveDrawer(id);
  }, []);

  const closeDrawer = useCallback(() => {
    setActiveDrawer(null);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Whichever surface is over the room comes off; the room itself is the
      // floor Escape stops at.
      setActiveDrawer((current) => (current ? null : current));
      setOpenPanel((current) => (current ? null : current));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleDrawer = useCallback((id: DrawerId) => {
    setOpenPanel(null);
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
      openPanel,
      agentPreparedDecision,
      moving,
      reducedMotion,
      forceReducedMotion,
      setForceReducedMotion,
      goToWorkspace,
      closeWorkspacePanel,
      openDecisionReviewForHuman,
      clearDecisionHandoff,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      handleArrive,
    }),
    [
      request,
      activeDrawer,
      openPanel,
      agentPreparedDecision,
      moving,
      reducedMotion,
      forceReducedMotion,
      goToWorkspace,
      closeWorkspacePanel,
      openDecisionReviewForHuman,
      clearDecisionHandoff,
      openDrawer,
      closeDrawer,
      toggleDrawer,
      handleArrive,
    ],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
