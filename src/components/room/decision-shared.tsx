"use client";

import type {
  Conflict,
  DecisionRecord,
  FinalDecisionPreview,
  Proposal,
  RoomState,
} from "@/contracts/room";
import { formatActionName, formatTime, VOTE_CHOICE_LABEL } from "./room-labels";

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
