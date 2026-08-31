"use client";

import { useState } from "react";
import type { ActionResult, Participant, RoomPhase } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { CoordinationStatus } from "./coordination-status";
import { useRoom } from "./room-provider";
import { PHASE_LABEL, PHASE_ORDER } from "./room-labels";

/**
 * Where the room is in its six phases, and who you are inside it.
 *
 * The HUD carries the short version permanently; this is the full rail, for
 * when someone wants to see the whole sequence rather than the current step.
 */
export function RoomStatusPanel() {
  const { room, self, actions } = useRoom();
  const [pendingPhase, setPendingPhase] = useState<RoomPhase | null>(null);
  const [phaseResult, setPhaseResult] = useState<ActionResult<unknown> | null>(
    null,
  );

  const isOwner = Boolean(
    self?.id === room.ownerParticipantId && self.meetingRole === "owner",
  );
  const participantPositionIds = new Set(
    room.positions.map((position) => position.participantId),
  );
  const blockingConflicts = room.conflicts.filter(
    (conflict) => conflict.status === "open" && conflict.severity === "blocking",
  );

  async function handlePhaseAdvance(phase: RoomPhase) {
    if (pendingPhase) return;

    setPendingPhase(phase);
    const result = await actions.advanceRoomPhase(phase);
    setPendingPhase(null);
    setPhaseResult(result);
  }

  return (
    <section className="panel-block" aria-labelledby="status-heading">
      <h2 className="panel-heading" id="status-heading">
        Phase &amp; room status
      </h2>

      <dl className="room-facts">
        <div>
          <dt>You are</dt>
          <dd>
            {self ? (
              <>
                {self.name}
                <span className="room-facts-sub">{self.role}</span>
              </>
            ) : (
              <>
                Observing
                <span className="room-facts-sub">No seat claimed</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Room version</dt>
          <dd>
            {room.version}
            <span className="room-facts-sub">Server authoritative</span>
          </dd>
        </div>
      </dl>

      <ol className="phase-rail" aria-label="Room phase">
        {PHASE_ORDER.map((phase) => {
          const isCurrent = phase === room.phase;
          return (
            <li
              key={phase}
              className={isCurrent ? "phase-step phase-step-current" : "phase-step"}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="phase-step-name">{PHASE_LABEL[phase]}</span>
              {isCurrent ? (
                <span className="visually-hidden"> (current phase)</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* The same coordination story the protocol tells, for everyone in the
          room rather than the owner alone: a contributor should never have to
          ask the owner who the room is waiting for. */}
      <CoordinationStatus />

      {isOwner ? (
        <div className="organizer-panel" aria-labelledby="organizer-heading">
          <h3 className="panel-subheading" id="organizer-heading">
            Owner phase controls
          </h3>

          <div className="phase-control-group" aria-label="Owner phase controls">
            <PhaseAdvanceButton
              phase="proposals"
              label="Start proposals"
              currentPhase={room.phase}
              pendingPhase={pendingPhase}
              reason={proposalsDisabledReason(room.participants, participantPositionIds)}
              onAdvance={handlePhaseAdvance}
            />
            <PhaseAdvanceButton
              phase="deliberation"
              label="Start deliberation"
              currentPhase={room.phase}
              pendingPhase={pendingPhase}
              reason={
                room.activeProposalId
                  ? null
                  : "Choose or publish an active proposal before deliberation."
              }
              onAdvance={handlePhaseAdvance}
            />
            <PhaseAdvanceButton
              phase="voting"
              label="Open Alignment"
              currentPhase={room.phase}
              pendingPhase={pendingPhase}
              reason={
                blockingConflicts.length === 0
                  ? null
                  : `${blockingConflicts.length} blocking objection${
                      blockingConflicts.length === 1 ? "" : "s"
                    } must be resolved before Alignment.`
              }
              onAdvance={handlePhaseAdvance}
            />
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
      ) : null}
    </section>
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
