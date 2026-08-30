"use client";

import type { ActionErrorCode, ActionResult } from "@/contracts/room";

/**
 * The single UI treatment for every `ActionResult`.
 *
 * BACKEND CONTRACT:
 * Production mutations return the same result family as the mock, including
 * `recovery` text. When the server supplies recovery guidance it wins; the
 * defaults below only fill the gap.
 */

const DEFAULT_RECOVERY: Record<ActionErrorCode, string> = {
  VALIDATION_ERROR: "Check the highlighted fields and try again.",
  NOT_AUTHORIZED:
    "Your seat does not carry authority for this action. Nothing was changed.",
  WRONG_PHASE:
    "This action is not available in the room's current phase.",
  STALE_ROOM_STATE:
    "The room changed before this action completed. Review the latest state and retry if the action is still appropriate.",
  UNRESOLVED_BLOCKING_CONFLICT:
    "A blocking objection is still open. Resolve it before continuing.",
  HUMAN_CONFIRMATION_REQUIRED:
    "This step needs an explicit human confirmation. Review it and confirm deliberately.",
  DECISION_CHANGED:
    "The final decision changed since you reviewed it. Return to final review and approve the updated plan.",
  ALREADY_FINALIZED:
    "This room is finalized. Its decision record is immutable.",
  INVALID_JOIN_CREDENTIALS:
    "Check the room ID, passcode, or invite link and try again.",
  ALREADY_PARTICIPANT:
    "This session is already a member of the room. Open it directly.",
  REQUEST_ALREADY_RESOLVED:
    "This join request was already resolved and cannot be resolved again.",
  MEETING_LOCKED:
    "This meeting is not accepting new participants right now.",
};

const ERROR_TITLE: Record<ActionErrorCode, string> = {
  VALIDATION_ERROR: "That input could not be accepted",
  NOT_AUTHORIZED: "Not authorized",
  WRONG_PHASE: "Not available in this phase",
  STALE_ROOM_STATE: "The room moved on",
  UNRESOLVED_BLOCKING_CONFLICT: "Blocking objection open",
  HUMAN_CONFIRMATION_REQUIRED: "Human confirmation required",
  DECISION_CHANGED: "The decision changed",
  ALREADY_FINALIZED: "Already finalized",
  INVALID_JOIN_CREDENTIALS: "That room access is invalid",
  ALREADY_PARTICIPANT: "Already a participant",
  REQUEST_ALREADY_RESOLVED: "Request already resolved",
  MEETING_LOCKED: "Meeting locked",
};

export function ActionFeedback({
  result,
}: {
  result: ActionResult<unknown> | null;
}) {
  if (!result) return null;

  if (result.ok) {
    return (
      <p className="feedback feedback-ok" role="status">
        <span className="feedback-title">Recorded</span>
        <span>{result.message}</span>
        <span className="feedback-meta">Room version {result.roomVersion}</span>
      </p>
    );
  }

  return (
    <div className="feedback feedback-error" role="alert">
      <span className="feedback-title">{ERROR_TITLE[result.error.code]}</span>
      <span>{result.error.message}</span>
      <span className="feedback-recovery">
        {result.error.recovery ?? DEFAULT_RECOVERY[result.error.code]}
      </span>
      <span className="feedback-meta">
        {result.error.code} · room version {result.roomVersion}
      </span>
    </div>
  );
}
