import type {
  ActionOrigin,
  ActorType,
  DecisionRole,
  ProposalStatus,
  RoomPhase,
  RoomState,
  VoteChoice,
} from "@/contracts/room";
import {
  CONSTRAINT_CARD_CAPACITY,
  OFFICE_SLOT_COUNT,
  corridorSpot,
  meetingSeats,
  officePlacements,
  officeStandingSpot,
  slotColor,
  type PlanPoint,
} from "./floorplan-layout";

/**
 * Presentation model for the 2D floor plan.
 *
 * A pure, deterministic projection of canonical `RoomState`. It performs no
 * I/O, owns no canonical state, and decides nothing: the plan components
 * receive this and nothing else.
 *
 * The 3D scene has its own projection in `visualization/room-view-model.ts`.
 * The two are deliberately independent — both read the same contract, and
 * neither is downstream of the other — so a change to one surface can never
 * silently redraw the other.
 */

export type OfficeZoneId = `office-${number}`;

export type PlanZoneId =
  | "meeting-room"
  | "constraint-wall"
  | "common-area"
  | OfficeZoneId;

export function officeZoneId(index: number): OfficeZoneId {
  return `office-${index}`;
}

/** `office-3` -> 3, anything else -> null. */
export function officeIndexOf(zone: PlanZoneId): number | null {
  const match = /^office-(\d+)$/.exec(zone);
  if (!match?.[1]) return null;
  const index = Number.parseInt(match[1], 10);
  return index >= 0 && index < OFFICE_SLOT_COUNT ? index : null;
}

/**
 * Where a person is standing on the plan.
 *
 * Presentation only. A place is never a claim about authority: someone at the
 * table holds exactly the authority they held in their own office.
 */
export type PlanPlace = "meeting" | "office" | "corridor";

/** The phases in which the room convenes around one candidate. */
const CONVENING_PHASES: ReadonlySet<RoomPhase> = new Set<RoomPhase>([
  "deliberation",
  "voting",
  "approval",
  "finalized",
]);

export interface PlanParticipant {
  id: string;
  name: string;
  role: string;
  kind: "human" | "simulation";
  isSelf: boolean;
  /** Deterministic office assignment, stable for a given participant order. */
  officeSlot: number;
  color: string;
  /** Two letters for the avatar puck, since the plan has no photographs. */
  initials: string;
  place: PlanPlace;
  /** Where the puck is drawn, in plan units. */
  at: PlanPoint;
  decisionRole: DecisionRole;
  vote: VoteChoice | null;
  hasApprovedCurrentDecision: boolean;
  positionCount: number;
  constraintCount: number;
}

export interface PlanOffice {
  index: number;
  zoneId: OfficeZoneId;
  status: "occupied" | "reserved";
  color: string;
  participant: PlanParticipant | null;
}

export interface PlanConstraintCard {
  id: string;
  /** Grid position on the constraint board, or null when it overflows. */
  slot: number | null;
  participantId: string;
  ownerName: string;
  ownerInitials: string;
  color: string;
  category: string;
  text: string;
  priority: string | null;
}

export interface PlanProposal {
  id: string;
  title: string;
  summary: string;
  status: ProposalStatus;
  isActive: boolean;
}

export interface PlanConflict {
  id: string;
  proposalId: string;
  constraintId: string | null;
  severity: "blocking" | "warning";
  status: "open" | "resolved";
  reason: string;
}

export interface PlanActivity {
  id: string;
  actorType: ActorType;
  actorId: string | null;
  /** Resolved for display; the canonical event carries only `actorId`. */
  actorName: string;
  origin: ActionOrigin;
  action: string;
  createdAt: string;
}

export interface FloorPlanState {
  roomId: string;
  title: string;
  brief: string;
  phase: RoomPhase;
  version: number;

  self: PlanParticipant | null;
  participants: PlanParticipant[];
  offices: PlanOffice[];

  meeting: {
    activeProposal: PlanProposal | null;
    proposals: PlanProposal[];
    seated: PlanParticipant[];
  };

  constraintCards: PlanConstraintCard[];
  /** Cards the board could not fit, still fully listed in the detail rail. */
  constraintOverflow: number;

  /** Room-wide signals: what the common area is for. */
  common: {
    openConflicts: PlanConflict[];
    blockingCount: number;
    warningCount: number;
    publishedCount: number;
    seatedCount: number;
    recentActivity: PlanActivity[];
  };

  consensus: {
    voteProgress: number;
    approvalProgress: number;
    hasBlockingConflict: boolean;
  };

  activity: PlanActivity[];
}

/**
 * Picks the decision candidate the room is currently converging on.
 *
 * BACKEND CONTRACT:
 * Approval is bound to the exact `decisionHash` returned by the final preview.
 * Grouping by hash here is presentation only, so approvals of a superseded
 * plan never read as consensus on the current one. Validity stays server-side.
 */
function currentDecisionHash(room: RoomState): string | null {
  const counts = new Map<string, number>();
  for (const approval of room.approvals) {
    counts.set(approval.decisionHash, (counts.get(approval.decisionHash) ?? 0) + 1);
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

/** Two letters, taken from the name the room already holds. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "?";
  const last = words.length > 1 ? words[words.length - 1]?.[0] : words[0]?.[1];
  return `${first}${last ?? ""}`.toUpperCase();
}

/**
 * Reads where someone is standing from what the room has recorded.
 *
 * While the room convenes, everyone is at the table. Before that, a
 * participant who still owes the room their input is working in their own
 * office, and one who has already published is out on the floor. An empty
 * office means an empty record, never an absent person.
 */
function placeOf(phase: RoomPhase, hasPublished: boolean): PlanPlace {
  if (CONVENING_PHASES.has(phase)) return "meeting";
  return hasPublished ? "corridor" : "office";
}

export function createFloorPlanState(room: RoomState): FloorPlanState {
  const placements = officePlacements();
  const seats = meetingSeats();

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

  const positionCounts = new Map<string, number>();
  for (const position of room.positions) {
    positionCounts.set(
      position.participantId,
      (positionCounts.get(position.participantId) ?? 0) + 1,
    );
  }

  const constraintCounts = new Map<string, number>();
  for (const constraint of room.constraints) {
    constraintCounts.set(
      constraint.participantId,
      (constraintCounts.get(constraint.participantId) ?? 0) + 1,
    );
  }

  const hasPublished = new Set<string>([
    ...positionCounts.keys(),
    ...constraintCounts.keys(),
  ]);

  const participants: PlanParticipant[] = room.participants.map(
    (participant, index) => {
      const officeSlot = index % OFFICE_SLOT_COUNT;
      const place = placeOf(room.phase, hasPublished.has(participant.id));
      const placement = placements[officeSlot];
      const seat = seats[officeSlot];

      const at: PlanPoint =
        place === "meeting" && seat
          ? seat.position
          : place === "office" && placement
            ? officeStandingSpot(placement)
            : corridorSpot(officeSlot);

      return {
        id: participant.id,
        name: participant.name,
        role: participant.role,
        kind: participant.kind,
        isSelf: participant.id === room.selfParticipantId,
        officeSlot,
        color: slotColor(officeSlot),
        initials: initialsOf(participant.name),
        place,
        at,
        decisionRole: participant.decisionRole,
        vote: votesByParticipant.get(participant.id) ?? null,
        hasApprovedCurrentDecision: approvedParticipantIds.has(participant.id),
        positionCount: positionCounts.get(participant.id) ?? 0,
        constraintCount: constraintCounts.get(participant.id) ?? 0,
      };
    },
  );

  const bySlot = new Map(participants.map((person) => [person.officeSlot, person]));

  const offices: PlanOffice[] = Array.from(
    { length: OFFICE_SLOT_COUNT },
    (_unused, index) => {
      const occupant = bySlot.get(index) ?? null;
      return {
        index,
        zoneId: officeZoneId(index),
        status: occupant ? ("occupied" as const) : ("reserved" as const),
        color: slotColor(index),
        participant: occupant,
      };
    },
  );

  const participantsById = new Map(participants.map((person) => [person.id, person]));

  const constraintCards: PlanConstraintCard[] = room.constraints.map(
    (constraint, index) => {
      const owner = participantsById.get(constraint.participantId) ?? null;
      return {
        id: constraint.id,
        slot: index < CONSTRAINT_CARD_CAPACITY ? index : null,
        participantId: constraint.participantId,
        ownerName: owner?.name ?? "Unknown participant",
        ownerInitials: owner?.initials ?? "??",
        color: owner?.color ?? "#6b7480",
        category: constraint.category,
        text: constraint.text,
        priority: constraint.priority,
      };
    },
  );

  const proposals: PlanProposal[] = room.proposals.map((proposal) => ({
    id: proposal.id,
    title: proposal.title,
    summary: proposal.summary,
    status: proposal.status,
    isActive: proposal.id === room.activeProposalId,
  }));

  const openConflicts: PlanConflict[] = room.conflicts
    .filter((conflict) => conflict.status === "open")
    .map((conflict) => ({
      id: conflict.id,
      proposalId: conflict.proposalId,
      constraintId: conflict.constraintId,
      severity: conflict.severity,
      status: conflict.status,
      reason: conflict.reason,
    }));

  const participantNames = new Map(
    room.participants.map((participant) => [participant.id, participant.name]),
  );

  const activity: PlanActivity[] = room.activity.map((event) => ({
    id: event.id,
    actorType: event.actorType,
    actorId: event.actorId,
    actorName:
      (event.actorId ? participantNames.get(event.actorId) : null) ??
      (event.actorType === "system" ? "System" : "Unknown actor"),
    origin: event.origin,
    action: event.action,
    createdAt: event.createdAt,
  }));

  const requiredApprovers = participants.filter(
    (person) => person.decisionRole === "decision_maker",
  );

  return {
    roomId: room.id,
    title: room.title,
    brief: room.brief,
    phase: room.phase,
    version: room.version,

    self: participants.find((person) => person.isSelf) ?? null,
    participants,
    offices,

    meeting: {
      activeProposal: proposals.find((proposal) => proposal.isActive) ?? null,
      proposals,
      seated: participants.filter((person) => person.place === "meeting"),
    },

    constraintCards,
    constraintOverflow: Math.max(
      0,
      constraintCards.length - CONSTRAINT_CARD_CAPACITY,
    ),

    common: {
      openConflicts,
      blockingCount: openConflicts.filter((c) => c.severity === "blocking").length,
      warningCount: openConflicts.filter((c) => c.severity === "warning").length,
      publishedCount: hasPublished.size,
      seatedCount: participants.length,
      recentActivity: activity.slice(-6),
    },

    consensus: {
      voteProgress: room.activeProposalId
        ? ratio(votesByParticipant.size, participants.length)
        : 0,
      approvalProgress: ratio(
        requiredApprovers.filter((person) => person.hasApprovedCurrentDecision).length,
        requiredApprovers.length,
      ),
      hasBlockingConflict: room.conflicts.some(
        (conflict) => conflict.severity === "blocking" && conflict.status === "open",
      ),
    },

    activity,
  };
}
