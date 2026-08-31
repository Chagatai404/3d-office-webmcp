"use client";

import { useId, useState, type FormEvent } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { AgentPromptExamples } from "./agent-prompt-examples";
import { ActiveProposalView } from "./decision-shared";
import { useRoom } from "./room-provider";

/**
 * A proposal, as the person making it would say it.
 *
 * The canonical `SubmitProposalInput` has five parts, and the form used to
 * ask for all five up front with a pre-filled scenario in every box — which
 * made proposing look like filling in a record rather than putting an idea on
 * the table. The primary surface is now the idea; title, rationale, outcomes
 * and referenced constraints are optional refinements of the same submission.
 *
 * Nothing is invented on anyone's behalf: where the title and rationale are
 * left alone they are taken from the words the person actually wrote, and the
 * derivation is stated on screen rather than happening quietly.
 */

/** The title defaults to the opening sentence — the person's own words. */
export function deriveProposalTitle(description: string): string {
  const trimmed = description.trim();
  if (trimmed === "") return "";

  const firstLine = trimmed.split(/\r?\n/)[0]!.trim();
  const sentenceEnd = firstLine.search(/[.!?](\s|$)/);
  const candidate = sentenceEnd === -1 ? firstLine : firstLine.slice(0, sentenceEnd);
  const collapsed = candidate.replace(/\s+/g, " ").trim();

  if (collapsed.length <= 120) return collapsed;
  // Cut on a word boundary rather than mid-word, so a long opening sentence
  // still reads as a title.
  const clipped = collapsed.slice(0, 120);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped}…`;
}

export function ProposalsWorkspace() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;

  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [proposalResult, setProposalResult] = useState<ActionResult<unknown> | null>(null);
  const [proposalPending, setProposalPending] = useState(false);

  const derivedTitle = deriveProposalTitle(description);
  const disabled = !self || room.phase !== "proposals" || proposalPending;

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposalPending || !self) return;

    const data = new FormData(event.currentTarget);
    const summaryText = description.trim();
    const explicitTitle = title.trim();
    const explicitRationale = rationale.trim();

    setProposalPending(true);
    const result = await actions.submitProposal({
      title: explicitTitle === "" ? deriveProposalTitle(summaryText) : explicitTitle,
      summary: summaryText,
      // The canonical contract requires a rationale. Where the proposer has
      // not written a separate one, their own description is the rationale —
      // never a sentence this component made up for them.
      rationale: explicitRationale === "" ? summaryText : explicitRationale,
      expectedOutcomes: outcomes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      referencedConstraintIds: data.getAll("constraintIds").map(String),
      parentProposalId: null,
    });
    setProposalPending(false);
    setProposalResult(result);

    if (result.ok) {
      setDescription("");
      setTitle("");
      setRationale("");
      setOutcomes("");
    }
  }

  return (
    <section
      className="panel-block decision-panel"
      aria-labelledby="proposals-heading"
      data-testid="proposals-workspace"
    >
      <h2 className="panel-heading" id="proposals-heading">
        Proposals
      </h2>

      <section className="decision-section" aria-labelledby="active-proposal-heading">
        <h3 className="panel-subheading" id="active-proposal-heading">
          On the table
        </h3>
        <ActiveProposalView room={room} proposal={activeProposal} />
        <p className="panel-note">
          The candidate board reads this same active proposal from the canonical room snapshot.
        </p>
      </section>

      <form
        className="decision-section decision-form"
        data-testid="proposal-form"
        onSubmit={handleProposalSubmit}
      >
        <h3 className="panel-subheading input-question">Describe your proposed option</h3>

        <div className="agent-guide">
          <AgentPromptExamples compact />
        </div>

        <label className="visually-hidden" htmlFor={`${fieldId}-proposal-description`}>
          Describe your proposed option
        </label>
        <textarea
          id={`${fieldId}-proposal-description`}
          name="description"
          className="input-primary-field"
          rows={4}
          required
          disabled={disabled}
          value={description}
          placeholder="What do you think the team should do, and why it is worth doing."
          onChange={(event) => setDescription(event.target.value)}
        />

        <button className="button decision-action" type="submit" disabled={disabled}>
          {proposalPending ? "Proposing…" : "Propose"}
        </button>

        <details className="advanced-fields">
          <summary>Refine this proposal (optional)</summary>

          <div className="advanced-fields-body">
            <label htmlFor={`${fieldId}-proposal-title`}>Short name for this option</label>
            <input
              id={`${fieldId}-proposal-title`}
              name="title"
              disabled={disabled}
              value={title}
              placeholder={derivedTitle === "" ? "Taken from your first sentence" : derivedTitle}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="panel-note">
              {derivedTitle === ""
                ? "Left blank, the name is taken from the first sentence you write above."
                : `Left blank, this option will be called “${derivedTitle}”.`}
            </p>

            <label htmlFor={`${fieldId}-proposal-rationale`}>Why this is the right call</label>
            <textarea
              id={`${fieldId}-proposal-rationale`}
              name="rationale"
              rows={3}
              disabled={disabled}
              value={rationale}
              placeholder="Left blank, your description above stands as the reasoning."
              onChange={(event) => setRationale(event.target.value)}
            />

            <label htmlFor={`${fieldId}-proposal-outcomes`}>
              What you expect to happen, one per line
            </label>
            <textarea
              id={`${fieldId}-proposal-outcomes`}
              name="expectedOutcomes"
              rows={3}
              disabled={disabled}
              value={outcomes}
              onChange={(event) => setOutcomes(event.target.value)}
            />

            {room.constraints.length > 0 ? (
              <>
                <span className="drawer-section-label">Limits this option respects</span>
                <div className="decision-checklist" aria-label="Referenced constraints">
                  {room.constraints.map((constraint) => (
                    <label key={constraint.id} className="decision-check">
                      <input
                        name="constraintIds"
                        type="checkbox"
                        value={constraint.id}
                        disabled={disabled}
                        defaultChecked
                      />
                      <span>
                        {constraint.category}: {constraint.text}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </details>

        {room.phase !== "proposals" ? (
          <p className="panel-note">Proposing opens when the room reaches the Proposals phase.</p>
        ) : null}
        <ActionFeedback result={proposalResult} />
      </form>
    </section>
  );
}
