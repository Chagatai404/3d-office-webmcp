import type {
  ActionOrigin,
  ActorType,
  AlignmentChoice,
  DecisionRole,
  MeetingRole,
  ProposalStatus,
  RoomPhase,
  RoomState,
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
  kind: "human" | "simulation" | "expert";
  isClaimed: boolean;
  isSelf: boolean;
  /** Deterministic seat around the table, stable for a given participant order. */
  seatIndex: number;
  meetingRole: MeetingRole;
  decisionRole: DecisionRole;
  alignment: AlignmentChoice | null;
  alignmentComment: string | null;
  /** Whether this participant is currently a required approver under the room's decision policy. */
  isRequiredApprover: boolean;
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
  /** The objection text, echoed onto the Issues board. */
  reason: string;
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
  /** The decision title, shown on the Brief board. */
  title: string;
  /** The meeting brief, shown on the Brief board. */
  brief: string;
  phase: RoomPhase;
  version: number;

  participants: VisualParticipant[];
  constraints: VisualConstraint[];
  proposals: VisualProposal[];
  activeProposal: VisualProposal | null;
  conflicts: VisualConflict[];
  recentActivity: VisualActivity[];

  decisionPolicy: RoomState["decisionPolicy"];

  consensus: {
    /** Share of active humans who have shared alignment on the active proposal. Informative only — never decisive. */
    alignmentProgress: number;
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
      meetingRole: "participant",
      decisionRole: "contributor",
      alignment: null,
      alignmentComment: null,
      isRequiredApprover: false,
      hasApprovedCurrentDecision: false,
    }),
  );

  return {
    roomId: options.roomId ?? "",
    title: "",
    brief: "",
    phase: "input",
    version: 0,
    participants,
    constraints: [],
    proposals: [],
    activeProposal: null,
    conflicts: [],
    recentActivity: [],
    decisionPolicy: "owner_decides",
    consensus: {
      alignmentProgress: 0,
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
  const alignmentByParticipant = new Map(
    room.alignments
      .filter((alignment) => alignment.proposalId === room.activeProposalId)
      .map((alignment) => [alignment.participantId, alignment]),
  );

  const decisionHash = currentDecisionHash(room);
  const approvedParticipantIds = new Set(
    room.approvals
      .filter((approval) => approval.decisionHash === decisionHash)
      .map((approval) => approval.participantId),
  );
  const requiredApproverIds = new Set(
    room.finalDecisionPreview?.requiredApprovalParticipantIds ?? [],
  );

  const participantNames = new Map(
    room.participants.map((participant) => [participant.id, participant.name]),
  );

  // Every *active* participant has a seat at the one shared table, in join
  // order. A removed participant's chair disappears from the room the same
  // way it disappears from the roster; their historical contributions remain
  // reachable through activity/positions/alignments, never through a live seat.
  const participants: VisualParticipant[] = room.participants
    .filter((participant) => participant.status === "active")
    .map((participant, index) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      isClaimed: participant.isClaimed,
      isSelf: participant.id === room.selfParticipantId,
      seatIndex: index,
      meetingRole: participant.meetingRole,
      decisionRole: participant.decisionRole,
      alignment: alignmentByParticipant.get(participant.id)?.choice ?? null,
      alignmentComment: alignmentByParticipant.get(participant.id)?.comment ?? null,
      isRequiredApprover: requiredApproverIds.has(participant.id),
      hasApprovedCurrentDecision: approvedParticipantIds.has(participant.id),
    }));

  const proposals: VisualProposal[] = room.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    isActive: proposal.id === room.activeProposalId,
  }));

  const requiredApprovers = participants.filter(
    (participant) => participant.isRequiredApprover,
  );

  return {
    roomId: room.id,
    title: room.title,
    brief: room.brief,
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
      reason: conflict.reason,
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

    decisionPolicy: room.decisionPolicy,

    consensus: {
      alignmentProgress: room.activeProposalId
        ? ratio(alignmentByParticipant.size, participants.length)
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
