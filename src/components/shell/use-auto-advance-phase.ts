"use client";

import { useEffect, useRef } from "react";
import type { RoomPhase, RoomState } from "@/contracts/room";
import { useRoom } from "@/components/room/room-provider";
import { proposalsReady } from "@/components/room/room-status";

/**
 * The room moves itself forward through its procedural phases.
 *
 * Input → Proposals, Proposals → Deliberation, and Deliberation → Alignment
 * each have one structural precondition and nothing else to weigh — the same
 * "any active participant may call this" transitions `advance_discussion`
 * and `request_team_alignment` already document for agents. There was never
 * a reason to make a person notice the condition was met and press a button
 * for it, so nobody has to: every active participant's own session watches
 * for it and calls it the moment it becomes true. The server re-checks
 * regardless, and rejects a duplicate or premature call harmlessly, so more
 * than one session reaching the same moment is not a race worth guarding.
 *
 * Alignment → Decision review stays a deliberate action -- see
 * `OwnerPhaseControls` -- because entering final decision review is a choice
 * to make, not a checkbox to satisfy.
 */
export function useAutoAdvancePhase(): void {
  const { room, self, actions } = useRoom();

  /** One attempt per (phase, room version): the snapshot after a successful
   *  call carries a new phase, which naturally stops matching below; a
   *  failed call (someone else already moved it, or a condition regressed)
   *  is left alone until the next snapshot gives it something new to try. */
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!self || self.status !== "active") return;

    const nextPhase = autoNextPhase(room);
    if (!nextPhase) return;

    const key = `${room.phase}->${nextPhase}:${room.version}`;
    if (attempted.current === key) return;
    attempted.current = key;

    void actions.advanceRoomPhase(nextPhase);
  }, [room, self, actions]);
}

function autoNextPhase(room: RoomState): RoomPhase | null {
  switch (room.phase) {
    case "input":
      return proposalsReady(room) ? "proposals" : null;
    case "proposals":
      return room.activeProposalId !== null ? "deliberation" : null;
    case "deliberation":
      return room.conflicts.some(
        (conflict) => conflict.status === "open" && conflict.severity === "blocking",
      )
        ? null
        : "voting";
    default:
      return null;
  }
}
