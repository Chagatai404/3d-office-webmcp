"use client";

import { useState } from "react";
import type { ActionResult, DecisionRecord, FinalDecisionPreview } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { DecisionPreviewView, DecisionRecordView } from "./decision-shared";
import { useRoom } from "./room-provider";

/**
 * The Decision workspace: the exact final candidate, owners, deadlines,
 * remaining warnings, and deliberate human approval.
 *
 * Approval should feel closer to signing a final artifact than voting does —
 * it requires an explicit re-confirmation of the exact decision hash, and
 * that hash is voided the moment the plan changes underneath it.
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
  const hasApprovedCurrentHash = Boolean(
    self &&
      decisionHash &&
      decisionPreview?.approvals.some(
        (approval) => approval.participantId === self.id && approval.decisionHash === decisionHash,
      ),
  );

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

      <section className="decision-section" aria-labelledby="approval-heading" data-testid="approval-panel">
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
              disabled={hasApprovedCurrentHash || approvalPending || confirmedDecisionHash !== decisionHash}
              onClick={handleApprovalClick}
              data-testid="confirm-approval"
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
