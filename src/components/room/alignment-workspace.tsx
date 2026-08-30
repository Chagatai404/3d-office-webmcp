"use client";

import { useState } from "react";
import type { ActionResult, Alignment, AlignmentChoice, RoomState } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { DecisionList } from "./decision-shared";
import { useRoom } from "./room-provider";
import { ALIGNMENT_CHOICE_GLYPH, ALIGNMENT_CHOICE_LABEL } from "./room-labels";

const ALIGNMENT_CHOICES: readonly AlignmentChoice[] = [
  "support",
  "concern",
  "strong_objection",
  "needs_clarification",
];

/**
 * The Alignment workspace.
 *
 * Alignment replaces Vote as the canonical decision-informing signal. It is
 * deliberately not a poll: there is no percentage, no "winner", and nothing
 * here implies that three "Support" choices outweigh one "Strong objection".
 * It exists so the responsible decision authority can see support, concerns,
 * strong objections, and missing perspectives before acting — see the Decision
 * workspace for how each `DecisionPolicy` actually uses this information.
 */
export function AlignmentWorkspace() {
  const { room, self, actions } = useRoom();
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;
  const selfAlignment =
    self && activeProposal
      ? room.alignments.find(
          (alignment) => alignment.participantId === self.id && alignment.proposalId === activeProposal.id,
        ) ?? null
      : null;

  const [comment, setComment] = useState("");
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pendingChoice, setPendingChoice] = useState<AlignmentChoice | null>(null);

  const disabled = !self || room.phase !== "voting" || !activeProposal || pendingChoice !== null;

  async function share(choice: AlignmentChoice) {
    if (disabled || !activeProposal) return;
    setPendingChoice(choice);
    const trimmed = comment.trim();
    const outcome = await actions.expressMyAlignment({
      proposalId: activeProposal.id,
      choice,
      comment: trimmed === "" ? null : trimmed,
    });
    setPendingChoice(null);
    setResult(outcome);
  }

  const activeHumans = room.participants.filter(
    (participant) => participant.status === "active" && participant.kind === "human",
  );
  const alignmentsForActive = activeProposal
    ? room.alignments.filter((alignment) => alignment.proposalId === activeProposal.id)
    : [];
  const alignmentByParticipant = new Map(
    alignmentsForActive.map((alignment) => [alignment.participantId, alignment]),
  );

  const isOwner = Boolean(
    room.demoMode === null && self?.id === room.ownerParticipantId && self.meetingRole === "owner",
  );

  return (
    <section
      className="panel-block decision-panel"
      aria-labelledby="alignment-heading"
      data-testid="alignment-workspace"
    >
      <h2 className="panel-heading" id="alignment-heading">
        Alignment
      </h2>

      <div className="decision-section" data-testid="alignment-form">
        <p className="panel-subheading">How do you feel about this direction?</p>
        {selfAlignment ? (
          <p className="decision-current">
            Your current alignment: {ALIGNMENT_CHOICE_LABEL[selfAlignment.choice]}
            {selfAlignment.comment ? ` — ${selfAlignment.comment}` : ""}
          </p>
        ) : null}
        <div className="alignment-choice-group" role="group" aria-label="Your alignment">
          {ALIGNMENT_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              className={
                selfAlignment?.choice === choice
                  ? "button alignment-choice alignment-choice-active"
                  : "button-quiet alignment-choice"
              }
              disabled={disabled}
              onClick={() => void share(choice)}
              data-testid={`alignment-choice-${choice}`}
            >
              <span aria-hidden="true">{ALIGNMENT_CHOICE_GLYPH[choice]}</span> {ALIGNMENT_CHOICE_LABEL[choice]}
            </button>
          ))}
        </div>
        <label htmlFor="alignment-comment">Optional note</label>
        <input
          id="alignment-comment"
          value={comment}
          disabled={disabled}
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="panel-note">
          Sharing alignment tells the responsible decision authority how you feel. It is not a vote — it does
          not by itself decide anything, and a strong objection is never outweighed by a count of supporters.
        </p>
        <ActionFeedback result={result} />
      </div>

      <div className="decision-section" aria-labelledby="alignment-summary-heading" data-testid="alignment-summary">
        <h3 className="panel-subheading" id="alignment-summary-heading">
          Team alignment
        </h3>
        <ul className="participant-list">
          {activeHumans.map((participant) => {
            const entry = alignmentByParticipant.get(participant.id);
            return (
              <li key={participant.id} className="participant-row">
                <div className="participant-identity">
                  <span className="participant-name">{participant.name}</span>
                  <span className="participant-role">{participant.role}</span>
                </div>
                <span className={entry ? "tag" : "tag tag-muted"}>
                  {entry ? ALIGNMENT_CHOICE_LABEL[entry.choice] : "Not shared yet"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {isOwner ? (
        <OwnerAlignmentSummary
          room={room}
          hasActiveProposal={Boolean(activeProposal)}
          alignments={alignmentsForActive}
          activeHumanCount={activeHumans.length}
        />
      ) : null}
    </section>
  );
}

/**
 * The owner's immediately understandable summary: who supports, who has
 * concerns, who objects strongly, who has not responded, and any unresolved
 * blocking domain conflicts. This never says "Winner", "Majority", or
 * "Passed vote" — the owner remains the explicit final authority.
 */
function OwnerAlignmentSummary({
  room,
  hasActiveProposal,
  alignments,
  activeHumanCount,
}: {
  room: RoomState;
  hasActiveProposal: boolean;
  alignments: readonly Alignment[];
  activeHumanCount: number;
}) {
  const { actions } = useRoom();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const counts = { support: 0, concern: 0, strong_objection: 0, needs_clarification: 0 };
  for (const alignment of alignments) counts[alignment.choice] += 1;
  const notSharedCount = Math.max(0, activeHumanCount - alignments.length);

  const openConcerns = alignments
    .filter((alignment) => alignment.choice === "concern" || alignment.choice === "strong_objection")
    .map((alignment) => {
      const participant = room.participants.find((candidate) => candidate.id === alignment.participantId);
      const label = participant ? `${participant.name} (${participant.role})` : alignment.participantId;
      return `${label}: ${alignment.comment ?? ALIGNMENT_CHOICE_LABEL[alignment.choice]}`;
    });

  const blockingConflicts = room.conflicts.filter(
    (conflict) => conflict.status === "open" && conflict.severity === "blocking",
  );
  const canReview = hasActiveProposal && blockingConflicts.length === 0 && room.phase === "voting";

  async function reviewDecision() {
    if (!canReview || pending) return;
    setPending(true);
    const outcome = await actions.advanceRoomPhase("approval");
    setPending(false);
    setResult(outcome);
  }

  return (
    <div className="decision-section organizer-panel" data-testid="owner-alignment-summary">
      <h3 className="panel-subheading">Alignment</h3>
      <dl className="decision-facts">
        <div>
          <dt>Support</dt>
          <dd>{counts.support}</dd>
        </div>
        <div>
          <dt>Concern</dt>
          <dd>{counts.concern}</dd>
        </div>
        <div>
          <dt>Strong objection</dt>
          <dd>{counts.strong_objection}</dd>
        </div>
        <div>
          <dt>Not shared</dt>
          <dd>{notSharedCount}</dd>
        </div>
      </dl>
      <DecisionList title="Open concerns" entries={openConcerns} empty="No concerns or objections shared." />
      {notSharedCount > 0 ? (
        <p className="panel-note">
          {notSharedCount} participant{notSharedCount === 1 ? " has" : "s have"} not shared alignment. You may
          still continue — alignment is informative, not a requirement to proceed.
        </p>
      ) : null}
      {blockingConflicts.length > 0 ? (
        <p className="panel-note">
          {blockingConflicts.length} blocking issue{blockingConflicts.length === 1 ? "" : "s"} must be
          resolved before decision review.
        </p>
      ) : null}
      <div className="phase-control-group" aria-label="Owner alignment actions">
        <button type="button" className="button-quiet" disabled>
          Continue deliberation
        </button>
        <button
          type="button"
          className="button decision-action"
          disabled={!canReview || pending}
          onClick={() => void reviewDecision()}
          data-testid="review-decision"
        >
          {pending ? "Opening review…" : "Review decision"}
        </button>
      </div>
      <ActionFeedback result={result} />
    </div>
  );
}
