"use client";

import { useId, useState, type FormEvent } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { ActiveProposalView, PROPOSAL_DRAFT } from "./decision-shared";
import { useRoom } from "./room-provider";

/** The Proposals workspace: candidate plans and revisions. */
export function ProposalsWorkspace() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;

  const [proposalResult, setProposalResult] = useState<ActionResult<unknown> | null>(null);
  const [proposalPending, setProposalPending] = useState(false);

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposalPending || !self) return;

    const data = new FormData(event.currentTarget);
    setProposalPending(true);
    const result = await actions.submitProposal({
      title: String(data.get("title")).trim(),
      summary: String(data.get("summary")).trim(),
      rationale: String(data.get("rationale")).trim(),
      expectedOutcomes: String(data.get("expectedOutcomes"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      referencedConstraintIds: data.getAll("constraintIds").map(String),
      parentProposalId: null,
    });
    setProposalPending(false);
    setProposalResult(result);
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
          Active proposal
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
        <h3 className="panel-subheading">Submit a proposal</h3>
        <fieldset disabled={!self || room.phase !== "proposals" || proposalPending}>
          <label htmlFor={`${fieldId}-proposal-title`}>Proposal title</label>
          <input
            id={`${fieldId}-proposal-title`}
            name="title"
            required
            defaultValue={PROPOSAL_DRAFT.title}
          />

          <label htmlFor={`${fieldId}-proposal-summary`}>Summary</label>
          <textarea
            id={`${fieldId}-proposal-summary`}
            name="summary"
            rows={3}
            required
            defaultValue={PROPOSAL_DRAFT.summary}
          />

          <label htmlFor={`${fieldId}-proposal-rationale`}>Rationale</label>
          <textarea
            id={`${fieldId}-proposal-rationale`}
            name="rationale"
            rows={3}
            required
            defaultValue={PROPOSAL_DRAFT.rationale}
          />

          <label htmlFor={`${fieldId}-proposal-outcomes`}>
            Expected outcomes, one per line
          </label>
          <textarea
            id={`${fieldId}-proposal-outcomes`}
            name="expectedOutcomes"
            rows={3}
            required
            defaultValue={PROPOSAL_DRAFT.expectedOutcomes}
          />

          <div className="decision-checklist" aria-label="Referenced constraints">
            {room.constraints.map((constraint) => (
              <label key={constraint.id} className="decision-check">
                <input name="constraintIds" type="checkbox" value={constraint.id} defaultChecked />
                <span>
                  {constraint.category}: {constraint.text}
                </span>
              </label>
            ))}
          </div>

          <button className="button decision-action" type="submit">
            {proposalPending ? "Submitting..." : "Submit proposal"}
          </button>
        </fieldset>
        {room.phase !== "proposals" ? (
          <p className="panel-note">Proposal submission opens in the proposals phase.</p>
        ) : null}
        <ActionFeedback result={proposalResult} />
      </form>
    </section>
  );
}
