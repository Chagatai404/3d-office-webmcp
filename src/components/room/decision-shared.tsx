"use client";

import type {
  Conflict,
  DecisionRecord,
  FinalDecisionCandidate,
  FinalDecisionPreview,
  Proposal,
  RoomState,
} from "@/contracts/room";
import { ALIGNMENT_CHOICE_LABEL, formatActionName, formatTime } from "./room-labels";

const DECISION_POLICY_LABEL: Record<RoomState["decisionPolicy"], string> = {
  owner_decides: "Responsible owner decides",
  equal_authority_consensus: "Equal decision-makers must agree",
};

const EXPERT_ADVICE_STATUS_LABEL: Record<FinalDecisionCandidate["expertAdvice"][number]["status"], string> = {
  open: "Open",
  resolved: "Resolved",
  accepted_risk: "Accepted risk",
  rejected: "Rejected",
};

/**
 * Deterministic expert advice embedded in the exact candidate/record. Never
 * rendered as human alignment or a required approver -- see
 * `src/domain/rooms/expert.ts` for why the Security Expert can never gain
 * that authority.
 */
export function ExpertAdviceList({
  advice,
}: {
  advice: readonly FinalDecisionCandidate["expertAdvice"][number][];
}) {
  if (advice.length === 0) return null;
  return (
    <div className="decision-sublist" data-testid="decision-expert-advice">
      <h4>Security Expert · Advisory</h4>
      <ul>
        {advice.map((entry) => (
          <li key={entry.findingId}>
            {entry.title} — {EXPERT_ADVICE_STATUS_LABEL[entry.status]}
            {entry.resolutionRationale ? `: ${entry.resolutionRationale}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Shared drafts, formatting, and read-only views for the four workspaces
 * split out of the former single decision workbench: proposals, issues,
 * vote, and decision. Splitting the workbench by decision concept matches
 * the room's own workspace boards — Proposals, Issues, Vote, Decision — each
 * with its own camera focus, instead of one panel covering all four.
 */

export const PROPOSAL_DRAFT = {
  title: "Two-week accessible onboarding scope",
  summary:
    "Ship a narrower onboarding update that improves time to first value while keeping accessibility review in scope.",
  rationale:
    "This meets the launch goal without expanding engineering capacity or weakening design quality.",
  expectedOutcomes:
    "New users reach first value faster\nAccessibility review is completed before release\nCampaign timing remains credible",
};

export const TRADEOFF_DRAFT = {
  description:
    "Keep accessibility review in scope and reduce the first release to the highest-impact onboarding step.",
  expectedEffect:
    "Resolves the blocking concern while preserving the two-week delivery window.",
};

export function toLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function participantLabel(room: RoomState, participantId: string | null): string {
  if (!participantId) return "Unassigned";
  const participant = room.participants.find((candidate) => candidate.id === participantId);
  return participant ? `${participant.role} - ${participant.name}` : participantId;
}

export function proposalLabel(room: RoomState, proposalId: string | null): string {
  if (!proposalId) return "Original proposal";
  return room.proposals.find((proposal) => proposal.id === proposalId)?.title ?? proposalId;
}

export function ActiveProposalView({
  room,
  proposal,
}: {
  room: RoomState;
  proposal: Proposal | null;
}) {
  if (!proposal) {
    return <p className="panel-empty">No active proposal is on the table yet.</p>;
  }

  return (
    <article className="decision-card" data-board-item={proposal.id}>
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

export function ConflictList({
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
        <li key={conflict.id} className="decision-list-item" data-board-item={conflict.id}>
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

export function DecisionList({
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

export function DecisionPreviewView({
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
      <p>
        <span className="tag" data-testid="decision-policy">
          {DECISION_POLICY_LABEL[preview.decisionPolicy]}
        </span>
      </p>
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
      <ExpertAdviceList advice={preview.expertAdvice} />
      <DecisionList
        title="Required approvers"
        entries={preview.requiredApprovalParticipantIds.map((id) => participantLabel(room, id))}
        empty="No approver is required under the current policy."
      />
      <dl className="decision-facts">
        <div>
          <dt>Team alignment</dt>
          <dd>{preview.alignments.length} shared</dd>
        </div>
        <div>
          <dt>Approved</dt>
          <dd>
            {preview.approvals.length} of {preview.requiredApprovalParticipantIds.length}
          </dd>
        </div>
        <div>
          <dt>Waiting on</dt>
          <dd>
            {preview.missingApprovalParticipantIds.map((id) => participantLabel(room, id)).join(", ") ||
              "no one"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function DecisionRecordView({
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
      <p>
        <span className="tag">{DECISION_POLICY_LABEL[record.decision.decisionPolicy]}</span>
      </p>
      <p>Finalized {formatTime(record.finalizedAt)}</p>
      <p>{record.decision.rationale}</p>
      <DecisionList
        title="Accepted tradeoffs"
        entries={record.acceptedTradeoffs.map(
          (tradeoff) => `${tradeoff.description} - ${tradeoff.expectedEffect}`,
        )}
      />
      <DecisionList title="Dissent" entries={record.decision.dissent} empty="No dissent recorded." />
      <ExpertAdviceList advice={record.decision.expertAdvice} />
      <DecisionList
        title="Alignment"
        entries={record.alignments.map(
          (alignment) =>
            `${participantLabel(room, alignment.participantId)}: ${ALIGNMENT_CHOICE_LABEL[alignment.choice]}${
              alignment.comment ? ` - ${alignment.comment}` : ""
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
