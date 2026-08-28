import { z } from "zod";
import {
  actionResultSchema,
  decisionRecordSchema,
  finalDecisionPreviewSchema,
  type ActionResult,
  type AddPositionInput,
  type ApproveFinalDecisionInput,
  type CastVoteInput,
  type ClaimSeatInput,
  type RaiseObjectionInput,
  type ResolveObjectionInput,
  type ProposeTradeoffInput,
  type RoomPhase,
  type SubmitProposalInput,
} from "@/contracts/room";
import type { MutationContext, RoomRepository } from "@/domain/rooms/repository";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRoomState } from "./room-state";

export class SupabaseRoomRepository implements RoomRepository {
  constructor(private readonly client: SupabaseClient) {}

  getRoom(roomId: string, authUserId: string) {
    return loadRoomState(this.client, roomId, authUserId);
  }

  claimSeat(roomId: string, input: ClaimSeatInput, context: MutationContext) {
    return this.call("claim_participant_seat", {
      p_room_id: roomId, p_seat_id: input.seatId,
      p_expected_version: context.expectedRoomVersion, p_origin: context.actor.origin,
    });
  }

  addPosition(roomId: string, input: AddPositionInput, context: MutationContext) {
    return this.call("add_participant_position", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_summary: input.summary, p_category: input.category, p_priority: input.priority,
      p_constraints: input.constraints, p_origin: context.actor.origin,
    });
  }

  submitProposal(roomId: string, input: SubmitProposalInput, context: MutationContext) {
    return this.call("submit_participant_proposal", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_title: input.title, p_summary: input.summary, p_rationale: input.rationale,
      p_expected_outcomes: input.expectedOutcomes,
      p_referenced_constraint_ids: input.referencedConstraintIds,
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

  castVote(roomId: string, input: CastVoteInput, context: MutationContext) {
    return this.call("cast_participant_vote", {
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

  advanceDemoPhase(roomId: string, nextPhase: RoomPhase, context: MutationContext) {
    return this.call("advance_demo_room_phase", {
      p_room_id: roomId, p_expected_version: context.expectedRoomVersion,
      p_next_phase: nextPhase, p_origin: context.actor.origin,
    });
  }

  private async call(functionName: string, args: Record<string, unknown>): Promise<ActionResult> {
    const { data, error } = await this.client.rpc(functionName, args);
    if (error) throw new Error(error.message);
    return actionResultSchema(z.null()).parse(data) as ActionResult;
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
