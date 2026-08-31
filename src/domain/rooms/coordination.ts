import type { ActorType, AlignmentChoice, Conflict, RoomPhase, RoomState } from "@/contracts/room";

/**
 * `get_coordination_status`'s domain projection (`src/webmcp/room-tools.ts`).
 *
 * A single canonical read that answers "where are we, what is this phase
 * trying to accomplish, what have I completed, who/what are we waiting for,
 * can the meeting advance, and what should I do next?" without an agent
 * combining `get_meeting_context`, `get_open_issues`, and `get_alignment`
 * itself. Every field here is derived fresh from `RoomState` on each call --
 * nothing is persisted, and nothing here is a second source of authority.
 * `canAdvance` mirrors the exact server-side prerequisites in
 * `advance_room_phase` / `apply_room_phase_entry`
 * (`supabase/migrations/20260830120000_owner_lifecycle_and_meeting_lock.sql`,
 * `supabase/migrations/20260830130000_alignment_and_decision_policy.sql`),
 * not an independently invented approximation of them.
 */

export interface ParticipantReadiness {
  participantId: string;
  name: string;
  role: string;
  hasSharedInput: boolean;
  isReady: boolean;
}

export interface InputCoordinationStatus {
  readiness: ParticipantReadiness[];
  readyCount: number;
  totalActiveHumans: number;
}

export interface ProposalsCoordinationStatus {
  hasActiveProposal: boolean;
  activeProposalId: string | null;
  activeProposalTitle: string | null;
  proposedByParticipantId: string | null;
  proposalCount: number;
}

export interface OpenConflictSummary {
  id: string;
  severity: Conflict["severity"];
  raisedByActorType: ActorType;
  raisedByActorId: string | null;
  raisedByName: string | null;
}

export interface DeliberationCoordinationStatus {
  blockingCount: number;
  warningCount: number;
  openConflicts: OpenConflictSummary[];
}

export interface AlignmentStatusEntry {
  participantId: string;
  name: string;
  role: string;
  shared: boolean;
  choice: AlignmentChoice | null;
}

export interface AlignmentCoordinationStatus {
  activeProposalId: string | null;
  alignment: AlignmentStatusEntry[];
  missingParticipantIds: string[];
}

export interface ApprovalCoordinationStatus {
  decisionHash: string | null;
  requiredApproverIds: string[];
  completedApproverIds: string[];
  missingApproverIds: string[];
  /** Always true: approval never finalizes without the human's own visible confirmation. */
  humanConfirmationRequired: boolean;
}

export interface CoordinationStatus {
  roomId: string;
  roomVersion: number;
  phase: RoomPhase;
  phaseGoal: string;
  isLocked: boolean;
  isFinalized: boolean;
  canAdvance: boolean;
  waitingFor: string[];
  recommendedNextAction: string;
  input: InputCoordinationStatus | null;
  proposals: ProposalsCoordinationStatus | null;
  deliberation: DeliberationCoordinationStatus | null;
  alignment: AlignmentCoordinationStatus | null;
  approval: ApprovalCoordinationStatus | null;
}

const PHASE_GOAL: Record<RoomPhase, string> = {
  input: "Every active participant shares what matters from their own perspective, then marks their input ready.",
  proposals: "Someone proposes one concrete option for the team to evaluate.",
  deliberation: "Participants raise and resolve concerns about the active proposal until no blocking issue remains.",
  voting: "Every active human shares their alignment -- support, concern, strong objection, or needs clarification -- on the active candidate.",
  approval: "Every participant required by the room's decision policy reviews and approves the exact frozen decision.",
  finalized: "The decision is finalized and immutable.",
};

function activeHumans(room: RoomState) {
  return room.participants.filter((participant) => participant.status === "active" && participant.kind === "human");
}

function hasSharedInput(room: RoomState, participantId: string): boolean {
  return room.positions.some((position) => position.participantId === participantId);
}

function hasOpenBlockingConflict(room: RoomState): boolean {
  return room.conflicts.some((conflict) => conflict.status === "open" && conflict.severity === "blocking");
}

function computeInputStatus(room: RoomState): InputCoordinationStatus {
  const readiness = activeHumans(room).map((participant) => ({
    participantId: participant.id,
    name: participant.name,
    role: participant.role,
    hasSharedInput: hasSharedInput(room, participant.id),
    isReady: participant.isReady,
  }));
  return {
    readiness,
    readyCount: readiness.filter((entry) => entry.isReady).length,
    totalActiveHumans: readiness.length,
  };
}

function computeProposalsStatus(room: RoomState): ProposalsCoordinationStatus {
  const activeProposal = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;
  return {
    hasActiveProposal: activeProposal !== null,
    activeProposalId: activeProposal?.id ?? null,
    activeProposalTitle: activeProposal?.title ?? null,
    proposedByParticipantId: activeProposal?.participantId ?? null,
    proposalCount: room.proposals.length,
  };
}

function computeDeliberationStatus(room: RoomState): DeliberationCoordinationStatus {
  const open = room.conflicts.filter((conflict) => conflict.status === "open");
  const nameById = new Map(room.participants.map((participant) => [participant.id, participant.name]));
  return {
    blockingCount: open.filter((conflict) => conflict.severity === "blocking").length,
    warningCount: open.filter((conflict) => conflict.severity === "warning").length,
    openConflicts: open.map((conflict) => ({
      id: conflict.id,
      severity: conflict.severity,
      raisedByActorType: conflict.raisedByActorType,
      raisedByActorId: conflict.raisedByActorId,
      raisedByName: conflict.raisedByActorId ? nameById.get(conflict.raisedByActorId) ?? null : null,
    })),
  };
}

function computeAlignmentStatus(room: RoomState): AlignmentCoordinationStatus {
  const byParticipantId = new Map(
    room.alignments
      .filter((alignment) => alignment.proposalId === room.activeProposalId)
      .map((alignment) => [alignment.participantId, alignment]),
  );
  const entries = activeHumans(room).map((participant) => {
    const entry = byParticipantId.get(participant.id);
    return {
      participantId: participant.id,
      name: participant.name,
      role: participant.role,
      shared: entry !== undefined,
      choice: entry?.choice ?? null,
    };
  });
  return {
    activeProposalId: room.activeProposalId,
    alignment: entries,
    missingParticipantIds: entries.filter((entry) => !entry.shared).map((entry) => entry.participantId),
  };
}

function computeApprovalStatus(room: RoomState): ApprovalCoordinationStatus {
  const preview = room.finalDecisionPreview;
  return {
    decisionHash: preview?.decisionHash ?? null,
    requiredApproverIds: preview?.requiredApprovalParticipantIds ?? [],
    completedApproverIds: preview?.approvals.map((approval) => approval.participantId) ?? [],
    missingApproverIds: preview?.missingApprovalParticipantIds ?? [],
    humanConfirmationRequired: true,
  };
}

interface Progression {
  canAdvance: boolean;
  waitingFor: string[];
  recommendedNextAction: string;
}

function computeProgression(room: RoomState): Progression {
  switch (room.phase) {
    case "input": {
      const status = computeInputStatus(room);
      const waitingFor = status.readiness
        .filter((entry) => !entry.isReady)
        .map((entry) => (entry.hasSharedInput ? `${entry.name} (needs to mark ready)` : `${entry.name} (needs to share input)`));
      const canAdvance = status.totalActiveHumans > 0 && waitingFor.length === 0;
      return {
        canAdvance,
        waitingFor,
        recommendedNextAction: canAdvance
          ? "Every active human is ready. The owner can advance to Proposals with advance_discussion."
          : `Wait for: ${waitingFor.join(", ")}.`,
      };
    }
    case "proposals": {
      const status = computeProposalsStatus(room);
      return {
        canAdvance: status.hasActiveProposal,
        waitingFor: status.hasActiveProposal ? [] : ["a proposed option"],
        recommendedNextAction: status.hasActiveProposal
          ? "An active proposal exists. The owner can advance to Deliberation with advance_discussion."
          : "Propose a concrete option with suggest_option.",
      };
    }
    case "deliberation": {
      const status = computeDeliberationStatus(room);
      const canAdvance = status.blockingCount === 0;
      const waitingFor = status.openConflicts
        .filter((conflict) => conflict.severity === "blocking")
        .map((conflict) => (conflict.raisedByName ? `${conflict.raisedByName}'s blocking concern` : "an unresolved blocking concern"));
      return {
        canAdvance,
        waitingFor,
        recommendedNextAction: canAdvance
          ? "No blocking concerns remain. The owner can request team alignment with request_team_alignment."
          : `Resolve the remaining blocking concern${status.blockingCount === 1 ? "" : "s"} before alignment.`,
      };
    }
    case "voting": {
      const status = computeAlignmentStatus(room);
      const missingNames = status.alignment.filter((entry) => !entry.shared).map((entry) => entry.name);
      // Alignment is informative, never mechanically gating: the owner may
      // call review_final_decision at any point once an active proposal
      // exists and no blocking conflict remains, exactly like
      // `apply_room_phase_entry` enforces for the 'approval' transition.
      const canAdvance = room.activeProposalId !== null && !hasOpenBlockingConflict(room);
      return {
        canAdvance,
        waitingFor: missingNames,
        recommendedNextAction: missingNames.length > 0
          ? `${missingNames.join(", ")} ${missingNames.length === 1 ? "has" : "have"} not shared alignment yet. Alignment is informative, not a hard gate -- the owner may review the final decision with review_final_decision at any time.`
          : "Every active human has shared alignment. The owner can review the final decision with review_final_decision.",
      };
    }
    case "approval": {
      const status = computeApprovalStatus(room);
      const missingNames = status.missingApproverIds.map(
        (participantId) => room.participants.find((participant) => participant.id === participantId)?.name ?? participantId,
      );
      return {
        canAdvance: status.missingApproverIds.length === 0,
        waitingFor: missingNames,
        recommendedNextAction: missingNames.length > 0
          ? `Wait for required approver${missingNames.length === 1 ? "" : "s"}: ${missingNames.join(", ")}. Each must call approve_final_decision and then visibly confirm.`
          : "All required approvals are recorded.",
      };
    }
    case "finalized":
      return {
        canAdvance: false,
        waitingFor: [],
        recommendedNextAction: "The meeting is finalized. Read get_decision_record for the immutable outcome.",
      };
  }
}

export function computeCoordinationStatus(room: RoomState): CoordinationStatus {
  const progression = computeProgression(room);
  return {
    roomId: room.id,
    roomVersion: room.version,
    phase: room.phase,
    phaseGoal: PHASE_GOAL[room.phase],
    isLocked: room.isLocked,
    isFinalized: room.phase === "finalized",
    canAdvance: progression.canAdvance,
    waitingFor: progression.waitingFor,
    recommendedNextAction: progression.recommendedNextAction,
    input: room.phase === "input" ? computeInputStatus(room) : null,
    proposals: room.phase === "proposals" ? computeProposalsStatus(room) : null,
    deliberation: room.phase === "deliberation" ? computeDeliberationStatus(room) : null,
    alignment: room.phase === "voting" ? computeAlignmentStatus(room) : null,
    approval: room.phase === "approval" ? computeApprovalStatus(room) : null,
  };
}
