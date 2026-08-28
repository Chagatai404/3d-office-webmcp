import type {
  RoomPhase,
  RoomState,
  VoteChoice,
} from "@/contracts/room";

export interface VisualParticipant {
  id: string;
  name: string;
  role: string;
  kind: "human" | "simulation";
  isClaimed: boolean;
  isSelf: boolean;
  vote: VoteChoice | null;
  hasApprovedCurrentDecision: boolean;
}

export interface VisualConstraint {
  id: string;
  participantId: string;
  category: string;
  text: string;
  priority: string | null;
}

export interface VisualProposal {
  id: string;
  title: string;
  status: "draft" | "candidate" | "superseded" | "accepted";
  isActive: boolean;
}

export interface VisualConflict {
  id: string;
  proposalId: string;
  constraintId: string | null;
  severity: "blocking" | "warning";
  status: "open" | "resolved";
}

export interface VisualActivity {
  id: string;
  actorType: "participant" | "expert" | "system";
  actorId: string | null;
  origin:
    | "manual_ui"
    | "webmcp"
    | "simulation"
    | "expert_service"
    | "system";
  action: string;
  createdAt: string;
}

export interface RoomVisualizationState {
  roomId: string;
  phase: RoomPhase;
  participants: VisualParticipant[];
  constraints: VisualConstraint[];
  proposals: VisualProposal[];
  conflicts: VisualConflict[];
  recentActivity: VisualActivity[];
}

/**
 * Pure projection for the 3D scene. It performs no I/O and owns no canonical
 * state or business decisions.
 */
export function createRoomVisualizationState(
  room: RoomState,
): RoomVisualizationState {
  const votesByParticipant = new Map(
    room.votes
      .filter((vote) => vote.proposalId === room.activeProposalId)
      .map((vote) => [vote.participantId, vote.choice]),
  );
  const approvals = new Set(
    (room.finalDecisionPreview?.approvals ?? [])
      .map((approval) => approval.participantId),
  );

  return {
    roomId: room.id,
    phase: room.phase,
    participants: room.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      isClaimed: participant.isClaimed,
      isSelf: participant.id === room.selfParticipantId,
      vote: votesByParticipant.get(participant.id) ?? null,
      hasApprovedCurrentDecision: approvals.has(participant.id),
    })),
    constraints: room.constraints.map((constraint) => ({
      id: constraint.id,
      participantId: constraint.participantId,
      category: constraint.category,
      text: constraint.text,
      priority: constraint.priority,
    })),
    proposals: room.proposals.map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      isActive: proposal.id === room.activeProposalId,
    })),
    conflicts: room.conflicts.map((conflict) => ({
      id: conflict.id,
      proposalId: conflict.proposalId,
      constraintId: conflict.constraintId,
      severity: conflict.severity,
      status: conflict.status,
    })),
    recentActivity: room.activity.slice(-12).map((event) => ({
      id: event.id,
      actorType: event.actorType,
      actorId: event.actorId,
      origin: event.origin,
      action: event.action,
      createdAt: event.createdAt,
    })),
  };
}
