import { z } from "zod";
import {
  actionResultSchema,
  claimInvitationResultSchema,
  decisionRecordSchema,
  finalDecisionPreviewSchema,
  roomInvitePreviewSchema,
  type ActionResult,
  type AddPositionInput,
  type ApproveFinalDecisionInput,
  type CastVoteInput,
  type ClaimInvitationInput,
  type ClaimSeatInput,
  type CreateRoomInput,
  type RaiseObjectionInput,
  type ResolveObjectionInput,
  type ProposeTradeoffInput,
  type RoomPhase,
  type StartDemoScenarioInput,
  type SubmitProposalInput,
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
    participantInvites: z.array(
      z
        .object({
          participantId: z.string().min(1),
          role: z.string().min(1),
          inviteToken: z.string().min(1),
        })
        .strict(),
    ),
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
        p_participants: input.participants,
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
  previewInvitation(inviteToken: string, actor: DomainActor) {
    void actor;
    return this.callWithData(
      "preview_room_invitation",
      { p_raw_token: inviteToken },
      roomInvitePreviewSchema,
    );
  }

  /**
   * Carries no expected room version: the caller cannot read the room before
   * the claim, so the database serializes the claim on the room row instead.
   */
  claimInvitation(input: ClaimInvitationInput, actor: DomainActor) {
    return this.callWithData(
      "claim_room_invitation",
      { p_raw_token: input.inviteToken, p_origin: actor.origin },
      claimInvitationResultSchema,
    );
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
