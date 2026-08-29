"use client";

import { useState, type FormEvent } from "react";
import type { ActionResult, VoteChoice } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import { VOTE_CHOICE_LABEL } from "./room-labels";

const VOTE_CHOICES: readonly VoteChoice[] = ["support", "oppose", "abstain", "request_changes"];

/**
 * The Vote workspace.
 *
 * A vote is a participant's own position on the active candidate. It is
 * explicitly not final approval — that is a separate, more deliberate act on
 * the Decision workspace, per the product's voting-vs-approval invariant.
 */
export function VoteWorkspace() {
  const { room, self, actions } = useRoom();
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;
  const selfVote =
    self && activeProposal
      ? room.votes.find((vote) => vote.participantId === self.id && vote.proposalId === activeProposal.id) ?? null
      : null;

  const [voteChoice, setVoteChoice] = useState<VoteChoice>("support");
  const [voteResult, setVoteResult] = useState<ActionResult<unknown> | null>(null);
  const [votePending, setVotePending] = useState(false);

  async function handleVoteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (votePending || !activeProposal || !self) return;

    const data = new FormData(event.currentTarget);
    const comment = String(data.get("comment") ?? "").trim();
    setVotePending(true);
    const result = await actions.castMyVote({
      proposalId: activeProposal.id,
      choice: voteChoice,
      comment: comment === "" ? null : comment,
    });
    setVotePending(false);
    setVoteResult(result);
  }

  return (
    <section className="panel-block decision-panel" aria-labelledby="vote-heading" data-testid="vote-workspace">
      <h2 className="panel-heading" id="vote-heading">
        Vote
      </h2>

      <form className="decision-section decision-form" data-testid="vote-form" onSubmit={handleVoteSubmit}>
        {selfVote ? (
          <p className="decision-current">
            Your current vote: {VOTE_CHOICE_LABEL[selfVote.choice]}
            {selfVote.comment ? ` - ${selfVote.comment}` : ""}
          </p>
        ) : null}
        <fieldset disabled={!self || room.phase !== "voting" || !activeProposal || votePending}>
          <label htmlFor="vote-choice">Your vote for the active proposal</label>
          <select
            id="vote-choice"
            name="choice"
            value={voteChoice}
            onChange={(event) => setVoteChoice(event.target.value as VoteChoice)}
          >
            {VOTE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {VOTE_CHOICE_LABEL[choice]}
              </option>
            ))}
          </select>

          <label htmlFor="vote-comment">Comment</label>
          <input id="vote-comment" name="comment" />

          <button className="button decision-action" type="submit">
            {votePending ? "Recording..." : "Record my vote"}
          </button>
        </fieldset>
        <p className="panel-note">
          Your vote records your position on the proposal. It is not final approval — that happens on
          the Decision workspace, separately, for your own identity only.
        </p>
        <ActionFeedback result={voteResult} />
      </form>
    </section>
  );
}
