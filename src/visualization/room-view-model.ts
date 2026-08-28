import type {
  ActionOrigin,
  ActorType,
  ProposalStatus,
  RoomPhase,
  RoomState,
  VoteChoice,
} from "@/contracts/room";

/**
 * Presentation model for the 3D office.
 *
 * These types are derived views, not backend contracts, so they live here
 * rather than in `src/contracts/room.ts`. The scene receives this and nothing
 * else: it performs no I/O, owns no canonical state, and decides nothing.
 */

/** The environment is laid out for ten offices even when fewer are seated. */
export const OFFICE_SLOT_COUNT = 10;

/** Newest activity entries handed to the scene, oldest first. */
const RECENT_ACTIVITY_LIMIT = 12;

/**
 * Where a participant is standing in the office.
 *
 * Presentation only. This says where someone is, never what they are entitled
 * to do: a participant in the meeting room holds exactly the authority they
 * held in their office, and a simulated participant walking the floor holds
 * none a human did not grant.
 */
export type ParticipantPresence = "meeting" | "office" | "roaming";

/**
 * The phases in which the room convenes.
 *
 * Deliberation onward is shared work on one candidate, so everybody is at the
 * central table. Input and proposals are separate work, so everybody is in
 * their own office or moving between them.
 */
const CONVENING_PHASES: ReadonlySet<RoomPhase> = new Set<RoomPhase>([
  "deliberation",
  "voting",
  "approval",
  "finalized",
]);

export interface VisualParticipant {
  id: string;
  name: string;
  role: string;
  kind: "human" | "simulation";
  isClaimed: boolean;
  isSelf: boolean;
  /** Deterministic office assignment, stable for a given participant order. */
  officeSlot: number;
  /** Where they are right now, derived from the phase and their own input. */
  presence: ParticipantPresence;
  requiredForApproval: boolean;
  vote: VoteChoice | null;
  hasApprovedCurrentDecision: boolean;
}

export interface VisualOfficeSlot {
  index: number;
  status: "occupied" | "reserved";
  participantId: string | null;
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
  officeSlots: VisualOfficeSlot[];
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
 * Reads where a participant is from what the room has recorded.
 *
 * While the room convenes, everyone is at the table. Before that, a
 * participant who still owes the room their input is working in their own
 * office, and one who has already published is out on the floor. Nothing here
 * is a claim about the participant themselves — an empty office means an empty
 * record, not an absent person.
 */
function participantPresence(
  phase: RoomPhase,
  hasPublished: boolean,
): ParticipantPresence {
  if (CONVENING_PHASES.has(phase)) return "meeting";
  return hasPublished ? "roaming" : "office";
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

  // Publishing either a position or a constraint counts as having spoken.
  const hasPublished = new Set<string>([
    ...room.positions.map((position) => position.participantId),
    ...room.constraints.map((constraint) => constraint.participantId),
  ]);

  const participants: VisualParticipant[] = room.participants.map(
    (participant, index) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      isClaimed: participant.isClaimed,
      isSelf: participant.id === room.selfParticipantId,
      officeSlot: index,
      presence: participantPresence(
        room.phase,
        hasPublished.has(participant.id),
      ),
      requiredForApproval: participant.requiredForApproval,
      vote: votesByParticipant.get(participant.id) ?? null,
      hasApprovedCurrentDecision: approvedParticipantIds.has(participant.id),
    }),
  );

  const officeSlots: VisualOfficeSlot[] = Array.from(
    { length: OFFICE_SLOT_COUNT },
    (_unused, index) => {
      const occupant = participants.find(
        (participant) => participant.officeSlot === index,
      );
      return occupant
        ? { index, status: "occupied" as const, participantId: occupant.id }
        : { index, status: "reserved" as const, participantId: null };
    },
  );

  const proposals: VisualProposal[] = room.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    isActive: proposal.id === room.activeProposalId,
  }));

  const requiredApprovers = participants.filter(
    (participant) => participant.requiredForApproval,
  );

  return {
    roomId: room.id,
    phase: room.phase,
    version: room.version,

    participants,
    officeSlots,
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
