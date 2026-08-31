import type {
  DecisionPolicy,
  DecisionRole,
  MeetingRole,
  Participant,
  RoomPhase,
  RoomState,
} from "@/contracts/room";

/**
 * The centralized capability model this slice adds: tool availability is a
 * pure function of ROUTE x PARTICIPANT STATUS x MEETING ROLE x DECISION ROLE
 * x PHASE x DECISION POLICY x ROOM STATE, computed once here rather than
 * scattered across React components. This drives *registration* only --
 * server authorization is unconditional and independent of it (every
 * mutation still re-derives authority from `auth.uid()` inside its own
 * transaction), so a stale captured tool reference still fails safely even
 * if this table would no longer register it.
 */
export type WebMcpRoute = "landing" | "create" | "join" | "room";

export interface WebMcpCapabilityContext {
  route: WebMcpRoute;
  hasClaimedSeat: boolean;
  isOwner: boolean;
  meetingRole: MeetingRole | null;
  decisionRole: DecisionRole | null;
  phase: RoomPhase | null;
  decisionPolicy: DecisionPolicy | null;
  isLocked: boolean;
  isFinalized: boolean;
  /** `finalDecisionPreview !== null` -- an exact candidate has been frozen. */
  candidateFrozen: boolean;
  hasActiveProposal: boolean;
  hasOpenBlockingConcern: boolean;
  /** Self is named in the frozen candidate's `missingApprovalParticipantIds`. */
  isRequiredApprover: boolean;
  /** Onboarding "join" route only: a join request is currently pending. */
  hasPendingJoinRequest: boolean;
  /** An active `kind = "expert"` participant already exists in this room. */
  hasSecurityExpert: boolean;
  /** At least one `expert_findings` row with `status = "open"` exists. */
  hasOpenExpertFinding: boolean;
}

export function deriveRoomCapabilityContext(room: RoomState): WebMcpCapabilityContext {
  const self: Participant | null =
    room.participants.find((participant) => participant.id === room.selfParticipantId) ?? null;
  const hasClaimedSeat = self?.status === "active" && self.isClaimed;
  const isOwner = hasClaimedSeat && self.id === room.ownerParticipantId && self.meetingRole === "owner";

  return {
    route: "room",
    hasClaimedSeat,
    isOwner,
    meetingRole: self?.meetingRole ?? null,
    decisionRole: self?.decisionRole ?? null,
    phase: room.phase,
    decisionPolicy: room.decisionPolicy,
    isLocked: room.isLocked,
    isFinalized: room.phase === "finalized",
    candidateFrozen: room.finalDecisionPreview !== null,
    hasActiveProposal: room.activeProposalId !== null,
    hasOpenBlockingConcern: room.conflicts.some(
      (conflict) => conflict.status === "open" && conflict.severity === "blocking",
    ),
    isRequiredApprover: hasClaimedSeat
      ? (room.finalDecisionPreview?.missingApprovalParticipantIds.includes(self.id) ?? false)
      : false,
    hasPendingJoinRequest: false,
    hasSecurityExpert: room.participants.some(
      (participant) => participant.kind === "expert" && participant.status === "active",
    ),
    hasOpenExpertFinding: room.expertFindings.some((finding) => finding.status === "open"),
  };
}

export function deriveOnboardingCapabilityContext(params: {
  route: "landing" | "create" | "join";
  hasPendingJoinRequest: boolean;
}): WebMcpCapabilityContext {
  return {
    route: params.route,
    hasClaimedSeat: false,
    isOwner: false,
    meetingRole: null,
    decisionRole: null,
    phase: null,
    decisionPolicy: null,
    isLocked: false,
    isFinalized: false,
    candidateFrozen: false,
    hasActiveProposal: false,
    hasOpenBlockingConcern: false,
    isRequiredApprover: false,
    hasPendingJoinRequest: params.hasPendingJoinRequest,
    hasSecurityExpert: false,
    hasOpenExpertFinding: false,
  };
}

type Predicate = (ctx: WebMcpCapabilityContext) => boolean;

const inRoom: Predicate = (c) => c.route === "room";
const asClaimedInPhase = (phase: RoomPhase): Predicate => (c) => inRoom(c) && c.hasClaimedSeat && c.phase === phase;
const asOwnerNotFinalized: Predicate = (c) => inRoom(c) && c.isOwner && !c.isFinalized;

/**
 * One predicate per tool name -- the audit point brief §35 asks for. Adding
 * a tool means adding one row here; nothing else decides whether it
 * registers.
 */
export const TOOL_AVAILABILITY: Record<string, Predicate> = {
  // Participant reads. Read tools stay available to an unclaimed session
  // that can already read the room (see `getRoomWebMcpToolsForPhase`'s
  // historical rationale, preserved here): an agent that can read the room
  // can explain it before its human has a seat.
  get_meeting_context: inRoom,
  get_current_decision: (c) => inRoom(c) && c.phase !== null && c.phase !== "input",
  get_my_attention_items: (c) => inRoom(c) && c.hasClaimedSeat && !c.isFinalized,
  get_open_issues: (c) => inRoom(c) && c.phase === "deliberation",
  get_alignment: (c) => inRoom(c) && c.phase === "voting",
  get_decision_record: (c) => inRoom(c) && c.isFinalized,

  // Participant writes -- always require a claimed seat.
  share_my_context: asClaimedInPhase("input"),
  mark_my_input_ready: asClaimedInPhase("input"),
  suggest_option: asClaimedInPhase("proposals"),
  raise_concern: asClaimedInPhase("deliberation"),
  respond_to_concern: asClaimedInPhase("deliberation"),
  resolve_my_concern: asClaimedInPhase("deliberation"),
  express_my_alignment: asClaimedInPhase("voting"),
  approve_final_decision: (c) =>
    inRoom(c) && c.hasClaimedSeat && c.phase === "approval" && c.isRequiredApprover,

  // Owner-only.
  get_waiting_participants: asOwnerNotFinalized,
  admit_participant: asOwnerNotFinalized,
  reject_participant: asOwnerNotFinalized,
  lock_meeting: (c) => asOwnerNotFinalized(c) && !c.isLocked,
  unlock_meeting: (c) => asOwnerNotFinalized(c) && c.isLocked,
  advance_discussion: (c) =>
    asOwnerNotFinalized(c) && (c.phase === "input" || (c.phase === "proposals" && c.hasActiveProposal)),
  request_team_alignment: (c) =>
    asOwnerNotFinalized(c) && c.phase === "deliberation" && c.hasActiveProposal && !c.hasOpenBlockingConcern,
  review_final_decision: (c) =>
    asOwnerNotFinalized(c) && c.phase === "voting" && c.hasActiveProposal && !c.hasOpenBlockingConcern,
  set_decision_policy: (c) => asOwnerNotFinalized(c) && !c.candidateFrozen,
  set_participant_decision_role: (c) => asOwnerNotFinalized(c) && !c.candidateFrozen,
  remove_participant: asOwnerNotFinalized,
  transfer_ownership: asOwnerNotFinalized,

  // Security Expert. Advisory only -- see src/domain/rooms/expert.ts. The
  // expert itself never registers a browser-tool session; these tools act
  // only for the authenticated human participant who calls them.
  enable_security_expert: (c) => asOwnerNotFinalized(c) && !c.hasSecurityExpert,
  request_security_review: (c) =>
    inRoom(c) && c.hasClaimedSeat && !c.isFinalized && c.hasSecurityExpert && c.hasActiveProposal,
  get_expert_advice: (c) => inRoom(c) && c.hasSecurityExpert,
  record_expert_advice_outcome: (c) =>
    asOwnerNotFinalized(c) && !c.candidateFrozen && c.hasOpenExpertFinding,

  // Pre-room.
  create_meeting: (c) => c.route === "landing" || c.route === "create",
  join_meeting: (c) => c.route === "landing" || c.route === "join",
  get_my_join_status: (c) => c.route === "join" && c.hasPendingJoinRequest,
};

export function getAvailableWebMcpToolNames(ctx: WebMcpCapabilityContext): string[] {
  return Object.entries(TOOL_AVAILABILITY)
    .filter(([, predicate]) => predicate(ctx))
    .map(([name]) => name);
}

/**
 * Every tool that writes on behalf of the authenticated session -- kept
 * here, alongside `TOOL_AVAILABILITY`, so the Agents & tools drawer can
 * split "explains the room" from "acts in the room" without constructing a
 * live tool context just to read `annotations.readOnlyHint` off each one.
 */
export const MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  "share_my_context",
  "mark_my_input_ready",
  "suggest_option",
  "raise_concern",
  "respond_to_concern",
  "resolve_my_concern",
  "express_my_alignment",
  "approve_final_decision",
  "admit_participant",
  "reject_participant",
  "lock_meeting",
  "unlock_meeting",
  "advance_discussion",
  "request_team_alignment",
  "review_final_decision",
  "set_decision_policy",
  "set_participant_decision_role",
  "remove_participant",
  "transfer_ownership",
  "enable_security_expert",
  "request_security_review",
  "record_expert_advice_outcome",
  "create_meeting",
  "join_meeting",
]);
