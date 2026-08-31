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
  version: z.number(), owner_participant_id: z.string(), decision_policy: z.string(),
  active_proposal_id: z.string().nullable(),
  finalized_at: z.string().nullable(), decision_candidate: z.unknown().nullable(),
  decision_hash: z.string().nullable(), is_locked: z.boolean(),
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
    .select("id,title,brief,demo_mode,phase,version,owner_participant_id,decision_policy,active_proposal_id,finalized_at,decision_candidate,decision_hash,is_locked")
    .eq("id", roomId)
    .maybeSingle();
  if (roomResult.error) throw new Error(roomResult.error.message);
  if (!roomResult.data) return null;
  const room = roomRowSchema.parse(roomResult.data);

  const [participants, positions, constraints, proposals, conflicts, tradeoffs, alignments, approvals, activity, expertFindings, sources] =
    await Promise.all([
      client.from("participants").select("id,user_id,name,role,kind,meeting_role,decision_role,required_for_approval,ready_at,status,removed_at,created_at").eq("room_id", roomId).order("seat_order"),
      client.from("positions").select("id,participant_id,summary,category,priority,referenced_source_ids,created_at").eq("room_id", roomId).order("created_at"),
      client.from("constraints").select("id,participant_id,category,text,priority,referenced_source_ids,created_at").eq("room_id", roomId).order("created_at"),
      client.from("proposals").select("id,participant_id,title,summary,rationale,expected_outcomes,referenced_constraint_ids,referenced_source_ids,parent_proposal_id,status,created_at").eq("room_id", roomId).order("created_at"),
      client.from("conflicts").select("id,proposal_id,constraint_id,raised_by_actor_type,raised_by_actor_id,severity,reason,status,resolved_by_actor_type,resolved_by_actor_id,resolution_note,created_at,resolved_at").eq("room_id", roomId).order("created_at"),
      client.from("tradeoffs").select("id,conflict_ids,created_by_actor_type,created_by_actor_id,description,expected_effect,resulting_proposal_id,created_at").eq("room_id", roomId).order("created_at"),
      client.from("alignments").select("proposal_id,participant_id,choice,comment,updated_at").eq("room_id", roomId).order("updated_at"),
      client.from("approvals").select("participant_id,decision_hash,approved_at").eq("room_id", roomId).order("approved_at"),
      client.from("audit_events").select("id,actor_type,actor_id,origin,action,entity_type,entity_id,sanitized_input,result,previous_room_version,resulting_room_version,confirmation_required,created_at").eq("room_id", roomId).order("created_at"),
      client.from("expert_findings").select("id,expert_participant_id,expert_key,proposal_id,category,title,summary,recommendation,status,resolution_rationale,created_at,resolved_at").eq("room_id", roomId).order("created_at"),
      client.from("meeting_sources").select("id,room_id,uploaded_by_participant_id,visibility,title,filename,mime_type,byte_size,sha256,status,summary,error_message,created_at,processed_at,removed_at").eq("room_id", roomId).order("created_at"),
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
  // Required approver authority is policy-aware (owner_decides vs.
  // equal_authority_consensus) and is computed server-side into the frozen
  // candidate itself; it is never re-derived here from the deprecated,
  // private `required_for_approval` column.
  const frozenCandidate = room.decision_candidate as Record<string, unknown> | null;
  const requiredApprovalParticipantIds = (
    (frozenCandidate?.requiredApprovalParticipantIds as string[] | undefined) ?? []
  ).slice().sort();
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
    ownerParticipantId: room.owner_participant_id,
    decisionPolicy: room.decision_policy,
    isLocked: room.is_locked,
    // A removed participant's row is never deleted (history must survive),
    // but it is no longer this session's active seat: `selfParticipantId`
    // stays null so every frontend "am I a member" check treats them the
    // same as someone who never joined, even while their historical rows
    // remain visible elsewhere in this same snapshot.
    selfParticipantId:
      (participantRows.find(
        (participant) => participant.user_id === authUserId && participant.status === "active",
      )?.id as string | undefined) ?? null,
    activeProposalId: room.active_proposal_id,
    finalizedAt: room.finalized_at,
    finalDecisionPreview,
    participants: participantRows.map((participant) => ({
      id: participant.id,
      name: participant.name,
      role: participant.role,
      kind: participant.kind,
      meetingRole: participant.meeting_role,
      decisionRole: participant.decision_role,
      // A simulation or expert seat is never an "open" human seat waiting to
      // be claimed -- both are always considered claimed regardless of the
      // (always-null) `user_id` behind them.
      isClaimed: participant.kind !== "human" || participant.user_id !== null,
      // `ready_at` is a server-set timestamp; the canonical DTO exposes only
      // whether the seat has declared its input complete.
      isReady: participant.ready_at !== null,
      status: participant.status,
      removedAt: participant.removed_at,
      createdAt: participant.created_at,
    })),
    positions: (requireRows(positions) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, summary: row.summary,
      category: row.category, priority: row.priority,
      referencedSourceIds: row.referenced_source_ids ?? [],
      createdAt: row.created_at,
    })),
    constraints: (requireRows(constraints) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, category: row.category,
      text: row.text, priority: row.priority,
      referencedSourceIds: row.referenced_source_ids ?? [],
      createdAt: row.created_at,
    })),
    proposals: (requireRows(proposals) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, participantId: row.participant_id, title: row.title,
      summary: row.summary, rationale: row.rationale,
      expectedOutcomes: row.expected_outcomes,
      referencedConstraintIds: row.referenced_constraint_ids,
      referencedSourceIds: row.referenced_source_ids ?? [],
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
    alignments: (requireRows(alignments) as Array<Record<string, unknown>>).map((row) => ({
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
    expertFindings: (requireRows(expertFindings) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id, roomId: room.id, expertParticipantId: row.expert_participant_id,
      expertKey: row.expert_key, proposalId: row.proposal_id, category: row.category,
      title: row.title, summary: row.summary, recommendation: row.recommendation,
      status: row.status, resolutionRationale: row.resolution_rationale,
      createdAt: row.created_at, resolvedAt: row.resolved_at,
    })),
    sources: (requireRows(sources) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id,
      roomId: row.room_id,
      uploadedByParticipantId: row.uploaded_by_participant_id,
      visibility: row.visibility,
      title: row.title,
      filename: row.filename,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      sha256: row.sha256,
      status: row.status,
      summary: row.summary,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      removedAt: row.removed_at,
    })),
  });
}
