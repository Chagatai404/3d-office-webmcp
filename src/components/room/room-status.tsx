"use client";

import { useState } from "react";
import type { ActionResult, Participant, RoomPhase, RoomState } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import { PHASE_LABEL, PHASE_ORDER } from "./room-labels";

/**
 * The owner's one remaining manual step: entering Decision review.
 *
 * Input→Proposals, Proposals→Deliberation, and Deliberation→Alignment are
 * procedural -- `useAutoAdvancePhase` fires them itself the moment their one
 * structural precondition is met, the same "any active participant may call
 * this" transitions `advance_discussion` and `request_team_alignment`
 * already document for agents. Alignment→Decision review does not: freezing
 * the exact candidate for a final decision is a choice someone makes on
 * purpose, not a checkbox that happens to fill itself in, so it keeps its
 * button here. When it becomes available, `owner_progress_required` (see
 * `domain/rooms/attention.ts`) surfaces it as a persistent alert too, so
 * reaching this button does not depend on remembering to check Settings.
 *
 * This used to sit inside a larger "phase & room status" display in the
 * Participants drawer, alongside a phase rail and the coordination card --
 * both already shown elsewhere (the dock's tabs, and each workspace's own
 * `CoordinationStatus` strip), so Participants now shows only the roster.
 */
export function OwnerPhaseControls() {
  const { room, self, actions } = useRoom();
  const [pendingPhase, setPendingPhase] = useState<RoomPhase | null>(null);
  const [phaseResult, setPhaseResult] = useState<ActionResult<unknown> | null>(
    null,
  );

  const isOwner = Boolean(
    self?.id === room.ownerParticipantId && self.meetingRole === "owner",
  );
  if (!isOwner) return null;

  async function handlePhaseAdvance(phase: RoomPhase) {
    if (pendingPhase) return;

    setPendingPhase(phase);
    const result = await actions.advanceRoomPhase(phase);
    setPendingPhase(null);
    setPhaseResult(result);
  }

  return (
    <div className="organizer-panel" aria-labelledby="organizer-heading">
      <h3 className="panel-subheading" id="organizer-heading">
        Decision review
      </h3>

      <div className="phase-control-group" aria-label="Owner phase controls">
        <PhaseAdvanceButton
          phase="approval"
          label="Review decision"
          currentPhase={room.phase}
          pendingPhase={pendingPhase}
          reason={approvalDisabledReason(room)}
          onAdvance={handlePhaseAdvance}
        />
      </div>

      <ActionFeedback result={phaseResult} />
    </div>
  );
}

function PhaseAdvanceButton({
  phase,
  label,
  currentPhase,
  pendingPhase,
  reason,
  onAdvance,
}: {
  phase: RoomPhase;
  label: string;
  currentPhase: RoomPhase;
  pendingPhase: RoomPhase | null;
  reason: string | null;
  onAdvance(phase: RoomPhase): void;
}) {
  const sourcePhase = previousPhaseFor(phase);
  const wrongPhaseReason =
    currentPhase === sourcePhase
      ? null
      : phaseComesBefore(phase, currentPhase)
        ? `${PHASE_LABEL[phase]} has already started.`
        : `Available after ${PHASE_LABEL[sourcePhase]}.`;
  const disabledReason = wrongPhaseReason ?? reason;
  const disabled = pendingPhase !== null || disabledReason !== null;

  return (
    <div className="phase-control">
      <button
        className="button phase-control-button"
        type="button"
        disabled={disabled}
        onClick={() => onAdvance(phase)}
      >
        {pendingPhase === phase ? "Starting…" : label}
      </button>
      <p className="phase-control-reason">
        {disabledReason ?? "Available now. The server will re-check before moving."}
      </p>
    </div>
  );
}

function previousPhaseFor(phase: RoomPhase): RoomPhase {
  switch (phase) {
    case "proposals":
      return "input";
    case "deliberation":
      return "proposals";
    case "voting":
      return "deliberation";
    case "approval":
      return "voting";
    case "finalized":
    case "input":
      return "input";
  }
}

function phaseComesBefore(phase: RoomPhase, currentPhase: RoomPhase): boolean {
  return PHASE_ORDER.indexOf(phase) <= PHASE_ORDER.indexOf(currentPhase);
}

function proposalsDisabledReason(
  participants: readonly Participant[],
  participantPositionIds: ReadonlySet<string>,
): string | null {
  const required = participants.filter(
    (participant) =>
      participant.kind === "human" && participant.decisionRole === "decision_maker",
  );
  const unjoined = required.filter((participant) => !participant.isClaimed);
  if (unjoined.length > 0) {
    return `${unjoined.length} required participant${
      unjoined.length === 1 ? "" : "s"
    } still must join.`;
  }

  const withoutPosition = required.filter(
    (participant) => !participantPositionIds.has(participant.id),
  );
  if (withoutPosition.length > 0) {
    return `${withoutPosition.length} required participant${
      withoutPosition.length === 1 ? "" : "s"
    } still must publish a position.`;
  }

  const notReady = required.filter((participant) => !participant.isReady);
  if (notReady.length > 0) {
    return `${notReady.length} required participant${
      notReady.length === 1 ? "" : "s"
    } still must mark input ready.`;
  }

  return null;
}

/** Whether Input has met its one structural precondition for Proposals -- every required decision-maker joined, published, and marked ready. Shared with `useAutoAdvancePhase`, which fires the transition itself once this is true. */
export function proposalsReady(room: RoomState): boolean {
  const participantPositionIds = new Set(
    room.positions.map((position) => position.participantId),
  );
  return proposalsDisabledReason(room.participants, participantPositionIds) === null;
}

/**
 * Entering Decision review (internal phase: `approval`) is policy-neutral
 * and does not require complete Alignment: only a structural, always-true
 * precondition remains — an active proposal, and no unresolved blocking
 * conflict. Alignment may be incomplete; the owner (or, under consensus,
 * each decision-maker) is warned but not blocked by missing alignment.
 */
function approvalDisabledReason(room: {
  activeProposalId: string | null;
  conflicts: readonly { status: string; severity: string }[];
}): string | null {
  if (!room.activeProposalId) return "An active proposal is required first.";

  const blocking = room.conflicts.filter(
    (conflict) => conflict.status === "open" && conflict.severity === "blocking",
  ).length;
  if (blocking > 0) {
    return `${blocking} blocking objection${blocking === 1 ? "" : "s"} must be resolved before decision review.`;
  }

  return null;
}
