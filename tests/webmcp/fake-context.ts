import type { RoomWebMcpContext } from "@/webmcp/tool-context";

/**
 * The only part of `RoomWebMcpContext` a tool definition touches before it
 * reaches a domain operation: the observed room version and the seat this
 * browser session has claimed. Everything past that boundary — anonymous auth,
 * Supabase, the domain operations themselves — is covered by tests/domain and
 * the Playwright specs against a real server.
 */
export function fakeRoomWebMcpContext(
  overrides: {
    roomVersion?: number;
    selfParticipantId?: string | null;
  } = {},
): RoomWebMcpContext {
  const { roomVersion = 12, selfParticipantId = "participant-engineer" } = overrides;
  return {
    roomId: "room-under-test",
    getObservedRoomVersion: () => roomVersion,
    getObservedSelfParticipantId: () => selfParticipantId,
  } as unknown as RoomWebMcpContext;
}

/** Arguments each participant mutation tool accepts, all otherwise valid. */
export const VALID_MUTATION_TOOL_INPUTS: Record<string, unknown> = {
  add_my_position: {
    summary: "Keep the milestone inside the current capacity.",
    category: "delivery",
    priority: "critical",
    constraints: [
      { category: "capacity", text: "No authentication rewrite.", priority: "critical" },
    ],
  },
  submit_proposal: {
    title: "Progressive onboarding hints",
    summary: "Add two accessible hints to the existing flow.",
    rationale: "Fits the two-week capacity without new dependencies.",
    expectedOutcomes: ["Faster first value"],
    referencedConstraintIds: ["constraint-1"],
  },
  raise_objection: {
    proposalId: "proposal-1",
    constraintId: "constraint-1",
    reason: "The hint focus order needs an accessibility review.",
    severity: "blocking",
  },
  propose_tradeoff: {
    conflictIds: ["conflict-1"],
    description: "Keep the thin slice and define an accessible focus order.",
    expectedEffect: "Addresses the objection inside the two-week scope.",
    revisedProposal: {
      title: "Accessible progressive onboarding hints",
      summary: "Add two hints with a documented keyboard order.",
      rationale: "Keeps the scope and satisfies the accessibility concern.",
      expectedOutcomes: ["Accessible navigation"],
      referencedConstraintIds: ["constraint-1"],
    },
  },
  cast_my_vote: {
    proposalId: "proposal-1",
    choice: "support",
    comment: "Feasible within the current capacity.",
  },
  approve_final_decision: { decisionHash: "decision-hash-1" },
};

export function executeTool(
  tool: WebMcpToolDefinition,
  input: unknown,
): Promise<unknown> {
  return Promise.resolve(
    tool.execute(input, { signal: new AbortController().signal }),
  ).then((result) => JSON.parse(String(result)) as unknown);
}
