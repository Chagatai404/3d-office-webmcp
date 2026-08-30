import type { RoomState } from "@/contracts/room";
import type { RoomWebMcpContext } from "@/webmcp/tool-context";
import type { OnboardingWebMcpContext } from "@/webmcp/onboarding-tools";

/** A minimal-but-complete `RoomState`, overridable per test. */
export function buildRoomStateFixture(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: "room-under-test",
    title: "Should we ship AI onboarding?",
    brief: "Decide whether to ship AI-assisted onboarding next release.",
    demoMode: null,
    phase: "input",
    version: 12,
    ownerParticipantId: "participant-owner",
    decisionPolicy: "owner_decides",
    isLocked: false,
    selfParticipantId: "participant-engineer",
    activeProposalId: null,
    finalizedAt: null,
    finalDecisionPreview: null,
    participants: [
      {
        id: "participant-owner",
        name: "Ata",
        role: "Founder",
        kind: "human",
        meetingRole: "owner",
        decisionRole: "decision_maker",
        isClaimed: true,
        isReady: true,
        status: "active",
        removedAt: null,
        createdAt: "2026-08-30T00:00:00.000Z",
      },
      {
        id: "participant-engineer",
        name: "Maya",
        role: "Engineer",
        kind: "human",
        meetingRole: "participant",
        decisionRole: "contributor",
        isClaimed: true,
        isReady: false,
        status: "active",
        removedAt: null,
        createdAt: "2026-08-30T00:00:01.000Z",
      },
    ],
    positions: [],
    constraints: [],
    proposals: [],
    conflicts: [],
    tradeoffs: [],
    alignments: [],
    approvals: [],
    activity: [],
    ...overrides,
  };
}

/**
 * The only part of `RoomWebMcpContext` a tool definition touches before it
 * reaches a domain operation: the observed room version, the seat this
 * browser session has claimed, a readable `RoomState`, and the owner-only
 * join-request list. Everything past that boundary -- anonymous auth,
 * Supabase, the domain operations themselves -- is covered by tests/domain
 * and the Playwright specs against a real server.
 */
export function fakeRoomWebMcpContext(
  overrides: {
    roomVersion?: number;
    selfParticipantId?: string | null;
    room?: RoomState;
  } = {},
): RoomWebMcpContext {
  const { roomVersion = 12, selfParticipantId = "participant-engineer" } = overrides;
  const room = overrides.room ?? buildRoomStateFixture({ version: roomVersion, selfParticipantId });
  return {
    roomId: "room-under-test",
    repository: {},
    getObservedRoomVersion: () => roomVersion,
    getObservedSelfParticipantId: () => selfParticipantId,
    getRoom: () => Promise.resolve(room),
    getOpenIssues: () => Promise.resolve([]),
    getDecisionRecord: () =>
      Promise.resolve({ ok: false, error: { code: "WRONG_PHASE", message: "Not finalized." }, roomVersion }),
    listJoinRequests: () => Promise.resolve({ ok: true, data: [], roomVersion } as never),
    mutationContext: () =>
      Promise.resolve({ actor: { authUserId: "auth-user-1", origin: "webmcp" as const }, expectedRoomVersion: roomVersion }),
  } as unknown as RoomWebMcpContext;
}

export function fakeOnboardingWebMcpContext(): OnboardingWebMcpContext {
  return {
    repository: {},
    getActor: () => Promise.resolve({ authUserId: "auth-user-1", origin: "webmcp" as const }),
  } as unknown as OnboardingWebMcpContext;
}

/** Arguments each participant mutation tool accepts, all otherwise valid. */
export const VALID_MUTATION_TOOL_INPUTS: Record<string, unknown> = {
  share_my_context: {
    summary: "Keep the milestone inside the current capacity.",
    category: "delivery",
    priority: "critical",
    constraints: [
      { category: "capacity", text: "No authentication rewrite.", priority: "critical" },
    ],
  },
  suggest_option: {
    title: "Progressive onboarding hints",
    summary: "Add two accessible hints to the existing flow.",
    rationale: "Fits the two-week capacity without new dependencies.",
    expectedOutcomes: ["Faster first value"],
    referencedConstraintIds: ["constraint-1"],
  },
  raise_concern: {
    proposalId: "proposal-1",
    constraintId: "constraint-1",
    reason: "The hint focus order needs an accessibility review.",
    severity: "blocking",
  },
  respond_to_concern: {
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
  resolve_my_concern: { conflictId: "conflict-1", resolutionNote: "Addressed by the revised proposal." },
  express_my_alignment: {
    proposalId: "proposal-1",
    choice: "support",
    comment: "Feasible within the current capacity.",
  },
  request_final_decision_confirmation: { decisionHash: "decision-hash-1" },
  admit_participant: { joinRequestId: "join-request-1" },
  reject_participant: { joinRequestId: "join-request-1" },
  set_decision_policy: { decisionPolicy: "equal_authority_consensus" },
  set_participant_decision_role: { participantId: "participant-engineer", decisionRole: "decision_maker" },
  remove_participant: { participantId: "participant-engineer" },
  transfer_ownership: { participantId: "participant-engineer" },
};

export function executeTool(
  tool: WebMcpToolDefinition,
  input: unknown,
): Promise<unknown> {
  return Promise.resolve(
    tool.execute(input, { signal: new AbortController().signal }),
  ).then((result) => JSON.parse(String(result)) as unknown);
}
