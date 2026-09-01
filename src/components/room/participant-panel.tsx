"use client";

import { useEffect, useState } from "react";
import type { ActionResult, AssignableDecisionRole } from "@/contracts/room";
import {
  consumeArmedParticipantsRequest,
  getArmedParticipantsRequestSnapshot,
  subscribeToArmedParticipantsRequest,
} from "@/webmcp/confirmation-bridge";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import {
  ALIGNMENT_CHOICE_LABEL,
  DECISION_ROLE_LABEL,
  DECISION_ROLE_NOTE,
  MEETING_ROLE_LABEL,
  PARTICIPANT_KIND_LABEL,
} from "./room-labels";
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
 *
 * Each row says three separate things in three separate places, because they
 * are three separate things: who the person is in the organisation (CEO,
 * CTO), what they may do to the meeting (Owner, Participant), and whether
 * they may decide its outcome (Decision maker, Contributor). None of them is
 * printed as its internal enum value, and the Security Expert's row carries
 * no alignment or approval state at all -- an advisory actor that appears to
 * have an empty approval slot reads as one that could fill it.
 */
export function ParticipantPanel() {
  const { room, self, visualization, actions } = useRoom();
  const { participants } = visualization;
  const isOwner = self?.meetingRole === "owner";

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const openSeats = room.participants.filter(
    (participant) => participant.kind === "human" && participant.status === "active" && !participant.isClaimed,
  ).length;

  const [roleBusyId, setRoleBusyId] = useState<string | null>(null);

  // A `transfer_ownership`/`remove_participant` WebMCP call never performs
  // the mutation itself; it validates the target and arms this exact
  // alertdialog through the confirmation bridge, so the agent can prepare
  // the action but only the human's own click below can confirm it.
  useEffect(() => {
    function consumeRequest() {
      const request = getArmedParticipantsRequestSnapshot();
      if (!request || !isOwner) return;
      const target = participants.find(
        (participant) => participant.id === request.participantId && !participant.isSelf,
      );
      if (target) {
        setResult(null);
        setPending({ type: request.action, participant: target });
      }
      consumeArmedParticipantsRequest();
    }
    const initial = window.setTimeout(consumeRequest, 0);
    const unsubscribe = subscribeToArmedParticipantsRequest(consumeRequest);
    return () => {
      window.clearTimeout(initial);
      unsubscribe();
    };
  }, [isOwner, participants]);

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

  async function changeDecisionRole(participantId: string, decisionRole: AssignableDecisionRole) {
    if (roleBusyId) return;
    setRoleBusyId(participantId);
    const outcome = await actions.setParticipantDecisionRole({ participantId, decisionRole });
    setRoleBusyId(null);
    setResult(outcome);
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
                  ) : participant.meetingRole === "owner" ? (
                    <span className="tag tag-owner">Owner</span>
                  ) : null}
                </span>
                <span className="participant-role">
                  {participant.role}
                  {participant.kind === "simulation" ? ` · ${PARTICIPANT_KIND_LABEL.simulation}` : ""}
                  {participant.kind === "expert" ? ` · ${PARTICIPANT_KIND_LABEL.expert}` : ""}
                </span>
              </div>

              {/* An advisory actor has no administrative or decision
                  authority to state. Printing "Participant · Advisor" beside
                  the Security Expert's name suggests a seat at the table it
                  does not have; the advisory line below says what it is. */}
              {participant.kind === "expert" ? (
                <p className="participant-advisory">
                  Advises the room on the option currently on the table. Never aligns, never
                  approves, and can never hold the meeting.
                </p>
              ) : (
                <>
                  {canManage ? (
                    <label className="decision-role-select">
                      Decision authority
                      <select
                        value={participant.decisionRole === "decision_maker" ? "decision_maker" : "contributor"}
                        disabled={roleBusyId === participant.id}
                        onChange={(event) =>
                          void changeDecisionRole(
                            participant.id,
                            event.target.value as AssignableDecisionRole,
                          )
                        }
                      >
                        <option value="decision_maker">
                          {DECISION_ROLE_LABEL.decision_maker}
                        </option>
                        <option value="contributor">{DECISION_ROLE_LABEL.contributor}</option>
                      </select>
                    </label>
                  ) : (
                    <span
                      className="participant-role"
                      title={DECISION_ROLE_NOTE[participant.decisionRole]}
                    >
                      {MEETING_ROLE_LABEL[participant.meetingRole]} · {DECISION_ROLE_LABEL[participant.decisionRole]}
                    </span>
                  )}
                  <p className="participant-status">
                    {participant.alignment
                      ? `Aligned: ${ALIGNMENT_CHOICE_LABEL[participant.alignment]}`
                      : "Alignment: waiting"}
                    {participant.isRequiredApprover
                      ? ` · ${participant.hasApprovedCurrentDecision ? "Approved" : "Approval not confirmed"}`
                      : ""}
                  </p>
                </>
              )}

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
