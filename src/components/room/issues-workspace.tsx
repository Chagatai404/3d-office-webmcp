"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import type { ActionResult, Conflict } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { ConflictList, TRADEOFF_DRAFT } from "./decision-shared";
import { useRoom } from "./room-provider";

/** The Issues workspace: objections, trade-offs, and explicit resolution. */
export function IssuesWorkspace() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;
  const openConflicts = useMemo(
    () => room.conflicts.filter((conflict) => conflict.status === "open"),
    [room.conflicts],
  );
  const openConflictIds = useMemo(() => openConflicts.map((conflict) => conflict.id), [openConflicts]);
  const blockingOpenCount = openConflicts.filter((conflict) => conflict.severity === "blocking").length;

  const [objectionResult, setObjectionResult] = useState<ActionResult<unknown> | null>(null);
  const [tradeoffResult, setTradeoffResult] = useState<ActionResult<unknown> | null>(null);
  const [resolutionResult, setResolutionResult] = useState<ActionResult<unknown> | null>(null);

  const [objectionPending, setObjectionPending] = useState(false);
  const [tradeoffPending, setTradeoffPending] = useState(false);
  const [resolutionPendingId, setResolutionPendingId] = useState<string | null>(null);

  const [excludedConflictIds, setExcludedConflictIds] = useState<string[]>([]);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  const selectedConflictIds = openConflictIds.filter((id) => !excludedConflictIds.includes(id));
  const revisedConstraintIds = useMemo(
    () =>
      activeProposal && activeProposal.referencedConstraintIds.length > 0
        ? activeProposal.referencedConstraintIds
        : room.constraints.map((constraint) => constraint.id),
    [activeProposal, room.constraints],
  );

  async function handleObjectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (objectionPending || !activeProposal || !self) return;

    const data = new FormData(event.currentTarget);
    const constraintId = String(data.get("constraintId") ?? "");
    setObjectionPending(true);
    const result = await actions.raiseObjection({
      proposalId: activeProposal.id,
      constraintId: constraintId === "" ? null : constraintId,
      reason: String(data.get("reason")).trim(),
      severity: String(data.get("severity")) as Conflict["severity"],
    });
    setObjectionPending(false);
    setObjectionResult(result);
  }

  async function handleTradeoffSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tradeoffPending || !activeProposal || !self || selectedConflictIds.length === 0) return;

    const data = new FormData(event.currentTarget);
    setTradeoffPending(true);
    const result = await actions.proposeTradeoff({
      conflictIds: selectedConflictIds,
      description: String(data.get("description")).trim(),
      expectedEffect: String(data.get("expectedEffect")).trim(),
      revisedProposal: {
        title: String(data.get("revisedTitle")).trim(),
        summary: String(data.get("revisedSummary")).trim(),
        rationale: String(data.get("revisedRationale")).trim(),
        expectedOutcomes: String(data.get("revisedOutcomes"))
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        referencedConstraintIds: revisedConstraintIds,
      },
    });
    setTradeoffPending(false);
    setTradeoffResult(result);
  }

  async function handleResolve(conflictId: string) {
    const resolutionNote = resolutionNotes[conflictId]?.trim() ?? "";
    if (resolutionPendingId || !self || resolutionNote === "") return;

    setResolutionPendingId(conflictId);
    const result = await actions.resolveObjection({ conflictId, resolutionNote });
    setResolutionPendingId(null);
    setResolutionResult(result);
  }

  return (
    <section
      className="panel-block decision-panel"
      aria-labelledby="issues-heading"
      data-testid="issues-workspace"
    >
      <h2 className="panel-heading" id="issues-heading">
        Issues
      </h2>
      <p className="panel-note">
        Blocking objections open: {blockingOpenCount}. Alignment cannot open until they are settled.
      </p>

      <form
        className="decision-section decision-form"
        data-testid="objection-form"
        onSubmit={handleObjectionSubmit}
      >
        <h3 className="panel-subheading">Objections</h3>
        <ConflictList room={room} conflicts={openConflicts} />
        <fieldset disabled={!self || room.phase !== "deliberation" || !activeProposal || objectionPending}>
          <label htmlFor={`${fieldId}-objection-constraint`}>Related constraint</label>
          <select id={`${fieldId}-objection-constraint`} name="constraintId">
            <option value="">No single constraint</option>
            {room.constraints.map((constraint) => (
              <option key={constraint.id} value={constraint.id}>
                {constraint.category}: {constraint.text}
              </option>
            ))}
          </select>

          <label htmlFor={`${fieldId}-objection-severity`}>Severity</label>
          <select id={`${fieldId}-objection-severity`} name="severity" defaultValue="blocking">
            <option value="blocking">Blocking</option>
            <option value="warning">Warning</option>
          </select>

          <label htmlFor={`${fieldId}-objection-reason`}>Reason</label>
          <textarea id={`${fieldId}-objection-reason`} name="reason" rows={3} required />

          <button className="button decision-action" type="submit">
            {objectionPending ? "Raising..." : "Raise objection"}
          </button>
        </fieldset>
        {room.phase === "deliberation" && !activeProposal ? (
          <p className="panel-note">An active proposal is required before objections can be raised.</p>
        ) : null}
        <ActionFeedback result={objectionResult} />
      </form>

      <form
        className="decision-section decision-form"
        data-testid="tradeoff-form"
        onSubmit={handleTradeoffSubmit}
      >
        <h3 className="panel-subheading">Tradeoff and revision</h3>
        <fieldset
          disabled={
            !self ||
            room.phase !== "deliberation" ||
            !activeProposal ||
            openConflicts.length === 0 ||
            tradeoffPending
          }
        >
          <div className="decision-checklist" aria-label="Conflicts addressed by this tradeoff">
            {openConflicts.map((conflict) => (
              <label key={conflict.id} className="decision-check">
                <input
                  type="checkbox"
                  checked={selectedConflictIds.includes(conflict.id)}
                  onChange={(event) =>
                    setExcludedConflictIds((current) =>
                      event.target.checked
                        ? current.filter((id) => id !== conflict.id)
                        : [...current, conflict.id],
                    )
                  }
                />
                <span>
                  {conflict.severity}: {conflict.reason}
                </span>
              </label>
            ))}
          </div>

          <label htmlFor={`${fieldId}-tradeoff-description`}>Tradeoff</label>
          <textarea
            id={`${fieldId}-tradeoff-description`}
            name="description"
            rows={3}
            required
            defaultValue={TRADEOFF_DRAFT.description}
          />

          <label htmlFor={`${fieldId}-tradeoff-effect`}>Expected effect</label>
          <textarea
            id={`${fieldId}-tradeoff-effect`}
            name="expectedEffect"
            rows={3}
            required
            defaultValue={TRADEOFF_DRAFT.expectedEffect}
          />

          <label htmlFor={`${fieldId}-revised-title`}>Revised proposal title</label>
          <input
            id={`${fieldId}-revised-title`}
            name="revisedTitle"
            required
            defaultValue={activeProposal?.title ?? ""}
          />

          <label htmlFor={`${fieldId}-revised-summary`}>Revised summary</label>
          <textarea
            id={`${fieldId}-revised-summary`}
            name="revisedSummary"
            rows={3}
            required
            defaultValue={activeProposal?.summary ?? ""}
          />

          <label htmlFor={`${fieldId}-revised-rationale`}>Revised rationale</label>
          <textarea
            id={`${fieldId}-revised-rationale`}
            name="revisedRationale"
            rows={3}
            required
            defaultValue={activeProposal?.rationale ?? ""}
          />

          <label htmlFor={`${fieldId}-revised-outcomes`}>
            Revised expected outcomes, one per line
          </label>
          <textarea
            id={`${fieldId}-revised-outcomes`}
            name="revisedOutcomes"
            rows={3}
            required
            defaultValue={activeProposal?.expectedOutcomes.join("\n") ?? ""}
          />

          <button
            className="button decision-action"
            type="submit"
            disabled={selectedConflictIds.length === 0}
          >
            {tradeoffPending ? "Proposing..." : "Propose tradeoff with revised proposal"}
          </button>
        </fieldset>
        {openConflicts.length === 0 ? (
          <p className="panel-note">
            A tradeoff can revise the proposal, but it does not resolve an objection by itself.
          </p>
        ) : null}
        <ActionFeedback result={tradeoffResult} />
      </form>

      <section
        className="decision-section"
        aria-labelledby="resolution-heading"
        data-testid="resolution-panel"
      >
        <h3 className="panel-subheading" id="resolution-heading">
          Explicit objection resolution
        </h3>
        {openConflicts.length === 0 ? (
          <p className="panel-empty">No open objections need resolution.</p>
        ) : (
          <ul className="decision-list">
            {openConflicts.map((conflict) => (
              <li key={conflict.id} className="decision-list-item">
                <span className={`tag ${conflict.severity === "blocking" ? "tag-risk" : ""}`}>
                  {conflict.status} {conflict.severity}
                </span>
                <p>{conflict.reason}</p>
                <label htmlFor={`${fieldId}-${conflict.id}-resolution`}>Resolution note</label>
                <textarea
                  id={`${fieldId}-${conflict.id}-resolution`}
                  rows={2}
                  value={resolutionNotes[conflict.id] ?? ""}
                  onChange={(event) =>
                    setResolutionNotes((current) => ({
                      ...current,
                      [conflict.id]: event.target.value,
                    }))
                  }
                />
                <button
                  className="button-quiet"
                  type="button"
                  disabled={
                    !self ||
                    room.phase !== "deliberation" ||
                    resolutionPendingId !== null ||
                    (resolutionNotes[conflict.id]?.trim() ?? "") === ""
                  }
                  onClick={() => void handleResolve(conflict.id)}
                >
                  {resolutionPendingId === conflict.id ? "Resolving..." : "Resolve explicitly"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <ActionFeedback result={resolutionResult} />
      </section>
    </section>
  );
}
