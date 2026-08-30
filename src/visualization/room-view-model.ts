import type {
  ActionOrigin,
  ActorType,
  DecisionRole,
  ProposalStatus,
  RoomPhase,
  RoomState,
  VoteChoice,
} from "@/contracts/room";

/**
 * Presentation model for the 3D meeting room.
 *
 * These types are derived views, not backend contracts, so they live here
 * rather than in `src/contracts/room.ts`. The scene receives this and nothing
 * else: it performs no I/O, owns no canonical state, and decides nothing.
 */

/** Newest activity entries handed to the scene, oldest first. */
const RECENT_ACTIVITY_LIMIT = 12;

export interface VisualParticipant {
  id: string;
  name: string;
  role: string;
  kind: "human" | "simulation";
  isClaimed: boolean;
  isSelf: boolean;
  /** Deterministic seat around the table, stable for a given participant order. */
  seatIndex: number;
  decisionRole: DecisionRole;
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
  status: ProposalStatus;
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
  actorType: ActorType;
  actorId: string | null;
  /** Resolved for display; the canonical event carries only `actorId`. */
  actorName: string;
  origin: ActionOrigin;
  action: string;
  createdAt: string;
}

export interface RoomVisualizationState {
  roomId: string;
  phase: RoomPhase;
  version: number;

  participants: VisualParticipant[];
  constraints: VisualConstraint[];
  proposals: VisualProposal[];
  activeProposal: VisualProposal | null;
  conflicts: VisualConflict[];
  recentActivity: VisualActivity[];

  consensus: {
    voteProgress: number;
    approvalProgress: number;
    hasBlockingConflict: boolean;
  };
}

/**
 * Picks the decision candidate the room is currently converging on.
 *
 * BACKEND CONTRACT:
 * Approval is bound to the exact `decisionHash` returned by the final preview.
 * This grouping is presentation only, so mixed-hash approvals never read as a
 * single consensus. Approval validity stays authoritative on the server.
 */
function currentDecisionHash(room: RoomState): string | null {
  const counts = new Map<string, number>();
  for (const approval of room.approvals) {
    counts.set(
      approval.decisionHash,
      (counts.get(approval.decisionHash) ?? 0) + 1,
    );
  }

  let current: string | null = null;
  let currentCount = 0;
  for (const [hash, count] of counts) {
    if (count > currentCount || (count === currentCount && current !== null && hash < current)) {
      current = hash;
      currentCount = count;
    }
  }
  return current;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * A neutral, empty projection for surfaces that render the room before any
 * canonical `RoomState` exists — the pre-meeting flow's decorative 3D
 * backdrop. It carries no real participants, boards, or activity: just enough
 * seats for the table to read as a meeting room behind the onboarding panels.
 */
export function createPlaceholderVisualizationState(
  options: { seatCount?: number; roomId?: string } = {},
): RoomVisualizationState {
  const seatCount = Math.max(0, options.seatCount ?? 4);

  const participants: VisualParticipant[] = Array.from(
    { length: seatCount },
    (_unused, index) => ({
      id: `placeholder-seat-${index}`,
      name: `Seat ${index + 1}`,
      role: "",
      kind: "human",
      isClaimed: false,
      isSelf: false,
      seatIndex: index,
      decisionRole: "contributor",
      vote: null,
      hasApprovedCurrentDecision: false,
    }),
  );

  return {
    roomId: options.roomId ?? "",
    phase: "input",
    version: 0,
    participants,
    constraints: [],
    proposals: [],
    activeProposal: null,
    conflicts: [],
    recentActivity: [],
    consensus: {
      voteProgress: 0,
      approvalProgress: 0,
      hasBlockingConflict: false,
    },
  };
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

  const decisionHash = currentDecisionHash(room);
  const approvedParticipantIds = new Set(
    room.approvals
      .filter((approval) => approval.decisionHash === decisionHash)
      .map((approval) => approval.participantId),
  );

  const participantNames = new Map(
    room.participants.map((participant) => [participant.id, participant.name]),
  );

  // Every participant has a seat at the one shared table, in join order.
  const participants: VisualParticipant[] = room.participants.map(
    (participant, index) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      isClaimed: participant.isClaimed,
      isSelf: participant.id === room.selfParticipantId,
      seatIndex: index,
      decisionRole: participant.decisionRole,
      vote: votesByParticipant.get(participant.id) ?? null,
      hasApprovedCurrentDecision: approvedParticipantIds.has(participant.id),
    }),
  );

  const proposals: VisualProposal[] = room.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    isActive: proposal.id === room.activeProposalId,
  }));

  // TODO(Slice 3+): replace legacy approval progress with policy-aware
  // alignment/finalization progress.
  const requiredApprovers = participants.filter(
    (participant) => participant.decisionRole === "decision_maker",
  );

  return {
    roomId: room.id,
    phase: room.phase,
    version: room.version,

    participants,
    constraints: room.constraints.map((constraint) => ({
      id: constraint.id,
      participantId: constraint.participantId,
      category: constraint.category,
      text: constraint.text,
      priority: constraint.priority,
    })),
    proposals,
    activeProposal: proposals.find((proposal) => proposal.isActive) ?? null,
    conflicts: room.conflicts.map((conflict) => ({
      id: conflict.id,
      proposalId: conflict.proposalId,
      constraintId: conflict.constraintId,
      severity: conflict.severity,
      status: conflict.status,
    })),
    recentActivity: room.activity
      .slice(-RECENT_ACTIVITY_LIMIT)
      .map((event) => ({
        id: event.id,
        actorType: event.actorType,
        actorId: event.actorId,
        actorName:
          (event.actorId ? participantNames.get(event.actorId) : null) ??
          (event.actorType === "system" ? "System" : "Unknown actor"),
        origin: event.origin,
        action: event.action,
        createdAt: event.createdAt,
      })),

    consensus: {
      voteProgress: room.activeProposalId
        ? ratio(votesByParticipant.size, participants.length)
        : 0,
      approvalProgress: ratio(
        requiredApprovers.filter(
          (participant) => participant.hasApprovedCurrentDecision,
        ).length,
        requiredApprovers.length,
      ),
      hasBlockingConflict: room.conflicts.some(
        (conflict) => conflict.severity === "blocking" && conflict.status === "open",
      ),
    },
  };
}
