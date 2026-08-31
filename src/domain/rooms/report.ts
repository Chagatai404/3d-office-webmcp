import type { DecisionPolicy, DecisionRecord, MeetingReport, RoomState } from "@/contracts/room";

/**
 * A8: the single canonical final-report computation
 * (`get_final_report` in `src/webmcp/room-tools.ts`, and the eventual PDF
 * export in A9, both call this -- neither reconstructs the report
 * independently).
 *
 * Every decision-shaped field is carried over from `record.decision`
 * (`FinalDecisionPreview`) unchanged; every added field is read directly
 * off `room`, never re-derived. `executiveSummary` is the one generated
 * value here, and it is a deterministic template built only from the
 * structured fields already in the report -- never freeform/generated
 * prose -- so it is exactly reproducible from the same finalized state,
 * the same way every other deterministic string in this codebase is (see
 * `src/domain/rooms/room-updates.ts`'s `describe()`).
 */

function policyLabel(policy: DecisionPolicy): string {
  return policy === "owner_decides" ? "owner decision" : "full decision-maker consensus";
}

function buildExecutiveSummary(params: {
  title: string;
  finalDecisionTitle: string;
  decisionPolicy: DecisionPolicy;
  approvedCount: number;
  requiredCount: number;
  acceptedTradeoffCount: number;
  dissentCount: number;
}): string {
  const tradeoffClause = params.acceptedTradeoffCount > 0
    ? ` with ${params.acceptedTradeoffCount} accepted trade-off${params.acceptedTradeoffCount === 1 ? "" : "s"}`
    : "";
  const dissentClause = params.dissentCount > 0
    ? `, alongside ${params.dissentCount} recorded dissent note${params.dissentCount === 1 ? "" : "s"}`
    : ", with no recorded dissent";
  return `"${params.title}" was finalized as "${params.finalDecisionTitle}" by ${policyLabel(params.decisionPolicy)} -- ${params.approvedCount} of ${params.requiredCount} required approver${params.requiredCount === 1 ? "" : "s"} confirmed${tradeoffClause}${dissentClause}.`;
}

export function computeMeetingReport(room: RoomState, record: DecisionRecord): MeetingReport {
  const decision = record.decision;
  const resolvedConcerns = room.conflicts.filter((conflict) => conflict.status === "resolved");
  const byAction: Record<string, number> = {};
  for (const event of record.provenance) {
    byAction[event.action] = (byAction[event.action] ?? 0) + 1;
  }

  return {
    roomId: record.roomId,
    title: room.title,
    brief: room.brief,
    executiveSummary: buildExecutiveSummary({
      title: room.title,
      finalDecisionTitle: decision.proposal.title,
      decisionPolicy: decision.decisionPolicy,
      approvedCount: decision.approvals.length,
      requiredCount: decision.requiredApprovalParticipantIds.length,
      acceptedTradeoffCount: decision.acceptedTradeoffs.length,
      dissentCount: decision.dissent.length,
    }),
    finalDecision: { title: decision.proposal.title, summary: decision.proposal.summary },
    rationale: decision.rationale,
    participants: room.participants,
    decisionPolicy: decision.decisionPolicy,
    keyInputs: room.positions,
    constraints: room.constraints,
    proposalsConsidered: room.proposals,
    concernsRaised: room.conflicts,
    resolvedConcerns,
    unresolvedWarnings: decision.unresolvedWarnings,
    acceptedTradeoffs: decision.acceptedTradeoffs,
    alignment: decision.alignments,
    dissent: decision.dissent,
    expertAdvice: decision.expertAdvice,
    actionItems: decision.actionItems,
    owners: decision.owners,
    deadlines: decision.deadlines,
    requiredApprovalParticipantIds: decision.requiredApprovalParticipantIds,
    approvals: decision.approvals,
    decisionHash: decision.decisionHash,
    finalizedAt: record.finalizedAt,
    provenanceSummary: { totalEvents: record.provenance.length, byAction },
  };
}
