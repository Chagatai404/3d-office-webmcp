import type { RoomPhase } from "@/contracts/room";

/**
 * Example things to say to your own agent — never a script to follow.
 *
 * The demo used to hand a judge six numbered steps, which quietly taught
 * everyone that the room understood one exact sequence and nothing else. It
 * understands the protocol, not a sentence, so this is phrased as examples:
 * every line below is a normal question about the meeting, and none of them
 * is the only wording that works.
 *
 * Nothing here tells an agent to look at the page. Every one of these is
 * answerable through the room's WebMCP capabilities, which is the point —
 * if a prompt here needed the DOM, the protocol would have a hole in it.
 */

export interface AgentPromptGroup {
  title: string;
  prompts: string[];
}

/** Useful in any phase: the room is a shared, moving thing. */
const ALWAYS: AgentPromptGroup = {
  title: "Any time",
  prompts: [
    "Are we ready to move on?",
    "Who are we still waiting for?",
    "What changed since my last action?",
  ],
};

const BY_PHASE: Record<RoomPhase, AgentPromptGroup> = {
  input: {
    title: "While the room is gathering input",
    prompts: [
      "What has everyone shared so far?",
      "Share my constraints and mark me ready.",
    ],
  },
  proposals: {
    title: "While options are going on the table",
    prompts: [
      "What options are on the table?",
      "Put my option on the table and explain why.",
    ],
  },
  deliberation: {
    title: "While the room is working through objections",
    prompts: [
      "What is still blocking us?",
      "Raise my concern about the delivery window.",
      "Propose a trade-off that settles the blocking objection.",
    ],
  },
  voting: {
    title: "While the room is finding alignment",
    prompts: [
      "Show me where everyone stands.",
      "Share that I support this, with a note about timing.",
    ],
  },
  approval: {
    title: "While the decision is being reviewed",
    prompts: [
      "Prepare the final decision for my review.",
      "What exactly am I being asked to approve?",
    ],
  },
  finalized: {
    title: "After the decision is recorded",
    prompts: [
      "Summarize what we decided and why.",
      "Who owns the follow-up actions?",
    ],
  },
};

/** The phase's own examples first, then the ones that always apply. */
export function agentPromptGroups(phase: RoomPhase): AgentPromptGroup[] {
  return [BY_PHASE[phase], ALWAYS];
}

/** A single example for tight spaces, such as the input form's agent note. */
export function leadAgentPrompt(phase: RoomPhase): string {
  return BY_PHASE[phase].prompts[0]!;
}
