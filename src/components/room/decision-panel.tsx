"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import type {
  ActionResult,
  Conflict,
  DecisionRecord,
  FinalDecisionPreview,
  Proposal,
  RoomState,
  VoteChoice,
} from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";
import { formatActionName, formatTime, VOTE_CHOICE_LABEL } from "./room-labels";

const PROPOSAL_DRAFT = {
  title: "Two-week accessible onboarding scope",
  summary:
    "Ship a narrower onboarding update that improves time to first value while keeping accessibility review in scope.",
  rationale:
    "This meets the launch goal without expanding engineering capacity or weakening design quality.",
  expectedOutcomes:
    "New users reach first value faster\nAccessibility review is completed before release\nCampaign timing remains credible",
};

const TRADEOFF_DRAFT = {
  description:
    "Keep accessibility review in scope and reduce the first release to the highest-impact onboarding step.",
  expectedEffect:
    "Resolves the blocking concern while preserving the two-week delivery window.",
};

const VOTE_CHOICES: readonly VoteChoice[] = [
  "support",
  "oppose",
  "abstain",
  "request_changes",
];

function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function participantLabel(room: RoomState, participantId: string | null): string {
  if (!participantId) return "Unassigned";
  const participant = room.participants.find((candidate) => candidate.id === participantId);
  return participant ? `${participant.role} - ${participant.name}` : participantId;
}

function proposalLabel(room: RoomState, proposalId: string | null): string {
  if (!proposalId) return "Original proposal";
  return room.proposals.find((proposal) => proposal.id === proposalId)?.title ?? proposalId;
}

export function DecisionPanel() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();
  const activeProposal = room.proposals.find(
    (proposal) => proposal.id === room.activeProposalId,
  ) ?? null;
  const openConflicts = useMemo(
    () => room.conflicts.filter((conflict) => conflict.status === "open"),
    [room.conflicts],
  );
  const openConflictIds = useMemo(
    () => openConflicts.map((conflict) => conflict.id),
    [openConflicts],
  );
  const blockingOpenCount = openConflicts.filter(
    (conflict) => conflict.severity === "blocking",
  ).length;
  const selfVote = self && activeProposal
    ? room.votes.find(
        (vote) =>
          vote.participantId === self.id && vote.proposalId === activeProposal.id,
      ) ?? null
    : null;

  const [proposalResult, setProposalResult] =
    useState<ActionResult<unknown> | null>(null);
  const [objectionResult, setObjectionResult] =
    useState<ActionResult<unknown> | null>(null);
  const [tradeoffResult, setTradeoffResult] =
    useState<ActionResult<unknown> | null>(null);
  const [resolutionResult, setResolutionResult] =
    useState<ActionResult<unknown> | null>(null);
  const [voteResult, setVoteResult] =
    useState<ActionResult<unknown> | null>(null);
  const [previewResult, setPreviewResult] =
    useState<ActionResult<FinalDecisionPreview> | null>(null);
  const [approvalResult, setApprovalResult] =
    useState<ActionResult<unknown> | null>(null);
  const [recordResult, setRecordResult] =
    useState<ActionResult<DecisionRecord> | null>(null);

  const [proposalPending, setProposalPending] = useState(false);
  const [objectionPending, setObjectionPending] = useState(false);
  const [tradeoffPending, setTradeoffPending] = useState(false);
  const [resolutionPendingId, setResolutionPendingId] = useState<string | null>(null);
  const [votePending, setVotePending] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [recordPending, setRecordPending] = useState(false);

  const [excludedConflictIds, setExcludedConflictIds] = useState<string[]>([]);
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [voteChoice, setVoteChoice] = useState<VoteChoice>("support");
  const [confirmedDecisionHash, setConfirmedDecisionHash] = useState<string | null>(
    null,
  );
  const [loadedPreview, setLoadedPreview] =
    useState<FinalDecisionPreview | null>(null);

  const selectedConflictIds = openConflictIds.filter(
    (id) => !excludedConflictIds.includes(id),
  );
  const roomDecisionHash = room.finalDecisionPreview?.decisionHash ?? null;
  const decisionPreview =
    loadedPreview &&
    (roomDecisionHash === null || loadedPreview.decisionHash === roomDecisionHash)
      ? loadedPreview
      : room.finalDecisionPreview;
  const decisionHash = decisionPreview?.decisionHash ?? null;
  const hasApprovedCurrentHash = Boolean(
    self &&
      decisionHash &&
      decisionPreview?.approvals.some(
        (approval) =>
          approval.participantId === self.id &&
          approval.decisionHash === decisionHash,
      ),
  );

  const revisedConstraintIds = useMemo(
    () =>
      activeProposal && activeProposal.referencedConstraintIds.length > 0
        ? activeProposal.referencedConstraintIds
        : room.constraints.map((constraint) => constraint.id),
    [activeProposal, room.constraints],
  );

  async function handleProposalSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proposalPending || !self) return;

    const data = new FormData(event.currentTarget);
    setProposalPending(true);
    const result = await actions.submitProposal({
      title: String(data.get("title")).trim(),
      summary: String(data.get("summary")).trim(),
      rationale: String(data.get("rationale")).trim(),
      expectedOutcomes: toLines(String(data.get("expectedOutcomes"))),
      referencedConstraintIds: data.getAll("constraintIds").map(String),
      parentProposalId: null,
    });
    setProposalPending(false);
    setProposalResult(result);
  }

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
    if (tradeoffPending || !activeProposal || !self || selectedConflictIds.length === 0) {
      return;
    }

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
        expectedOutcomes: toLines(String(data.get("revisedOutcomes"))),
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

  async function handlePreviewClick() {
    if (previewPending || !self) return;

    setPreviewPending(true);
    const result = await actions.previewFinalDecision();
    setPreviewPending(false);
    setPreviewResult(result);
    if (result.ok) setLoadedPreview(result.data);
  }

  async function handleApprovalClick() {
    if (approvalPending || !decisionHash || confirmedDecisionHash !== decisionHash) return;

    setApprovalPending(true);
    const result = await actions.approveFinalDecision({ decisionHash });
    setApprovalPending(false);
    setApprovalResult(result);
  }

  async function handleRecordClick() {
    if (recordPending) return;

    setRecordPending(true);
    const result = await actions.getDecisionRecord();
    setRecordPending(false);
    setRecordResult(result);
  }

  return (
    <section
      className="panel-block decision-panel"
      aria-labelledby="decision-heading"
      data-testid="decision-panel"
    >
      <h2 className="panel-heading" id="decision-heading">
        Decision workbench
      </h2>

      <section className="decision-section" aria-labelledby="active-proposal-heading">
        <h3 className="panel-subheading" id="active-proposal-heading">
          Active proposal
        </h3>
        <ActiveProposalView room={room} proposal={activeProposal} />
        <p className="panel-note">
          The central table and plan read this same active proposal from the
          canonical room snapshot.
        </p>
      </section>

      <form
        className="decision-section decision-form"
        data-testid="proposal-form"
        onSubmit={handleProposalSubmit}
      >
        <h3 className="panel-subheading">Proposal</h3>
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

      <form
        className="decision-section decision-form"
        data-testid="objection-form"
        onSubmit={handleObjectionSubmit}
      >
        <h3 className="panel-subheading">Objections</h3>
        <ConflictList room={room} conflicts={room.conflicts} />
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
            defaultValue={activeProposal?.title ?? PROPOSAL_DRAFT.title}
          />

          <label htmlFor={`${fieldId}-revised-summary`}>Revised summary</label>
          <textarea
            id={`${fieldId}-revised-summary`}
            name="revisedSummary"
            rows={3}
            required
            defaultValue={activeProposal?.summary ?? PROPOSAL_DRAFT.summary}
          />

          <label htmlFor={`${fieldId}-revised-rationale`}>Revised rationale</label>
          <textarea
            id={`${fieldId}-revised-rationale`}
            name="revisedRationale"
            rows={3}
            required
            defaultValue={activeProposal?.rationale ?? PROPOSAL_DRAFT.rationale}
          />

          <label htmlFor={`${fieldId}-revised-outcomes`}>
            Revised expected outcomes, one per line
          </label>
          <textarea
            id={`${fieldId}-revised-outcomes`}
            name="revisedOutcomes"
            rows={3}
            required
            defaultValue={
              activeProposal?.expectedOutcomes.join("\n") ??
              PROPOSAL_DRAFT.expectedOutcomes
            }
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
                <label htmlFor={`${fieldId}-${conflict.id}-resolution`}>
                  Resolution note
                </label>
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
        <p className="panel-note">
          Blocking objections open: {blockingOpenCount}. Tradeoffs and resolutions are separate recorded actions.
        </p>
        <ActionFeedback result={resolutionResult} />
      </section>

      <form
        className="decision-section decision-form"
        data-testid="vote-form"
        onSubmit={handleVoteSubmit}
      >
        <h3 className="panel-subheading">Vote</h3>
        {selfVote ? (
          <p className="decision-current">
            Your current vote: {VOTE_CHOICE_LABEL[selfVote.choice]}
            {selfVote.comment ? ` - ${selfVote.comment}` : ""}
          </p>
        ) : null}
        <fieldset disabled={!self || room.phase !== "voting" || !activeProposal || votePending}>
          <label htmlFor={`${fieldId}-vote-choice`}>Your vote for the active proposal</label>
          <select
            id={`${fieldId}-vote-choice`}
            value={voteChoice}
            onChange={(event) => setVoteChoice(event.target.value as VoteChoice)}
          >
            {VOTE_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {VOTE_CHOICE_LABEL[choice]}
              </option>
            ))}
          </select>

          <label htmlFor={`${fieldId}-vote-comment`}>Comment</label>
          <input id={`${fieldId}-vote-comment`} name="comment" />

          <button className="button decision-action" type="submit">
            {votePending ? "Recording..." : "Record my vote"}
          </button>
        </fieldset>
        <p className="panel-note">
          Your vote records your position on the proposal. It is not final approval.
        </p>
        <ActionFeedback result={voteResult} />
      </form>

      <section
        className="decision-section"
        aria-labelledby="approval-heading"
        data-testid="approval-panel"
      >
        <h3 className="panel-subheading" id="approval-heading">
          Final preview and approval
        </h3>
        <button
          className="button-quiet"
          type="button"
          disabled={!self || room.phase !== "approval" || previewPending}
          onClick={handlePreviewClick}
        >
          {previewPending ? "Loading preview..." : "Refresh exact server preview"}
        </button>
        <ActionFeedback result={previewResult} />

        {decisionPreview ? (
          <>
            <DecisionPreviewView room={room} preview={decisionPreview} />
            <label className="decision-confirm">
              <input
                type="checkbox"
                checked={confirmedDecisionHash === decisionHash}
                disabled={hasApprovedCurrentHash}
                onChange={(event) =>
                  setConfirmedDecisionHash(event.target.checked ? decisionHash : null)
                }
              />
              <span>I reviewed and confirm this exact decision hash.</span>
            </label>
            <button
              className="button decision-action"
              type="button"
              disabled={
                hasApprovedCurrentHash ||
                approvalPending ||
                confirmedDecisionHash !== decisionHash
              }
              onClick={handleApprovalClick}
            >
              {hasApprovedCurrentHash
                ? "Approval already recorded"
                : approvalPending
                  ? "Approving..."
                  : "Approve this exact decision"}
            </button>
          </>
        ) : (
          <p className="panel-empty">The final candidate appears here during approval.</p>
        )}
        <ActionFeedback result={approvalResult} />
      </section>

      <section
        className="decision-section"
        aria-labelledby="record-heading"
        data-testid="decision-record-panel"
      >
        <h3 className="panel-subheading" id="record-heading">
          Immutable decision record
        </h3>
        <button
          className="button-quiet"
          type="button"
          disabled={room.phase !== "finalized" || recordPending}
          onClick={handleRecordClick}
        >
          {recordPending ? "Loading record..." : "Load persisted final record"}
        </button>
        <ActionFeedback result={recordResult} />
        {recordResult?.ok ? (
          <DecisionRecordView room={room} record={recordResult.data} />
        ) : (
          <p className="panel-note">
            The record is fetched from the server after finalization, not rebuilt from local UI state.
          </p>
        )}
      </section>
    </section>
  );
}

function ActiveProposalView({
  room,
  proposal,
}: {
  room: RoomState;
  proposal: Proposal | null;
}) {
  if (!proposal) {
    return <p className="panel-empty">No active proposal is on the central table yet.</p>;
  }

  return (
    <article className="decision-card">
      <div className="decision-card-head">
        <strong>{proposal.title}</strong>
        <span className="tag">{proposal.status}</span>
      </div>
      <p>{proposal.summary}</p>
      <p className="panel-note">{proposal.rationale}</p>
      {proposal.parentProposalId ? (
        <p className="decision-lineage">
          Revision of {proposalLabel(room, proposal.parentProposalId)}
        </p>
      ) : null}
    </article>
  );
}

function ConflictList({
  room,
  conflicts,
}: {
  room: RoomState;
  conflicts: readonly Conflict[];
}) {
  if (conflicts.length === 0) {
    return <p className="panel-empty">No objections have been raised.</p>;
  }

  return (
    <ul className="decision-list">
      {conflicts.map((conflict) => (
        <li key={conflict.id} className="decision-list-item">
          <div className="decision-card-head">
            <span className={`tag ${conflict.severity === "blocking" ? "tag-risk" : ""}`}>
              {conflict.status} {conflict.severity}
            </span>
            <span>{participantLabel(room, conflict.raisedByActorId)}</span>
          </div>
          <p>{conflict.reason}</p>
          {conflict.resolutionNote ? (
            <p className="panel-note">Resolution: {conflict.resolutionNote}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function DecisionPreviewView({
  room,
  preview,
}: {
  room: RoomState;
  preview: FinalDecisionPreview;
}) {
  return (
    <article className="decision-card decision-preview">
      <div className="decision-card-head">
        <strong>{preview.proposal.title}</strong>
        <code data-testid="decision-hash">{preview.decisionHash}</code>
      </div>
      <p>{preview.proposal.summary}</p>
      <p>{preview.rationale}</p>
      <DecisionList title="Expected outcomes" entries={preview.proposal.expectedOutcomes} />
      <DecisionList
        title="Accepted tradeoffs"
        entries={preview.acceptedTradeoffs.map(
          (tradeoff) => `${tradeoff.description} - ${tradeoff.expectedEffect}`,
        )}
        empty="No accepted tradeoffs are part of this candidate."
      />
      <DecisionList
        title="Unresolved warnings"
        entries={preview.unresolvedWarnings.map((warning) => warning.reason)}
        empty="No unresolved warnings."
      />
      <DecisionList title="Dissent" entries={preview.dissent} empty="No dissent recorded." />
      <dl className="decision-facts">
        <div>
          <dt>Votes</dt>
          <dd>{preview.votes.length}</dd>
        </div>
        <div>
          <dt>Approvals</dt>
          <dd>{preview.approvals.length}</dd>
        </div>
        <div>
          <dt>Missing</dt>
          <dd>
            {preview.missingApprovalParticipantIds.map((id) => participantLabel(room, id)).join(", ") ||
              "none"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function DecisionRecordView({
  room,
  record,
}: {
  room: RoomState;
  record: DecisionRecord;
}) {
  return (
    <article className="decision-card decision-preview">
      <div className="decision-card-head">
        <strong>{record.decision.proposal.title}</strong>
        <code>{record.decision.decisionHash}</code>
      </div>
      <p>Finalized {formatTime(record.finalizedAt)}</p>
      <p>{record.decision.rationale}</p>
      <DecisionList
        title="Accepted tradeoffs"
        entries={record.acceptedTradeoffs.map(
          (tradeoff) => `${tradeoff.description} - ${tradeoff.expectedEffect}`,
        )}
      />
      <DecisionList
        title="Votes"
        entries={record.votes.map(
          (vote) =>
            `${participantLabel(room, vote.participantId)}: ${VOTE_CHOICE_LABEL[vote.choice]}${
              vote.comment ? ` - ${vote.comment}` : ""
            }`,
        )}
      />
      <DecisionList
        title="Approvals"
        entries={record.approvals.map(
          (approval) =>
            `${participantLabel(room, approval.participantId)} approved ${approval.decisionHash}`,
        )}
      />
      <DecisionList
        title="Provenance"
        entries={record.provenance.map(
          (event) =>
            `${participantLabel(room, event.actorId)} via ${event.origin}: ${formatActionName(event.action)}`,
        )}
      />
    </article>
  );
}

function DecisionList({
  title,
  entries,
  empty = "None recorded.",
}: {
  title: string;
  entries: readonly string[];
  empty?: string;
}) {
  return (
    <div className="decision-sublist">
      <h4>{title}</h4>
      {entries.length === 0 ? (
        <p className="panel-empty">{empty}</p>
      ) : (
        <ul>
          {entries.map((entry, index) => (
            <li key={`${entry}-${index}`}>{entry}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
