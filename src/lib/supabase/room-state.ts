import { z } from "zod";
import {
  finalDecisionPreviewSchema,
  roomStateSchema,
  type Approval,
  type RoomState,
} from "@/contracts/room";
import type { SupabaseClient } from "@supabase/supabase-js";

const roomRowSchema = z.object({
  id: z.string(), title: z.string(), brief: z.string(), demo_mode: z.string().nullable(), phase: z.string(),
  version: z.number(), active_proposal_id: z.string().nullable(),
  finalized_at: z.string().nullable(), decision_candidate: z.unknown().nullable(),
  decision_hash: z.string().nullable(),
});

function requireRows<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("Supabase returned no data.");
  return result.data;
}

export async function loadRoomState(
  client: SupabaseClient,
  roomId: string,
  authUserId: string,
): Promise<RoomState | null> {
  const roomResult = await client
    .from("rooms")
    .select("id,title,brief,demo_mode,phase,version,active_proposal_id,finalized_at,decision_candidate,decision_hash")
    .eq("id", roomId)
    .maybeSingle();
  if (roomResult.error) throw new Error(roomResult.error.message);
  if (!roomResult.data) return null;
  const room = roomRowSchema.parse(roomResult.data);

  const [participants, positions, constraints, proposals, conflicts, tradeoffs, votes, approvals, activity] =
    await Promise.all([
      client.from("participants").select("id,user_id,name,role,kind,required_for_approval,created_at").eq("room_id", roomId).order("seat_order"),
      client.from("positions").select("id,participant_id,summary,category,priority,created_at").eq("room_id", roomId).order("created_at"),
      client.from("constraints").select("id,participant_id,category,text,priority,created_at").eq("room_id", roomId).order("created_at"),
      client.from("proposals").select("id,participant_id,title,summary,rationale,expected_outcomes,referenced_constraint_ids,parent_proposal_id,status,created_at").eq("room_id", roomId).order("created_at"),
      client.from("conflicts").select("id,proposal_id,constraint_id,raised_by_actor_type,raised_by_actor_id,severity,reason,status,resolved_by_actor_type,resolved_by_actor_id,resolution_note,created_at,resolved_at").eq("room_id", roomId).order("created_at"),
      client.from("tradeoffs").select("id,conflict_ids,created_by_actor_type,created_by_actor_id,description,expected_effect,resulting_proposal_id,created_at").eq("room_id", roomId).order("created_at"),
      client.from("votes").select("proposal_id,participant_id,choice,comment,updated_at").eq("room_id", roomId).order("updated_at"),
      client.from("approvals").select("participant_id,decision_hash,approved_at").eq("room_id", roomId).order("approved_at"),
      client.from("audit_events").select("id,actor_type,actor_id,origin,action,entity_type,entity_id,sanitized_input,result,previous_room_version,resulting_room_version,confirmation_required,created_at").eq("room_id", roomId).order("created_at"),
    ]);

  const participantRows = requireRows(participants) as Array<Record<string, unknown>>;
  const approvalValues: Approval[] = (requireRows(approvals) as Array<Record<string, unknown>>).map((row) => ({
    participantId: row.participant_id as string,
    decisionHash: row.decision_hash as string,
    approvedAt: row.approved_at as string,
  }));
  const matchingApprovals = room.decision_hash
    ? approvalValues.filter((approval) => approval.decisionHash === room.decision_hash)
    : [];
  const requiredApprovalParticipantIds = participantRows
    .filter((participant) => participant.kind === "human" && participant.required_for_approval === true)
    .map((participant) => participant.id as string)
    .sort();
  const finalDecisionPreview = room.decision_candidate && room.decision_hash
    ? finalDecisionPreviewSchema.parse({
        ...(room.decision_candidate as Record<string, unknown>),
        decisionHash: room.decision_hash,
        approvals: matchingApprovals,
        missingApprovalParticipantIds: requiredApprovalParticipantIds.filter(
          (participantId) => !matchingApprovals.some(
            (approval) => approval.participantId === participantId,
          ),
        ),
      })
    : null;
  return roomStateSchema.parse({
    id: room.id,
    title: room.title,
    brief: room.brief,
    demoMode: room.demo_mode,
    phase: room.phase,
    version: room.version,
    selfParticipantId:
      (participantRows.find((participant) => participant.user_id === authUserId)?.id as string | undefined) ?? null,
    activeProposalId: room.active_proposal_id,
    finalizedAt: room.finalized_at,
    finalDecisionPreview,
    participants: participantRows.map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      isClaimed: participant.kind === "simulation" || participant.user_id !== null,
      // Placeholder until A-300 wires participants.ready_at into this projection.
      isReady: false,
      requiredForApproval: participant.required_for_approval,
      createdAt: participant.created_at,
    })),
    positions: (requireRows(positions) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, summary: row.summary,
      category: row.category, priority: row.priority, createdAt: row.created_at,
    })),
    constraints: (requireRows(constraints) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, category: row.category,
      text: row.text, priority: row.priority, createdAt: row.created_at,
    })),
    proposals: (requireRows(proposals) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, title: row.title,
      summary: row.summary, rationale: row.rationale,
      expectedOutcomes: row.expected_outcomes,
      referencedConstraintIds: row.referenced_constraint_ids,
      parentProposalId: row.parent_proposal_id, status: row.status, createdAt: row.created_at,
    })),
    conflicts: (requireRows(conflicts) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, proposalId: row.proposal_id, constraintId: row.constraint_id,
      raisedByActorType: row.raised_by_actor_type, raisedByActorId: row.raised_by_actor_id,
      severity: row.severity, reason: row.reason, status: row.status,
      resolvedByActorType: row.resolved_by_actor_type,
      resolvedByActorId: row.resolved_by_actor_id,
      resolutionNote: row.resolution_note,
      createdAt: row.created_at, resolvedAt: row.resolved_at,
    })),
    tradeoffs: (requireRows(tradeoffs) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, conflictIds: row.conflict_ids,
      createdByActorType: row.created_by_actor_type, createdByActorId: row.created_by_actor_id,
      description: row.description, expectedEffect: row.expected_effect,
      resultingProposalId: row.resulting_proposal_id, createdAt: row.created_at,
    })),
    votes: (requireRows(votes) as Array<Record<string, unknown>>).map((row) => ({
      proposalId: row.proposal_id, participantId: row.participant_id,
      choice: row.choice, comment: row.comment, updatedAt: row.updated_at,
    })),
    approvals: approvalValues,
    activity: (requireRows(activity) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, actorType: row.actor_type, actorId: row.actor_id, origin: row.origin,
      action: row.action, entityType: row.entity_type, entityId: row.entity_id,
      sanitizedInput: row.sanitized_input, result: row.result,
      previousRoomVersion: row.previous_room_version,
      resultingRoomVersion: row.resulting_room_version,
      confirmationRequired: row.confirmation_required, createdAt: row.created_at,
    })),
  });
}
