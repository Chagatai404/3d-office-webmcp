"use client";

import { useOptionalShell } from "@/components/shell/shell-provider";
import { officeZoneId } from "@/visualization/scene/scene-focus";
import { useRoom } from "./room-provider";
import { PRESENCE_LABEL, VOTE_CHOICE_LABEL } from "./room-labels";

/**
 * Participants and their offices.
 *
 * Separate authority is the point of this panel: every row is one participant,
 * simulated participants are labelled as such, and no control here can act on
 * another participant's behalf.
 */
export function ParticipantPanel() {
  const { visualization } = useRoom();
  // Present only inside the 3D shell, so this panel still renders on its own.
  const shell = useOptionalShell();
  const { participants, officeSlots, constraints } = visualization;

  const constraintCounts = new Map<string, number>();
  for (const constraint of constraints) {
    constraintCounts.set(
      constraint.participantId,
      (constraintCounts.get(constraint.participantId) ?? 0) + 1,
    );
  }

  const reservedCount = officeSlots.filter(
    (slot) => slot.status === "reserved",
  ).length;

  return (
    <section className="panel-block" aria-labelledby="participants-heading">
      <h2 className="panel-heading" id="participants-heading">
        Participants &amp; offices
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

            {shell ? (
              <button
                type="button"
                className="button-quiet participant-visit"
                onClick={() =>
                  shell.visitZone(officeZoneId(participant.officeSlot))
                }
              >
                Visit this office
              </button>
            ) : null}

            <div className="participant-tags">
              <span className="tag">Office {participant.officeSlot + 1}</span>
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
                <dt>Where</dt>
                <dd>{PRESENCE_LABEL[participant.presence]}</dd>
              </div>
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
        {reservedCount} of {officeSlots.length} offices are reserved for
        participants who have not joined yet.
      </p>
    </section>
  );
}
