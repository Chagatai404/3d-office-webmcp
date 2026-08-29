"use client";

import { useRoom } from "./room-provider";
import { VOTE_CHOICE_LABEL } from "./room-labels";

/**
 * Participants and their seats at the one shared table.
 *
 * Separate authority is the point of this panel: every row is one
 * participant, simulated participants are labelled as such, and no control
 * here can act on another participant's behalf.
 */
export function ParticipantPanel() {
  const { room, visualization } = useRoom();
  const { participants, constraints } = visualization;

  const constraintCounts = new Map<string, number>();
  for (const constraint of constraints) {
    constraintCounts.set(
      constraint.participantId,
      (constraintCounts.get(constraint.participantId) ?? 0) + 1,
    );
  }

  const openSeats = room.participants.filter(
    (participant) => participant.kind === "human" && !participant.isClaimed,
  ).length;

  return (
    <section className="panel-block" aria-labelledby="participants-heading">
      <h2 className="panel-heading" id="participants-heading">
        Participants
      </h2>

      <ul className="participant-list">
        {participants.map((participant) => (
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
              {participant.requiredForApproval ? (
                <span className="tag">Approval required</span>
              ) : (
                <span className="tag tag-muted">Not an approver</span>
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
          </li>
        ))}
      </ul>

      <p className="panel-note">
        {openSeats === 0
          ? "Every seat is claimed."
          : `${openSeats} human seat${openSeats === 1 ? "" : "s"} still open for someone to join.`}
      </p>
    </section>
  );
}
