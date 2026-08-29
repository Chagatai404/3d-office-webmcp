import type {
  ActionOrigin,
  ActorType,
  RoomPhase,
  VoteChoice,
} from "@/contracts/room";

/**
 * Human-readable labels for canonical enum values.
 *
 * Presentation only. Origin and actor labels must never imply that a browser
 * agent or a simulated participant holds authority a human did not grant.
 */

export const PHASE_LABEL: Record<RoomPhase, string> = {
  input: "Input",
  proposals: "Proposals",
  deliberation: "Deliberation",
  voting: "Voting",
  approval: "Approval",
  finalized: "Finalized",
};

export const PHASE_FOCUS: Record<RoomPhase, string> = {
  input: "Participants publish their positions and constraints.",
  proposals: "Candidate proposals are drafted and one becomes active.",
  deliberation: "Objections, conflicts, and trade-offs are worked through.",
  voting: "Each participant evaluates the candidate for themselves.",
  approval: "Each required human reviews and authorizes the exact final plan.",
  finalized: "The decision record is immutable and fully attributable.",
};

/** The canonical phase order, used for the phase rail. */
export const PHASE_ORDER: readonly RoomPhase[] = [
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
  "finalized",
];

export const ORIGIN_LABEL: Record<ActionOrigin, string> = {
  manual_ui: "Manual",
  webmcp: "Browser agent",
  simulation: "Simulated",
  expert_service: "Advisory expert",
  system: "System",
};

export const ORIGIN_DESCRIPTION: Record<ActionOrigin, string> = {
  manual_ui: "A person acted directly in the interface.",
  webmcp: "A participant's browser agent acted within that participant's authority.",
  simulation: "A deterministic simulated participant acted. Not a real person.",
  expert_service: "An advisory expert service contributed. Experts never vote or approve.",
  system: "The room itself recorded this event.",
};

/** Short glyph paired with every origin label so colour is never the only cue. */
export const ORIGIN_GLYPH: Record<ActionOrigin, string> = {
  manual_ui: "●",
  webmcp: "◆",
  simulation: "▲",
  expert_service: "■",
  system: "◇",
};

export const ACTOR_TYPE_LABEL: Record<ActorType, string> = {
  participant: "Participant",
  expert: "Expert",
  system: "System",
};

export const VOTE_CHOICE_LABEL: Record<VoteChoice, string> = {
  support: "Support",
  oppose: "Oppose",
  abstain: "Abstain",
  request_changes: "Request changes",
};

/** Turns `position.added` into `Position added` for the ledger. */
export function formatActionName(action: string): string {
  const readable = action.replace(/[._]/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function formatTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return parsed.toISOString().slice(11, 19).concat(" UTC");
}
