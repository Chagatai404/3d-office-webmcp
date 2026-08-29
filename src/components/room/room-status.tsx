"use client";

import { useState } from "react";
import type { ActionResult, Participant, RoomPhase } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import { PHASE_FOCUS, PHASE_LABEL, PHASE_ORDER } from "./room-labels";

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

  const organizer = room.participants[0] ?? null;
  const isOrganizer = Boolean(
    room.demoMode === null && self && organizer && self.id === organizer.id,
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

      <p className="phase-focus">{PHASE_FOCUS[room.phase]}</p>

      {isOrganizer ? (
        <div className="organizer-panel" aria-labelledby="organizer-heading">
          <h3 className="panel-subheading" id="organizer-heading">
            Organizer waiting room
          </h3>

          <ul className="waiting-list">
            {room.participants.map((participant, index) => (
              <li key={participant.id} className="waiting-row">
                <div className="participant-identity">
                  <span className="participant-name">
                    {participant.name}
                    {index === 0 ? <span className="tag">Organizer</span> : null}
                  </span>
                  <span className="participant-role">{participant.role}</span>
                </div>

                <div className="waiting-statuses">
                  <StatusPill
                    label="Invited"
                    active={participant.kind === "human" && index !== 0}
                    muted={participant.kind !== "human" || index === 0}
                  />
                  <StatusPill
                    label="Joined"
                    active={participant.isClaimed}
                  />
                  <StatusPill
                    label="Position published"
                    active={participantPositionIds.has(participant.id)}
                  />
                  <StatusPill label="Ready" active={participant.isReady} />
                </div>
              </li>
            ))}
          </ul>

          <div className="phase-control-group" aria-label="Organizer phase controls">
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
              label="Start voting"
              currentPhase={room.phase}
              pendingPhase={pendingPhase}
              reason={
                blockingConflicts.length === 0
                  ? null
                  : `${blockingConflicts.length} blocking objection${
                      blockingConflicts.length === 1 ? "" : "s"
                    } must be resolved before voting.`
              }
              onAdvance={handlePhaseAdvance}
            />
            <PhaseAdvanceButton
              phase="approval"
              label="Start approval"
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

function StatusPill({
  label,
  active,
  muted = false,
}: {
  label: string;
  active: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={
        active
          ? "status-pill status-pill-active"
          : muted
            ? "status-pill status-pill-muted"
            : "status-pill"
      }
    >
      {label}
    </span>
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
      participant.kind === "human" && participant.requiredForApproval,
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

function approvalDisabledReason(room: {
  activeProposalId: string | null;
  participants: readonly Participant[];
  votes: readonly { participantId: string; proposalId: string }[];
}): string | null {
  if (!room.activeProposalId) return "An active proposal is required first.";

  const missingVotes = room.participants.filter(
    (participant) =>
      participant.kind === "human" &&
      participant.requiredForApproval &&
      !room.votes.some(
        (vote) =>
          vote.participantId === participant.id &&
          vote.proposalId === room.activeProposalId,
      ),
  );

  if (missingVotes.length > 0) {
    return `${missingVotes.length} required participant${
      missingVotes.length === 1 ? "" : "s"
    } still must vote.`;
  }

  return null;
}
