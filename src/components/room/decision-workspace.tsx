"use client";

import { useState } from "react";
import type {
  ActionResult,
  FinalDecisionPreview,
  RoomState,
} from "@/contracts/room";
import { useShell } from "@/components/shell/shell-provider";
import { ActionFeedback } from "./action-feedback";
import { shortDecisionHash } from "./coordination";
import { DecisionPreviewView } from "./decision-shared";
import { FinalReport } from "./final-report";
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
/** A seated participant's id, or `"input"` for the viewer's own review-and-approve tab. */
export type DecisionWorkspaceTab = string;

export function DecisionWorkspace({ tab }: { tab: DecisionWorkspaceTab }) {
  const { room } = useRoom();

  /*
   * The decision pedestal holds the review while the decision is being made,
   * and the record once it has been. One place in the room, one artifact: a
   * finalized meeting does not send anyone somewhere new to find out what was
   * decided, and there is no second surface that could disagree with this one.
   * The record has no tabs of its own — there is nothing left to switch
   * between once the room has one shared artifact.
   */
  return room.phase === "finalized" ? <FinalReport /> : <DecisionReview tab={tab} />;
}

function DecisionReview({ tab }: { tab: DecisionWorkspaceTab }) {
  const { room, self, actions } = useRoom();
  const { agentPreparedDecision, clearDecisionHandoff } = useShell();

  const [previewResult, setPreviewResult] = useState<ActionResult<FinalDecisionPreview> | null>(null);
  const [approvalResult, setApprovalResult] = useState<ActionResult<unknown> | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [approvalPending, setApprovalPending] = useState(false);

  const [confirmedDecisionHash, setConfirmedDecisionHash] = useState<string | null>(null);
  const [loadedPreview, setLoadedPreview] = useState<FinalDecisionPreview | null>(null);

  const roomDecisionHash = room.finalDecisionPreview?.decisionHash ?? null;
  const decisionPreview =
    loadedPreview && (roomDecisionHash === null || loadedPreview.decisionHash === roomDecisionHash)
      ? loadedPreview
      : room.finalDecisionPreview;
  const decisionHash = decisionPreview?.decisionHash ?? null;

  const isOwner = Boolean(
    self?.id === room.ownerParticipantId && self.meetingRole === "owner",
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
  const viewedParticipant = tab !== "input" ? room.participants.find((participant) => participant.id === tab) : null;
  const viewedIsApprover = Boolean(
    viewedParticipant && decisionPreview?.requiredApprovalParticipantIds.includes(viewedParticipant.id),
  );
  const viewedHasApproved = Boolean(
    viewedParticipant &&
      decisionHash &&
      decisionPreview?.approvals.some(
        (approval) => approval.participantId === viewedParticipant.id && approval.decisionHash === decisionHash,
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
    // The hand-off notice asked for exactly this. It has been answered.
    if (result.ok) clearDecisionHandoff();
  }

  return (
    <section
      className="panel-block decision-panel"
      aria-labelledby="decision-heading"
      data-testid="decision-workspace"
    >
      <h2 className={viewedParticipant ? "panel-heading" : "visually-hidden"} id="decision-heading">
        {viewedParticipant ? viewedParticipant.name : "Your input"}
      </h2>

      {viewedParticipant ? (
        <section aria-labelledby="policy-heading" data-testid="policy-panel">
          <p>
            <span className="tag" data-testid="decision-policy-tag">
              {DECISION_POLICY_LABEL[room.decisionPolicy]}
            </span>
          </p>
          {room.decisionPolicy === "owner_decides" ? (
            <p className="panel-note">
              {viewedParticipant.id === room.ownerParticipantId
                ? `${ownerName} is the decision owner.`
                : `Not the decision owner. Only ${ownerName} can make the final decision.`}
            </p>
          ) : viewedIsApprover ? (
            <p>
              <span className={viewedHasApproved ? "status-pill status-pill-active" : "status-pill"}>
                {viewedHasApproved ? "Approved" : "Waiting"}
              </span>
            </p>
          ) : (
            <p className="panel-note">Not a required decision-maker for this candidate.</p>
          )}
        </section>
      ) : (
        <>
          {/* B6: an agent that stops here has not failed, and the room must not
              look like it has. The tool returned `HUMAN_CONFIRMATION_REQUIRED`,
              the shell brought the person to this surface, and this says why in
              the person's own language rather than leaving a refusal code to be
              read as a bug. */}
          {agentPreparedDecision ? (
            <aside className="decision-handoff" role="status" data-testid="agent-decision-handoff">
              <strong className="decision-handoff-title">
                Your agent prepared the final decision.
              </strong>
              <p>
                Review this exact decision before approving. Your agent went as far as it is allowed
                to go — the last step is deliberately yours, and no agent can take it for you.
              </p>
            </aside>
          ) : null}

          <section aria-labelledby="approval-heading" data-testid="approval-panel">
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
                      <span>
                        I reviewed this decision
                        {/* The confirmation is bound to one exact frozen decision,
                            and it says which — quietly, beside the tick, rather
                            than as a hash a person is asked to read aloud. */}
                        {decisionHash ? (
                          <small className="decision-confirm-hash">
                            Bound to {shortDecisionHash(decisionHash)}. If the plan changes, this
                            confirmation is void.
                          </small>
                        ) : null}
                      </span>
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
                    <p className="panel-note" data-testid="human-confirmation-note">
                      This one step stays with a person on purpose. An agent can prepare the exact
                      decision and bring it here; recording it takes your own confirmation.
                    </p>
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
        </>
      )}
    </section>
  );
}
