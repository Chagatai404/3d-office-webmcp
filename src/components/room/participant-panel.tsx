"use client";

import { useState } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import { VOTE_CHOICE_LABEL } from "./room-labels";
import type { VisualParticipant } from "@/visualization/room-view-model";

type PendingAction =
  | { type: "remove"; participant: VisualParticipant }
  | { type: "transfer"; participant: VisualParticipant };

/**
 * Participants and their seats at the one shared table.
 *
 * Separate authority is the point of this panel: every row is one
 * participant, simulated participants are labelled as such, and no control
 * here can act on another participant's behalf. Owner-only membership
 * controls (remove / make owner) are rendered inline, only for the current
 * owner, and never on the owner's own row -- a non-owner never sees them at
 * all rather than seeing them disabled.
 */
export function ParticipantPanel() {
  const { room, self, visualization, actions } = useRoom();
  const { participants, constraints } = visualization;
  const isOwner = self?.meetingRole === "owner";

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const constraintCounts = new Map<string, number>();
  for (const constraint of constraints) {
    constraintCounts.set(
      constraint.participantId,
      (constraintCounts.get(constraint.participantId) ?? 0) + 1,
    );
  }

  const openSeats = room.participants.filter(
    (participant) => participant.kind === "human" && participant.status === "active" && !participant.isClaimed,
  ).length;

  async function confirmPending() {
    if (!pending || busy) return;
    setBusy(true);
    const outcome =
      pending.type === "remove"
        ? await actions.removeParticipant({ participantId: pending.participant.id })
        : await actions.transferOwnership({ participantId: pending.participant.id });
    setBusy(false);
    setResult(outcome);
    if (outcome.ok) setPending(null);
  }

  return (
    <section className="panel-block" aria-labelledby="participants-heading">
      <h2 className="panel-heading" id="participants-heading">
        Participants
      </h2>

      <ul className="participant-list">
        {participants.map((participant) => {
          const canManage =
            isOwner && !participant.isSelf && participant.kind === "human";

          return (
            <li
              key={participant.id}
              className={
                participant.isSelf
                  ? "participant-row participant-row-self"
                  : "participant-row"
              }
            >
              <div className="participant-identity">
                <span className="participant-name">
                  {participant.name}
                  {participant.isSelf ? (
                    <span className="tag tag-self">You</span>
                  ) : null}
                  {participant.meetingRole === "owner" ? (
                    <span className="tag tag-owner">Owner</span>
                  ) : null}
                </span>
                <span className="participant-role">{participant.role}</span>
              </div>

              <div className="participant-tags">
                <span className="tag">Seat {participant.seatIndex + 1}</span>
                {participant.kind === "simulation" ? (
                  <span className="tag tag-simulation">Simulated participant</span>
                ) : (
                  <span className="tag">Human</span>
                )}
                {participant.decisionRole === "decision_maker" ? (
                  <span className="tag">Decision maker</span>
                ) : (
                  <span className="tag tag-muted">{participant.decisionRole}</span>
                )}
              </div>

              <dl className="participant-state">
                <div>
                  <dt>Constraints</dt>
                  <dd>{constraintCounts.get(participant.id) ?? 0}</dd>
                </div>
                <div>
                  <dt>Vote</dt>
                  <dd>
                    {participant.vote
                      ? VOTE_CHOICE_LABEL[participant.vote]
                      : "Not cast"}
                  </dd>
                </div>
                <div>
                  <dt>Approval</dt>
                  <dd>
                    {participant.hasApprovedCurrentDecision
                      ? "Approved"
                      : "Not approved"}
                  </dd>
                </div>
              </dl>

              {canManage ? (
                <div className="participant-owner-controls">
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => {
                      setResult(null);
                      setPending({ type: "remove", participant });
                    }}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="button-quiet"
                    onClick={() => {
                      setResult(null);
                      setPending({ type: "transfer", participant });
                    }}
                  >
                    Make owner
                  </button>
                </div>
              ) : null}

              {pending && pending.participant.id === participant.id ? (
                <div className="participant-confirm" role="alertdialog">
                  <p>
                    {pending.type === "remove"
                      ? `Remove ${participant.name} from this meeting?`
                      : `Make ${participant.name} the meeting owner? You will lose owner-only controls.`}
                  </p>
                  <div className="drawer-actions">
                    <button
                      type="button"
                      className="button-quiet"
                      disabled={busy}
                      onClick={() => setPending(null)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void confirmPending()}
                    >
                      {pending.type === "remove" ? "Remove" : "Confirm"}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ActionFeedback result={result} />

      <p className="panel-note">
        {openSeats === 0
          ? "Every seat is claimed."
          : `${openSeats} human seat${openSeats === 1 ? "" : "s"} still open for someone to join.`}
      </p>
    </section>
  );
}
