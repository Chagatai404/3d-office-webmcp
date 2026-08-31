import {
  recordExpertAdviceOutcomeInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type RecordExpertAdviceOutcomeInput,
} from "@/contracts/room";
import type { MutationContext, RoomRepository } from "./repository";

function failure<T = null>(
  code: ActionErrorCode,
  message: string,
  roomVersion: number,
  recovery?: string,
): ActionResult<T> {
  return {
    ok: false,
    error: { code, message, ...(recovery ? { recovery } : {}) },
    roomVersion,
  };
}

/**
 * Owner-only. Enabling an already-enabled Security Expert is a defined,
 * idempotent success (the database enforces "only one Security Expert
 * instance per room" -- see `enable_security_expert` in the Slice 6
 * migration), not an error, so a browser agent never needs to check first.
 */
export async function enableSecurityExpert(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<ActionResult<{ expertParticipantId: string }>> {
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.enableSecurityExpert(roomId, context);
}

/**
 * Any active human participant may request a review of the active proposal.
 * The server derives the acting participant and the Security Expert
 * participant itself; no caller-supplied identity is ever trusted. Rejected
 * when no Security Expert is enabled yet, or when there is no active
 * proposal to review.
 */
export async function runSecurityExpertReview(
  repository: RoomRepository,
  roomId: string,
  context: MutationContext,
): Promise<ActionResult<{ findingIds: string[] }>> {
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.runSecurityExpertReview(roomId, context);
}

/**
 * Owner-only. Records how an unresolved piece of expert advice was
 * addressed -- resolved, accepted as risk, or rejected -- with a rationale.
 * This never gives the Security Expert itself any decision authority: it
 * only lets the human owner document their own judgment call. Rejected once
 * an exact decision candidate is frozen (return to Alignment first) so the
 * disposition is always reflected in the candidate that gets hashed.
 */
export async function recordExpertAdviceOutcome(
  repository: RoomRepository,
  roomId: string,
  input: RecordExpertAdviceOutcomeInput,
  context: MutationContext,
): Promise<ActionResult> {
  const parsed = recordExpertAdviceOutcomeInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure("VALIDATION_ERROR", "Expert advice disposition input is invalid.", context.expectedRoomVersion);
  }
  if (!context.actor.authUserId) {
    return failure("NOT_AUTHORIZED", "An authenticated session is required.", 0);
  }
  return repository.recordExpertAdviceOutcome(roomId, parsed.data, context);
}
