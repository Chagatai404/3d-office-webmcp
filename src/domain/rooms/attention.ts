import type {
  AttentionItem,
  JoinRequest,
  Participant,
  RoomState,
} from "@/contracts/room";

export interface ComputeAttentionItemsParams {
  room: RoomState;
  self: Participant;
  /**
   * Only ever populated for the room owner (a non-owner has no read access
   * to other participants' join requests). Pass `[]` for a non-owner.
   */
  pendingJoinRequests: JoinRequest[];
}

/**
 * Derives the authenticated participant's own "needs you" list from
 * canonical room state. This is a pure projection, not a second workflow:
 * every rule below reads fields `RoomState` (or the owner-only join-request
 * list) already carries, and nothing here is ever written back. Rules are
 * deliberately conservative -- see the per-rule comments -- so an agent
 * asking "what needs me?" gets a short, trustworthy answer rather than a
 * noisy one.
 */
export function computeAttentionItems({
  room,
  self,
  pendingJoinRequests,
}: ComputeAttentionItemsParams): AttentionItem[] {
  if (self.status !== "active") return [];

  const items: AttentionItem[] = [];
  const isOwner = self.id === room.ownerParticipantId && self.meetingRole === "owner";
  const isHuman = self.kind === "human";

  const hasOpenBlockingConflict = room.conflicts.some(
    (conflict) => conflict.status === "open" && conflict.severity === "blocking",
  );

  // input_required: the participant has not published a position yet during
  // Input. Readiness (`isReady`) is the same signal `markMyInputReady`
  // writes, so this tracks the identical prerequisite the owner-only phase
  // advance already enforces server-side.
  if (room.phase === "input" && isHuman && !self.isReady) {
    items.push({
      id: `attn:input_required:${self.id}`,
      type: "input_required",
      priority: "normal",
      title: "Share your context",
      summary: "Publish your needs and constraints before the room moves to proposals.",
      phase: room.phase,
      relatedEntityId: self.id,
      requiresHumanConfirmation: false,
    });
  }

  // admission_request: one item per waiting join request, owner only. The
  // caller is responsible for only passing non-empty `pendingJoinRequests`
  // when `self` is actually the owner; this function still gates on
  // `isOwner` itself as a second, cheap guard against a caller mistake.
  if (isOwner) {
    for (const request of pendingJoinRequests) {
      if (request.status !== "waiting") continue;
      items.push({
        id: `attn:admission_request:${request.id}`,
        type: "admission_request",
        priority: "high",
        title: `${request.displayName} is waiting to join`,
        summary: `${request.displayName} (${request.role}) requested to join and is waiting in the lobby.`,
        phase: room.phase,
        relatedEntityId: request.id,
        requiresHumanConfirmation: false,
      });
    }
  }

  // conflict_requires_human: only the participant who raised an open
  // blocking conflict gets an item for it -- they are the one who can judge
  // whether a later trade-off actually addresses it. This deliberately does
  // not notify every participant about every open conflict.
  if (room.phase === "deliberation" && isHuman) {
    for (const conflict of room.conflicts) {
      if (conflict.status !== "open" || conflict.severity !== "blocking") continue;
      if (conflict.raisedByActorType !== "participant" || conflict.raisedByActorId !== self.id) continue;
      items.push({
        id: `attn:conflict_requires_human:${conflict.id}`,
        type: "conflict_requires_human",
        priority: "high",
        title: "Your blocking concern needs a look",
        summary: conflict.reason,
        phase: room.phase,
        relatedEntityId: conflict.id,
        requiresHumanConfirmation: false,
      });
    }
  }

  // alignment_required: the active candidate exists and this human has not
  // shared alignment on it yet.
  if (room.phase === "voting" && isHuman && room.activeProposalId) {
    const hasAligned = room.alignments.some(
      (alignment) =>
        alignment.proposalId === room.activeProposalId && alignment.participantId === self.id,
    );
    if (!hasAligned) {
      items.push({
        id: `attn:alignment_required:${room.activeProposalId}`,
        type: "alignment_required",
        priority: "normal",
        title: "Share your alignment",
        summary: "The room is gathering alignment on the current candidate. Share support, a concern, or a question.",
        phase: room.phase,
        relatedEntityId: room.activeProposalId,
        requiresHumanConfirmation: false,
      });
    }
  }

  // owner_decision_required / consensus_approval_required: a single check
  // against `missingApprovalParticipantIds` picks the right type from the
  // room's `decisionPolicy`, so an owner who also happens to be a
  // decision-maker under consensus is never double-notified.
  if (room.phase === "approval" && isHuman && room.finalDecisionPreview) {
    const isMissingApproval = room.finalDecisionPreview.missingApprovalParticipantIds.includes(self.id);
    if (isMissingApproval) {
      const type = room.decisionPolicy === "owner_decides" ? "owner_decision_required" : "consensus_approval_required";
      items.push({
        id: `attn:${type}:${room.finalDecisionPreview.decisionHash}`,
        type,
        priority: "critical",
        title: type === "owner_decision_required" ? "Your final decision is ready to review" : "Your approval is required",
        summary: "Review the exact final decision and confirm it in the Decision workspace.",
        phase: room.phase,
        relatedEntityId: room.finalDecisionPreview.decisionHash,
        requiresHumanConfirmation: true,
      });
    }
  }

  // expert_advice_needs_disposition: an unresolved (status = "open") expert
  // finding tied to the active proposal, during Alignment only -- the last
  // phase before `review_final_decision` freezes the exact candidate and
  // `recordExpertAdviceOutcome` stops accepting new dispositions. Deliberately
  // narrow -- one item for "there is open expert advice", not one per
  // finding -- so this stays a single concise nudge rather than spamming the
  // owner with every advisory category individually. It never blocks
  // anything by itself; see `recordExpertAdviceOutcome` for the only way it
  // is dispositioned.
  if (isOwner && room.phase === "voting" && room.activeProposalId) {
    const hasOpenExpertFinding = room.expertFindings.some(
      (finding) => finding.proposalId === room.activeProposalId && finding.status === "open",
    );
    if (hasOpenExpertFinding) {
      items.push({
        id: `attn:expert_advice_needs_disposition:${room.activeProposalId}`,
        type: "expert_advice_needs_disposition",
        priority: "normal",
        title: "Security Expert advice needs your disposition",
        summary: "Mark open expert advice resolved, accepted as risk, or rejected before finalizing.",
        phase: room.phase,
        relatedEntityId: room.activeProposalId,
        requiresHumanConfirmation: false,
      });
    }
  }

  // owner_progress_required: fires only when the corresponding
  // advance_discussion / request_team_alignment / review_final_decision
  // call would actually succeed, mirroring apply_room_phase_entry's
  // structural preconditions (active proposal, no open blocking conflict)
  // without duplicating readiness rules. input -> proposals is
  // intentionally omitted: per-participant readiness is not safely
  // approximated here without risking a false-positive nag.
  if (isOwner) {
    const ready =
      (room.phase === "proposals" && room.activeProposalId !== null) ||
      (room.phase === "deliberation" && room.activeProposalId !== null && !hasOpenBlockingConflict) ||
      (room.phase === "voting" && room.activeProposalId !== null && !hasOpenBlockingConflict);
    if (ready) {
      items.push({
        id: `attn:owner_progress_required:${room.phase}`,
        type: "owner_progress_required",
        priority: "normal",
        title: "The room is ready to move forward",
        summary: "Every blocker is clear for the next step whenever you are ready to advance it.",
        phase: room.phase,
        relatedEntityId: null,
        requiresHumanConfirmation: false,
      });
    }
  }

  return items;
}
