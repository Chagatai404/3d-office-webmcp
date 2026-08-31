import type {
  ActionOrigin,
  ActorType,
  AlignmentChoice,
  DecisionRole,
  MeetingRole,
  Participant,
  RoomPhase,
} from "@/contracts/room";

/**
 * Human-readable labels for canonical enum values.
 *
 * Presentation only. Origin and actor labels must never imply that a browser
 * agent or a simulated participant holds authority a human did not grant.
 *
 * This is the single, centralized place the internal phase enum is mapped to
 * user-facing language. The internal enum keeps its original values
 * (`voting`, `approval`) for database/migration stability, but the product
 * never says "Voting" or "Approval" to a person — it says "Alignment" and
 * "Decision". No other component should scatter its own
 * `phase === "voting" ? "Alignment" : ...` mapping; read it from here.
 */

export const PHASE_LABEL: Record<RoomPhase, string> = {
  input: "Input",
  proposals: "Proposals",
  deliberation: "Deliberation",
  voting: "Alignment",
  approval: "Decision",
  finalized: "Finalized",
};

export const PHASE_FOCUS: Record<RoomPhase, string> = {
  input: "Participants publish their positions and constraints.",
  proposals: "Candidate proposals are drafted and one becomes active.",
  deliberation: "Objections, conflicts, and trade-offs are worked through.",
  voting: "Participants share how they feel about the candidate — support, concerns, or objections.",
  approval: "The responsible decision authority reviews and confirms the exact final plan.",
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

/**
 * The three separate things a participant "is", in the words a judge uses.
 *
 * `role` is free text the person chose (CEO, CTO, Designer). The two enums
 * below are authority, and they are deliberately independent: administering
 * the meeting is not the same as deciding its outcome. Nothing in the UI
 * should print the raw enum value — read the label from here so "decision
 * maker" never reaches a person as `decision_maker`.
 */
export const MEETING_ROLE_LABEL: Record<MeetingRole, string> = {
  owner: "Owner",
  cohost: "Co-host",
  participant: "Participant",
};

export const MEETING_ROLE_NOTE: Record<MeetingRole, string> = {
  owner: "Runs the meeting: admits people, assigns authority, moves the room forward.",
  cohost: "Helps run the meeting alongside the owner.",
  participant: "Takes part in the meeting without administrative controls.",
};

export const DECISION_ROLE_LABEL: Record<DecisionRole, string> = {
  decision_maker: "Decision maker",
  contributor: "Contributor",
  advisor: "Advisor",
};

export const DECISION_ROLE_NOTE: Record<DecisionRole, string> = {
  decision_maker: "May review and confirm the final decision.",
  contributor: "Shapes the decision. Does not confirm it.",
  advisor: "Advises only — never aligns, approves, or owns the meeting.",
};

/**
 * `expert` is never described as a teammate here, and never as someone who
 * could hold authority: the label itself says advisory, so a judge reading a
 * participant card cannot mistake the Security Expert for a person who votes.
 */
export const PARTICIPANT_KIND_LABEL: Record<Participant["kind"], string> = {
  human: "Person",
  simulation: "Simulated teammate",
  expert: "Security Expert · Advisory",
};

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

export const ALIGNMENT_CHOICE_LABEL: Record<AlignmentChoice, string> = {
  support: "Support",
  concern: "Concern",
  strong_objection: "Strong objection",
  needs_clarification: "Need clarification",
};

/** Short glyph paired with every alignment choice, colour is never the only cue. */
export const ALIGNMENT_CHOICE_GLYPH: Record<AlignmentChoice, string> = {
  support: "✓",
  concern: "▲",
  strong_objection: "✕",
  needs_clarification: "?",
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
