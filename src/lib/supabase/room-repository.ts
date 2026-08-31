import { z } from "zod";
import {
  actionResultSchema,
  decisionRecordSchema,
  finalDecisionPreviewSchema,
  joinRequestResultSchema,
  joinRequestSchema,
  meetingSourceContentSchema,
  meetingSourceSearchResultsSchema,
  meetingSourceSchema,
  roomInvitePreviewSchema,
  type ActionResult,
  type AddPositionInput,
  type AdmitJoinRequestInput,
  type ApproveFinalDecisionInput,
  type ExpressAlignmentInput,
  type ClaimSeatInput,
  type ConfigureParticipantInput,
  type CreateMeetingSourceInput,
  type CreateRoomInput,
  type ManageJoinRequestInput,
  type MarkMeetingSourceFailedInput,
  type MarkMeetingSourceProcessedInput,
  type MeetingSourceIdInput,
  type ReadMeetingSourceContentInput,
  type RecordExpertAdviceOutcomeInput,
  type RemoveParticipantInput,
  type RequestJoinByInviteInput,
  type RequestJoinByPasscodeInput,
  type RaiseObjectionInput,
  type ResolveObjectionInput,
  type ProposeTradeoffInput,
  type RoomPhase,
  type SearchMeetingSourcesInput,
  type SetDecisionPolicyInput,
  type SetParticipantDecisionRoleInput,
  type StartDemoScenarioInput,
  type SubmitProposalInput,
  type TransferOwnershipInput,
} from "@/contracts/room";
import { settleSoloDemoScenario } from "@/demo/orchestrator";
import type {
  CreatedRoomRecord,
  DomainActor,
  MutationContext,
  RoomRepository,
} from "@/domain/rooms/repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRoomState } from "./room-state";

/**
 * Database boundary shape for `create_room`. Deliberately not part of
 * `src/contracts/room.ts`: it carries raw invitation tokens, which the domain
 * layer converts into invite URLs and never serializes into `RoomState`.
 */
const createdRoomRecordSchema = z
  .object({
    roomId: z.string().min(1),
    ownerParticipantId: z.string().min(1),
    inviteToken: z.string().min(1),
    passcode: z.string().min(6),
  })
  .strict() satisfies z.ZodType<CreatedRoomRecord>;

export class SupabaseRoomRepository implements RoomRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getRoom(roomId: string, authUserId: string) {
    if (roomId === "demo") await settleSoloDemoScenario(this.client, roomId);
    return loadRoomState(this.client, roomId, authUserId);
  }

  createRoom(input: CreateRoomInput, actor: DomainActor) {
    return this.callWithData(
      "create_room",
      {
        p_title: input.title,
        p_brief: input.brief,
        p_creator_name: input.creatorName,
        p_creator_role: input.creatorRole,
        p_decision_policy: input.decisionPolicy ?? "owner_decides",
        p_origin: actor.origin,
      },
      createdRoomRecordSchema,
    );
  }

  /**
   * Pre-membership read. The RPC is SECURITY DEFINER because the caller holds
   * no seat yet, so no read policy can admit them; it answers with the narrow
   * preview DTO only, never with room state.
   */
  previewInvite(inviteToken: string, actor: DomainActor) {
    void actor;
    return this.callWithData(
      "preview_room_invite",
      { p_raw_token: inviteToken },
      roomInvitePreviewSchema,
    );
  }

  /**
   * Carries no expected room version: the caller cannot read the room before
   * the claim, so the database serializes the claim on the room row instead.
   */
  requestJoinByPasscode(input: RequestJoinByPasscodeInput, actor: DomainActor) {
    return this.callWithData(
      "request_join_by_passcode",
      { p_room_id: input.roomId, p_passcode: input.passcode, p_display_name: input.displayName, p_role: input.role, p_origin: actor.origin },
      joinRequestResultSchema,
    );
  }

  requestJoinByInvite(input: RequestJoinByInviteInput, actor: DomainActor) {
    return this.callWithData("request_join_by_invite", {
      p_raw_token: input.inviteToken, p_display_name: input.displayName,
      p_role: input.role, p_origin: actor.origin,
    }, joinRequestResultSchema);
  }

  getMyJoinRequest(joinRequestId: string, actor: DomainActor) {
    void actor;
    return this.callWithData("get_my_join_request", { p_join_request_id: joinRequestId }, joinRequestSchema);
  }

  listJoinRequests(roomId: string, actor: DomainActor) {
    void actor;
    return this.callWithData("list_join_requests", { p_room_id: roomId }, z.array(joinRequestSchema));
  }

  admitJoinRequest(roomId: string, input: AdmitJoinRequestInput, context: MutationContext) {
    return this.callWithData("admit_join_request", {
      p_room_id: roomId, p_join_request_id: input.joinRequestId,
      p_role: input.role ?? null, p_decision_role: input.decisionRole ?? null,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    }, joinRequestSchema);
  }

  rejectJoinRequest(roomId: string, input: ManageJoinRequestInput, context: MutationContext) {
    return this.callWithData("reject_join_request", {
      p_room_id: roomId, p_join_request_id: input.joinRequestId,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    }, joinRequestSchema);
  }

  claimSeat(roomId: string, input: ClaimSeatInput, context: MutationContext) {
    return this.call("claim_participant_seat", {
      p_room_id: roomId, p_seat_id: input.seatId,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  listSources(roomId: string, actor: DomainActor) {
    void actor;
    return this.callWithData(
      "list_meeting_sources",
      { p_room_id: roomId },
      z.array(meetingSourceSchema),
    );
  }

  createSource(
    roomId: string,
    input: CreateMeetingSourceInput,
    context: MutationContext,
  ) {
    return this.callWithData(
      "create_meeting_source",
      {
        p_room_id: roomId,
        p_expected_version: context.expectedRoomVersion,
        p_title: input.title,
        p_filename: input.filename,
        p_mime_type: input.mimeType,
        p_byte_size: input.byteSize,
        p_sha256: input.sha256,
        p_visibility: input.visibility,
        p_chunks: input.chunks,
        p_summary: input.summary,
        p_expects_extraction: input.expectsExtraction ?? false,
        p_storage_bucket: input.storageBucket ?? null,
        p_storage_path: input.storagePath ?? null,
        p_origin: context.actor.origin,
      },
      meetingSourceSchema,
    );
  }

  markSourceProcessed(
    roomId: string,
    input: MarkMeetingSourceProcessedInput,
    context: MutationContext,
  ) {
    return this.callWithData(
      "mark_meeting_source_processed",
      {
        p_room_id: roomId,
        p_source_id: input.sourceId,
        p_expected_version: context.expectedRoomVersion,
        p_chunks: input.chunks,
        p_summary: input.summary,
        p_origin: context.actor.origin,
      },
      meetingSourceSchema,
    );
  }

  markSourceFailed(
    roomId: string,
    input: MarkMeetingSourceFailedInput,
    context: MutationContext,
  ) {
    return this.callWithData(
      "mark_meeting_source_failed",
      {
        p_room_id: roomId,
        p_source_id: input.sourceId,
        p_expected_version: context.expectedRoomVersion,
        p_error_message: input.errorMessage,
        p_origin: context.actor.origin,
      },
      meetingSourceSchema,
    );
  }

  readSourceContent(
    roomId: string,
    input: ReadMeetingSourceContentInput,
    actor: DomainActor,
  ) {
    void actor;
    return this.callWithData(
      "read_meeting_source_content",
      {
        p_room_id: roomId,
        p_source_id: input.sourceId,
        p_cursor: input.cursor,
        p_max_chunks: input.maxChunks,
      },
      meetingSourceContentSchema,
    );
  }

  searchSources(
    roomId: string,
    input: SearchMeetingSourcesInput,
    actor: DomainActor,
  ) {
    void actor;
    return this.callWithData(
      "search_meeting_sources",
      {
        p_room_id: roomId,
        p_query: input.query,
        p_source_ids: input.sourceIds,
        p_limit: input.limit,
      },
      meetingSourceSearchResultsSchema,
    );
  }

  shareSource(
    roomId: string,
    input: MeetingSourceIdInput,
    context: MutationContext,
  ) {
    return this.callWithData(
      "share_meeting_source",
      {
        p_room_id: roomId,
        p_source_id: input.sourceId,
        p_expected_version: context.expectedRoomVersion,
        p_origin: context.actor.origin,
      },
      meetingSourceSchema,
    );
  }

  removeSource(
    roomId: string,
    input: MeetingSourceIdInput,
    context: MutationContext,
  ) {
    return this.call("remove_meeting_source", {
      p_room_id: roomId,
      p_source_id: input.sourceId,
      p_expected_version: context.expectedRoomVersion,
      p_origin: context.actor.origin,
    });
  }

  addPosition(roomId: string, input: AddPositionInput, context: MutationContext) {
    return this.call("add_participant_position", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_summary: input.summary, p_category: input.category, p_priority: input.priority,
      p_constraints: input.constraints.map((constraint) => ({
        ...constraint,
        referencedSourceIds: constraint.referencedSourceIds ?? [],
      })),
      p_referenced_source_ids: input.referencedSourceIds ?? [],
      p_origin: context.actor.origin,
    });
  }

  submitProposal(roomId: string, input: SubmitProposalInput, context: MutationContext) {
    return this.call("submit_participant_proposal", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_title: input.title, p_summary: input.summary, p_rationale: input.rationale,
      p_expected_outcomes: input.expectedOutcomes,
      p_referenced_constraint_ids: input.referencedConstraintIds,
      p_referenced_source_ids: input.referencedSourceIds ?? [],
      p_parent_proposal_id: input.parentProposalId, p_origin: context.actor.origin,
    });
  }

  raiseObjection(roomId: string, input: RaiseObjectionInput, context: MutationContext) {
    return this.call("raise_participant_objection", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_proposal_id: input.proposalId, p_constraint_id: input.constraintId,
      p_reason: input.reason, p_severity: input.severity, p_origin: context.actor.origin,
    });
  }

  resolveObjection(roomId: string, input: ResolveObjectionInput, context: MutationContext) {
    return this.call("resolve_participant_objection", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_conflict_id: input.conflictId,
      p_resolution_note: input.resolutionNote,
      p_origin: context.actor.origin,
    });
  }

  proposeTradeoff(roomId: string, input: ProposeTradeoffInput, context: MutationContext) {
    const revisedProposal = input.revisedProposal;
    if (!revisedProposal) {
      throw new Error("A revised proposal is required for participant trade-offs.");
    }
    return this.call("propose_participant_tradeoff", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_conflict_ids: input.conflictIds,
      p_description: input.description,
      p_expected_effect: input.expectedEffect,
      p_revised_title: revisedProposal.title,
      p_revised_summary: revisedProposal.summary,
      p_revised_rationale: revisedProposal.rationale,
      p_expected_outcomes: revisedProposal.expectedOutcomes,
      p_referenced_constraint_ids: revisedProposal.referencedConstraintIds,
      p_origin: context.actor.origin,
    });
  }

  expressAlignment(roomId: string, input: ExpressAlignmentInput, context: MutationContext) {
    return this.call("express_my_alignment", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_proposal_id: input.proposalId,
      p_choice: input.choice,
      p_comment: input.comment,
      p_origin: context.actor.origin,
    });
  }

  previewFinalDecision(roomId: string, authUserId: string) {
    void authUserId;
    return this.callWithData(
      "get_final_decision_preview",
      { p_room_id: roomId },
      finalDecisionPreviewSchema,
    );
  }

  approveFinalDecision(
    roomId: string,
    input: ApproveFinalDecisionInput,
    context: MutationContext,
  ) {
    return this.call("approve_participant_final_decision", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_decision_hash: input.decisionHash,
      p_human_confirmed: context.humanConfirmed === true,
      p_origin: context.actor.origin,
    });
  }

  getDecisionRecord(roomId: string, authUserId: string) {
    void authUserId;
    return this.callWithData(
      "get_persisted_decision_record",
      { p_room_id: roomId },
      decisionRecordSchema,
    );
  }

  markMyInputReady(roomId: string, context: MutationContext) {
    return this.call("mark_my_input_ready", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_origin: context.actor.origin,
    });
  }

  advanceRoomPhase(roomId: string, nextPhase: RoomPhase, context: MutationContext) {
    return this.call("advance_room_phase", {
      p_room_id: roomId,
      p_expected_version: context.expectedRoomVersion,
      p_next_phase: nextPhase,
      p_origin: context.actor.origin,
    });
  }

  advanceDemoPhase(roomId: string, nextPhase: RoomPhase, context: MutationContext) {
    return this.call("advance_demo_room_phase", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_next_phase: nextPhase, p_origin: context.actor.origin,
    });
  }

  startDemoScenario(
    roomId: string,
    input: StartDemoScenarioInput,
    authUserId: string,
  ) {
    void authUserId;
    return this.call("start_demo_scenario", {
      p_room_id: roomId,
      p_mode: input.mode,
      p_human_role: input.mode === "solo_judge" ? input.humanRole : null,
    });
  }

  lockMeeting(roomId: string, context: MutationContext) {
    return this.call("lock_meeting", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  unlockMeeting(roomId: string, context: MutationContext) {
    return this.call("unlock_meeting", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  removeParticipant(roomId: string, input: RemoveParticipantInput, context: MutationContext) {
    return this.call("remove_participant", {
      p_room_id: roomId, p_participant_id: input.participantId,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  transferOwnership(roomId: string, input: TransferOwnershipInput, context: MutationContext) {
    return this.call("transfer_ownership", {
      p_room_id: roomId, p_participant_id: input.participantId,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  setDecisionPolicy(roomId: string, input: SetDecisionPolicyInput, context: MutationContext) {
    return this.call("set_decision_policy", {
      p_room_id: roomId, p_decision_policy: input.decisionPolicy,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  setParticipantDecisionRole(
    roomId: string,
    input: SetParticipantDecisionRoleInput,
    context: MutationContext,
  ) {
    return this.call("set_participant_decision_role", {
      p_room_id: roomId, p_participant_id: input.participantId,
      p_decision_role: input.decisionRole,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  configureParticipant(
    roomId: string,
    input: ConfigureParticipantInput,
    context: MutationContext,
  ) {
    return this.call("configure_participant", {
      p_room_id: roomId, p_participant_id: input.participantId,
      p_role: input.role ?? null, p_decision_role: input.decisionRole ?? null,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  enableSecurityExpert(roomId: string, context: MutationContext) {
    return this.callWithData(
      "enable_security_expert",
      { p_room_id: roomId, p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin },
      z.object({ expertParticipantId: z.string().min(1) }).strict(),
    );
  }

  runSecurityExpertReview(roomId: string, context: MutationContext) {
    return this.callWithData(
      "run_security_expert_review",
      { p_room_id: roomId, p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin },
      z.object({ findingIds: z.array(z.string().min(1)) }).strict(),
    );
  }

  recordExpertAdviceOutcome(
    roomId: string,
    input: RecordExpertAdviceOutcomeInput,
    context: MutationContext,
  ) {
    return this.call("record_expert_advice_outcome", {
      p_room_id: roomId,
      p_finding_id: input.findingId,
      p_status: input.status,
      p_rationale: input.rationale,
      p_expected_version: context.expectedRoomVersion,
      p_origin: context.actor.origin,
    });
  }

  private async call(functionName: string, args: Record<string, unknown>): Promise<ActionResult> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw new Error(error.message);
    const result = actionResultSchema(z.null()).parse(data) as ActionResult;
    if (!result.ok || args.p_room_id !== "demo") return result;
    const settled = await settleSoloDemoScenario(this.client, "demo");
    return settled.ok ? { ...result, roomVersion: settled.roomVersion } : result;
  }

  private async callWithData<T>(
    functionName: string,
    args: Record<string, unknown>,
    dataSchema: z.ZodType<T>,
  ): Promise<ActionResult<T>> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw new Error(error.message);
    return actionResultSchema(dataSchema).parse(data) as ActionResult<T>;
  }
}
