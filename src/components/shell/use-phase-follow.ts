"use client";

import { useEffect, useRef } from "react";
import { useRoom } from "@/components/room/room-provider";
import { PHASE_WORKSPACE } from "./phase-workspace";
import { useShell } from "./shell-provider";

/**
 * The room follows the meeting.
 *
 * When the canonical phase changes — because a person advanced it, or because
 * somebody's agent did — the camera moves to the surface that phase is about
 * and opens it. Nobody has to notice a changed word in the toolbar and then go
 * hunting for the board it refers to, and an agent never has to describe where
 * to click: the room is already there.
 *
 * Three rules keep it from being a hijack:
 *
 * - the first snapshot is never a move, so opening a room that is already in
 *   Deliberation lands you at the table like it always did;
 * - a phase that has not changed never moves anything, so ordinary edits,
 *   realtime updates and re-renders are silent;
 * - an open drawer wins. A drawer means the viewer is mid-task on meeting
 *   admin — admitting someone, reading the ledger — and `goToWorkspace` closes
 *   drawers, so following the phase there would snatch a half-finished job
 *   away. The dock still shows where the room went.
 *
 * Nothing here is room state, and nothing here gates anything: it decides
 * where a camera stands.
 */
export function usePhaseFollow(): void {
  const { room } = useRoom();
  const { activeDrawer, goToWorkspace } = useShell();

  /** `null` until the first snapshot; whatever it holds has been seen. */
  const seenPhase = useRef<string | null>(null);

  useEffect(() => {
    const previous = seenPhase.current;
    // Marked seen before the drawer check, so a phase that arrives while a
    // drawer is open is not still pending when the drawer closes: the room
    // moved on without you, and the dock is where you catch up.
    seenPhase.current = room.phase;

    if (previous === null || previous === room.phase) return;
    if (activeDrawer !== null) return;

    goToWorkspace(PHASE_WORKSPACE[room.phase]);
  }, [room.phase, activeDrawer, goToWorkspace]);
}
