import type { ActivityEvent, ActorType, RoomState } from "@/contracts/room";

/**
 * `get_room_updates`'s domain projection (`src/webmcp/room-tools.ts`).
 *
 * Reuses the existing canonical audit trail (`RoomState.activity`, backed by
 * `public.audit_events` -- see `src/lib/supabase/room-state.ts`) as the one
 * and only event store. This module never writes anything and never invents
 * a second history; it only filters and labels events the domain already
 * recorded, exactly the way every mutation already recorded them.
 */

export type RoomUpdateType =
  | "room_created"
  | "join_requested"
  | "participant_admitted"
  | "join_rejected"
  | "participant_joined"
  | "participant_removed"
  | "participant_configured"
  | "decision_role_changed"
  | "ownership_transferred"
  | "input_shared"
  | "readiness_changed"
  | "proposal_submitted"
  | "proposal_revised"
  | "concern_raised"
  | "concern_resolved"
  | "tradeoff_proposed"
  | "alignment_changed"
  | "phase_changed"
  | "decision_policy_changed"
  | "meeting_locked"
  | "meeting_unlocked"
  | "approval_recorded"
  | "meeting_finalized"
  | "expert_enabled"
  | "expert_finding_raised"
  | "expert_finding_resolved"
  | "expert_finding_dispositioned"
  | "invitation_regenerated"
  | "invitation_revoked"
  | "demo_scenario_started"
  | "demo_reset"
  | "other";

/**
 * One raw audit `action` string almost always maps to exactly one
 * `RoomUpdateType`. `room.phase_advanced` / `demo.phase_advanced` are the
 * one exception: entering `approval` is also the moment the exact decision
 * candidate is frozen (see `apply_room_phase_entry`), so that single event
 * additionally carries `decisionHash` on the projected update instead of
 * being split into a second, redundant "candidate frozen" entry.
 */
const ACTION_TYPE: Record<string, RoomUpdateType> = {
  "room.created": "room_created",
  "join.requested": "join_requested",
  "join.admitted": "participant_admitted",
  "join.rejected": "join_rejected",
  "participant.seat_claimed": "participant_joined",
  "participant.removed": "participant_removed",
  "participant.configured": "participant_configured",
  "participant.decision_role_changed": "decision_role_changed",
  "ownership.transferred": "ownership_transferred",
  "position.added": "input_shared",
  "participant.input_ready": "readiness_changed",
  "proposal.submitted": "proposal_submitted",
  "objection.raised": "concern_raised",
  "conflict.resolved": "concern_resolved",
  "tradeoff.proposed": "tradeoff_proposed",
  "alignment.expressed": "alignment_changed",
  "alignment.updated": "alignment_changed",
  "room.phase_advanced": "phase_changed",
  "demo.phase_advanced": "phase_changed",
  "decision_policy.changed": "decision_policy_changed",
  "meeting.locked": "meeting_locked",
  "meeting.unlocked": "meeting_unlocked",
  "approval.recorded": "approval_recorded",
  "decision.finalized": "meeting_finalized",
  "expert.enabled": "expert_enabled",
  "expert_finding.raised": "expert_finding_raised",
  "expert_finding.resolved": "expert_finding_resolved",
  "expert_finding.disposition_recorded": "expert_finding_dispositioned",
  "invitation.regenerated": "invitation_regenerated",
  "invitation.revoked": "invitation_revoked",
  "demo.scenario_started": "demo_scenario_started",
  "app.demo_reset": "demo_reset",
};

/**
 * Events with no product-relevant state change worth surfacing to a polling
 * agent. `approval.requested` in particular fires on every
 * `approve_final_decision` call -- including the very first,
 * not-yet-confirmed one -- without bumping the room version at all
 * (`previousRoomVersion === resultingRoomVersion`), so it can never satisfy
 * this function's `resultingRoomVersion > sinceVersion` filter in the first
 * place; it is listed here only so the intent is explicit rather than
 * implicit in that filter's side effect.
 */
const IGNORED_ACTIONS = new Set(["approval.requested"]);

export interface RoomUpdate {
  id: string;
  type: RoomUpdateType;
  roomVersion: number;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  parentProposalId: string | null;
  changedFields: string[];
  decisionHash: string | null;
  summary: string;
  createdAt: string;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function changedConfigurationFields(event: ActivityEvent): string[] {
  if (event.action !== "participant.configured") return [];
  const input = objectValue(event.sanitizedInput);
  return ["role", "decisionRole"].filter((field) => {
    const change = objectValue(input?.[field]);
    return change !== null && change.from !== change.to;
  });
}

function describe(event: ActivityEvent, type: RoomUpdateType, actorName: string | null): string {
  const who = actorName ?? (event.actorType === "system" ? "The system" : "Someone");
  switch (type) {
    case "room_created": return `${who} created the room.`;
    case "join_requested": return `${who} requested to join.`;
    case "participant_admitted": return `${who} admitted a waiting join request.`;
    case "join_rejected": return `${who} rejected a waiting join request.`;
    case "participant_joined": return `${who} joined the meeting.`;
    case "participant_removed": return `${who} removed a participant.`;
    case "participant_configured": return `${who} changed a participant's role or decision authority.`;
    case "decision_role_changed": return `${who} changed a participant's decision authority.`;
    case "ownership_transferred": return `${who} transferred meeting ownership.`;
    case "input_shared": return `${who} shared new input.`;
    case "readiness_changed": return `${who} marked their input ready.`;
    case "proposal_submitted": return `${who} submitted a proposal.`;
    case "proposal_revised": return `${who} submitted a revision and superseded the previous proposal.`;
    case "concern_raised": return `${who} raised a concern.`;
    case "concern_resolved": return `${who} resolved a concern.`;
    case "tradeoff_proposed": return `${who} proposed a trade-off.`;
    case "alignment_changed": return `${who} shared or updated their alignment.`;
    case "phase_changed": return `${who} advanced the room phase.`;
    case "decision_policy_changed": return `${who} changed the decision policy.`;
    case "meeting_locked": return `${who} locked the meeting.`;
    case "meeting_unlocked": return `${who} unlocked the meeting.`;
    case "approval_recorded": return `${who} approved the final decision.`;
    case "meeting_finalized": return "The final decision was finalized.";
    case "expert_enabled": return `${who} enabled the Security Expert.`;
    case "expert_finding_raised": return "The Security Expert raised a new finding.";
    case "expert_finding_resolved": return "A Security Expert finding was resolved.";
    case "expert_finding_dispositioned": return `${who} recorded how a Security Expert finding was addressed.`;
    case "invitation_regenerated": return `${who} regenerated an invitation.`;
    case "invitation_revoked": return `${who} revoked an invitation.`;
    case "demo_scenario_started": return "The demo scenario was (re)started.";
    case "demo_reset": return "The demo room was reset.";
    default: return `${who} performed ${event.action}.`;
  }
}

export function computeRoomUpdates(room: RoomState, sinceVersion: number): RoomUpdate[] {
  const nameById = new Map(room.participants.map((participant) => [participant.id, participant.name]));
  return room.activity
    .filter((event) => event.resultingRoomVersion > sinceVersion && !IGNORED_ACTIONS.has(event.action))
    .map((event): RoomUpdate => {
      const sanitizedInput = objectValue(event.sanitizedInput);
      const parentProposalId = typeof sanitizedInput?.parentProposalId === "string"
        ? sanitizedInput.parentProposalId
        : null;
      const mappedType = ACTION_TYPE[event.action] ?? "other";
      const type = mappedType === "proposal_submitted" && parentProposalId
        ? "proposal_revised"
        : mappedType;
      const actorName = event.actorId ? nameById.get(event.actorId) ?? null : null;
      const decisionHash =
        type === "phase_changed" && typeof event.result === "object" && event.result !== null && !Array.isArray(event.result)
          ? (event.result as Record<string, unknown>).decisionHash
          : null;
      return {
        id: event.id,
        type,
        roomVersion: event.resultingRoomVersion,
        actorType: event.actorType,
        actorId: event.actorId,
        actorName,
        entityType: event.entityType,
        entityId: event.entityId,
        parentProposalId,
        changedFields: changedConfigurationFields(event),
        decisionHash: typeof decisionHash === "string" ? decisionHash : null,
        summary: describe(event, type, actorName),
        createdAt: event.createdAt,
      };
    })
    .sort((a, b) => (a.roomVersion - b.roomVersion) || a.createdAt.localeCompare(b.createdAt));
}
