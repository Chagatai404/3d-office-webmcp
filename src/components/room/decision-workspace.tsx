"use client";

import { useState } from "react";
import type {
  ActionResult,
  DecisionRecord,
  FinalDecisionPreview,
  RoomState,
} from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { DecisionPreviewView, DecisionRecordView } from "./decision-shared";
import { useRoom } from "./room-provider";

const DECISION_POLICY_LABEL: Record<RoomState["decisionPolicy"], string> = {
  owner_decides: "Responsible owner decides",
  equal_authority_consensus: "Equal decision-makers must agree",
};

/**
 * The Decision workspace: the exact final candidate, owners, deadlines,
 * remaining warnings, and deliberate human approval.
 *
 * This is policy-aware. Under `owner_decides`, only the current owner ever
 * sees a confirmation control, and their confirmation alone finalizes the
 * room — alignment (including strong objections) is preserved as visible
 * dissent, never mechanically outvoting them. Under
 * `equal_authority_consensus`, every active human decision-maker must
 * separately approve the same exact hash before the room finalizes;
 * contributor alignment is visible but never counts as approval.
 *
 * Approval should feel closer to signing a final artifact than sharing
 * alignment does — it requires an explicit re-confirmation of the exact
 * decision hash, and that hash is voided the moment the plan (or, under
 * `owner_decides`, the owner) changes underneath it.
 */
export function DecisionWorkspace() {
  const { room, self, actions } = useRoom();

  const [previewResult, setPreviewResult] = useState<ActionResult<FinalDecisionPreview> | null>(null);
  const [approvalResult, setApprovalResult] = useState<ActionResult<unknown> | null>(null);
  const [recordResult, setRecordResult] = useState<ActionResult<DecisionRecord> | null>(null);

  const [previewPending, setPreviewPending] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);
  const [recordPending, setRecordPending] = useState(false);

  const [confirmedDecisionHash, setConfirmedDecisionHash] = useState<string | null>(null);
  const [loadedPreview, setLoadedPreview] = useState<FinalDecisionPreview | null>(null);

  const roomDecisionHash = room.finalDecisionPreview?.decisionHash ?? null;
  const decisionPreview =
    loadedPreview && (roomDecisionHash === null || loadedPreview.decisionHash === roomDecisionHash)
      ? loadedPreview
      : room.finalDecisionPreview;
  const decisionHash = decisionPreview?.decisionHash ?? null;

  const isOwner = Boolean(
    room.demoMode === null && self?.id === room.ownerParticipantId && self.meetingRole === "owner",
  );
  const isRequiredApprover = Boolean(
    self && decisionPreview?.requiredApprovalParticipantIds.includes(self.id),
  );
  const canAct =
    room.decisionPolicy === "owner_decides" ? isOwner : isRequiredApprover;
  const hasApprovedCurrentHash = Boolean(
    self &&
      decisionHash &&
      decisionPreview?.approvals.some(
        (approval) => approval.participantId === self.id && approval.decisionHash === decisionHash,
      ),
  );
  const ownerName =
    room.participants.find((participant) => participant.id === room.ownerParticipantId)?.name ??
    "the decision owner";

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
      data-testid="decision-workspace"
    >
      <h2 className="panel-heading" id="decision-heading">
        Decision
      </h2>

      <section className="decision-section" aria-labelledby="policy-heading" data-testid="policy-panel">
        <h3 className="panel-subheading" id="policy-heading">
          Decision authority
        </h3>
        <p>
          <span className="tag" data-testid="decision-policy-tag">
            {DECISION_POLICY_LABEL[room.decisionPolicy]}
          </span>
        </p>
        {room.decisionPolicy === "owner_decides" ? (
          <p className="panel-note">
            Decision owner: {ownerName}.{" "}
            {isOwner
              ? "You are the decision owner."
              : "Only the decision owner can make the final decision. Others may review the exact candidate."}
          </p>
        ) : (
          <DecisionMakerApprovalProgress room={room} decisionPreview={decisionPreview} />
        )}
      </section>

      <section className="decision-section" aria-labelledby="approval-heading" data-testid="approval-panel">
        <h3 className="panel-subheading" id="approval-heading">
          {room.decisionPolicy === "owner_decides" ? "Final preview and decision" : "Final preview and approval"}
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
            {canAct ? (
              <>
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
                  disabled={hasApprovedCurrentHash || approvalPending || confirmedDecisionHash !== decisionHash}
                  onClick={handleApprovalClick}
                  data-testid="confirm-approval"
                >
                  {hasApprovedCurrentHash
                    ? room.decisionPolicy === "owner_decides"
                      ? "Decision recorded"
                      : "Approval already recorded"
                    : approvalPending
                      ? "Recording..."
                      : room.decisionPolicy === "owner_decides"
                        ? "Make final decision"
                        : "Approve this decision"}
                </button>
              </>
            ) : (
              <p className="panel-note">
                {room.decisionPolicy === "owner_decides"
                  ? "Only the decision owner can make the final decision."
                  : "Only a required decision-maker can approve this decision. Contributor alignment is visible but does not count as approval."}
              </p>
            )}
          </>
        ) : (
          <p className="panel-empty">The final candidate appears here during decision review.</p>
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

/**
 * `equal_authority_consensus` progress: every required decision-maker's
 * approval status against the current exact hash, never a percentage.
 */
function DecisionMakerApprovalProgress({
  room,
  decisionPreview,
}: {
  room: RoomState;
  decisionPreview: FinalDecisionPreview | null;
}) {
  const requiredIds =
    decisionPreview?.requiredApprovalParticipantIds ??
    room.participants
      .filter(
        (participant) =>
          participant.status === "active" &&
          participant.kind === "human" &&
          participant.decisionRole === "decision_maker",
      )
      .map((participant) => participant.id);
  const approvedIds = new Set((decisionPreview?.approvals ?? []).map((approval) => approval.participantId));

  return (
    <div data-testid="decision-maker-approvals">
      <p className="panel-subheading">Decision-maker approvals</p>
      <ul className="waiting-list">
        {requiredIds.map((id) => {
          const participant = room.participants.find((candidate) => candidate.id === id);
          const approved = approvedIds.has(id);
          return (
            <li key={id} className="waiting-row">
              <span className="participant-name">{participant?.name ?? id}</span>
              <span className={approved ? "status-pill status-pill-active" : "status-pill"}>
                {approved ? "Approved" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="panel-note">
        {approvedIds.size} of {requiredIds.length} required decision-makers have approved.
      </p>
    </div>
  );
}
