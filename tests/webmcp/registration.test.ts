import { describe, expect, it } from "vitest";
import { roomPhaseSchema, type RoomPhase, type RoomState } from "@/contracts/room";
import { createAttentionWebMcpTool } from "@/webmcp/attention";
import {
  deriveRoomCapabilityContext,
  getAvailableWebMcpToolNames,
  MUTATION_TOOL_NAMES,
} from "@/webmcp/capability-context";
import { createRoomWebMcpTools } from "@/webmcp/room-tools";
import { buildRoomStateFixture, fakeRoomWebMcpContext } from "./fake-context";

const context = fakeRoomWebMcpContext();
const fullCatalog = { ...createRoomWebMcpTools(context), ...createAttentionWebMcpTool(context) };

const LIFECYCLE: readonly RoomPhase[] = [
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
  "finalized",
];

function available(room: RoomState): string[] {
  return getAvailableWebMcpToolNames(deriveRoomCapabilityContext(room)).sort();
}

describe("centralized WebMCP capability registration", () => {
  it("covers every canonical phase and no invented one", () => {
    expect(LIFECYCLE).toEqual(roomPhaseSchema.options);
  });

  it("registers no mutation tool before a seat is claimed, in any phase", () => {
    for (const phase of LIFECYCLE) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: null });
      const names = available(room);
      expect(names.filter((name) => MUTATION_TOOL_NAMES.has(name))).toEqual([]);
      expect(names).toContain("get_meeting_context");
    }
  });

  it("registers the owner's full participant + owner catalogue during Input", () => {
    const room = buildRoomStateFixture({ phase: "input", selfParticipantId: "participant-owner" });
    expect(available(room)).toEqual(
      [
        "advance_discussion",
        "admit_participant",
        "configure_participant",
        "enable_security_expert",
        "get_coordination_status",
        "get_meeting_context",
        "get_my_attention_items",
        "get_room_updates",
        "get_waiting_participants",
        "lock_meeting",
        "mark_my_input_ready",
        "reject_participant",
        "remove_participant",
        "set_decision_policy",
        "set_participant_decision_role",
        "share_my_context",
        "transfer_ownership",
      ].sort(),
    );
  });

  it("registers exactly the milestone participant tools through the lifecycle for a claimed non-owner", () => {
    // `advance_discussion` appears in Input for this contributor fixture
    // because procedural progression is open to any active claimed human,
    // not owner-gated -- see the dedicated A4 tests below. It does not
    // reappear in Proposals/Deliberation/Voting here only because this
    // fixture never sets an active proposal, which every later transition
    // requires regardless of who calls it.
    const byPhase = LIFECYCLE.map((phase) => {
      const room = buildRoomStateFixture({ phase, selfParticipantId: "participant-engineer" });
      return available(room).filter((name) => !name.startsWith("get_"));
    });
    expect(byPhase).toEqual([
      ["advance_discussion", "mark_my_input_ready", "share_my_context"],
      ["suggest_option"],
      ["raise_concern", "resolve_my_concern", "respond_to_concern"],
      ["express_my_alignment"],
      [], // approval: contributor is never a required approver under owner_decides
      [],
    ]);
  });

  it("withholds genuinely owner-only administration from a non-owner claimed participant", () => {
    for (const phase of LIFECYCLE) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: "participant-engineer" });
      const names = available(room);
      for (const ownerTool of [
        "get_waiting_participants",
        "admit_participant",
        "reject_participant",
        "lock_meeting",
        "unlock_meeting",
        "set_decision_policy",
        "set_participant_decision_role",
        "remove_participant",
        "transfer_ownership",
      ]) {
        expect(names, `${phase}: ${ownerTool}`).not.toContain(ownerTool);
      }
    }
  });

  describe("A4: procedural progression vs decision-authority gating", () => {
    it("registers advance_discussion and request_team_alignment for a non-owner contributor once prerequisites are met", () => {
      const toProposals = buildRoomStateFixture({ phase: "input", selfParticipantId: "participant-engineer" });
      expect(available(toProposals)).toContain("advance_discussion");

      const toDeliberation = buildRoomStateFixture({
        phase: "proposals", selfParticipantId: "participant-engineer", activeProposalId: "proposal-1",
      });
      expect(available(toDeliberation)).toContain("advance_discussion");

      const toAlignment = buildRoomStateFixture({
        phase: "deliberation", selfParticipantId: "participant-engineer", activeProposalId: "proposal-1",
      });
      expect(available(toAlignment)).toContain("request_team_alignment");
    });

    it("withholds review_final_decision from a non-owner contributor even with an active, unblocked proposal", () => {
      const room = buildRoomStateFixture({
        phase: "voting", selfParticipantId: "participant-engineer", activeProposalId: "proposal-1",
      });
      expect(available(room)).not.toContain("review_final_decision");
    });

    it("registers review_final_decision for a non-owner decision-maker, not just the owner", () => {
      const baseline = buildRoomStateFixture();
      const room = buildRoomStateFixture({
        phase: "voting",
        selfParticipantId: "participant-engineer",
        activeProposalId: "proposal-1",
        participants: baseline.participants.map((participant) =>
          participant.id === "participant-engineer"
            ? { ...participant, decisionRole: "decision_maker" as const }
            : participant,
        ),
      });
      expect(available(room)).toContain("review_final_decision");
    });

    it("still withholds true owner administration from a non-owner decision-maker", () => {
      const baseline = buildRoomStateFixture();
      const room = buildRoomStateFixture({
        phase: "input",
        selfParticipantId: "participant-engineer",
        participants: baseline.participants.map((participant) =>
          participant.id === "participant-engineer"
            ? { ...participant, decisionRole: "decision_maker" as const }
            : participant,
        ),
      });
      const names = available(room);
      for (const ownerTool of ["admit_participant", "remove_participant", "transfer_ownership", "set_decision_policy"]) {
        expect(names, ownerTool).not.toContain(ownerTool);
      }
    });
  });

  it("never registers lock_meeting and unlock_meeting at the same time", () => {
    const open = buildRoomStateFixture({ selfParticipantId: "participant-owner", isLocked: false });
    const locked = buildRoomStateFixture({ selfParticipantId: "participant-owner", isLocked: true });
    expect(available(open)).toContain("lock_meeting");
    expect(available(open)).not.toContain("unlock_meeting");
    expect(available(locked)).toContain("unlock_meeting");
    expect(available(locked)).not.toContain("lock_meeting");
  });

  it("only offers progression tools when the active candidate is structurally ready", () => {
    const blocked = buildRoomStateFixture({
      phase: "deliberation",
      selfParticipantId: "participant-owner",
      activeProposalId: "proposal-1",
      conflicts: [{
        id: "conflict-1", proposalId: "proposal-1", constraintId: null,
        raisedByActorType: "participant", raisedByActorId: "participant-owner",
        severity: "blocking", reason: "Must be resolved", status: "open",
        resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
        createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
      }],
    });
    expect(available(blocked)).not.toContain("request_team_alignment");
    expect(available({ ...blocked, conflicts: [] })).toContain("request_team_alignment");

    const noCandidate = buildRoomStateFixture({
      phase: "voting", selfParticipantId: "participant-owner", activeProposalId: null,
    });
    expect(available(noCandidate)).not.toContain("review_final_decision");
    expect(available({ ...noCandidate, activeProposalId: "proposal-1" })).toContain("review_final_decision");
  });

  it("withholds set_decision_policy and set_participant_decision_role once a candidate is frozen", () => {
    const frozen = buildRoomStateFixture({
      phase: "approval",
      selfParticipantId: "participant-owner",
      activeProposalId: "proposal-1",
      finalDecisionPreview: {
        proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null, status: "candidate", createdAt: "2026-08-30T00:00:00.000Z" },
        rationale: "r",
        acceptedTradeoffs: [],
        unresolvedWarnings: [],
        alignments: [],
        decisionPolicy: "owner_decides",
        owners: [],
        deadlines: [],
        actionItems: [],
        dissent: [],
        expertAdvice: [],
        requiredApprovalParticipantIds: ["participant-owner"],
        decisionHash: "hash-1",
        approvals: [],
        missingApprovalParticipantIds: ["participant-owner"],
      },
    });
    const names = available(frozen);
    expect(names).not.toContain("set_decision_policy");
    expect(names).not.toContain("set_participant_decision_role");
    // The owner is still the required approver, so confirmation stays available.
    expect(names).toContain("approve_final_decision");
  });

  it("registers approve_final_decision only for the participant currently required to approve", () => {
    const preview = {
      proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null, status: "candidate" as const, createdAt: "2026-08-30T00:00:00.000Z" },
      rationale: "r",
      acceptedTradeoffs: [],
      unresolvedWarnings: [],
      alignments: [],
      decisionPolicy: "owner_decides" as const,
      owners: [],
      deadlines: [],
      actionItems: [],
      dissent: [],
      expertAdvice: [],
      requiredApprovalParticipantIds: ["participant-owner"],
      decisionHash: "hash-1",
      approvals: [],
      missingApprovalParticipantIds: ["participant-owner"],
    };
    const requiredApprover = buildRoomStateFixture({
      phase: "approval",
      selfParticipantId: "participant-owner",
      activeProposalId: "proposal-1",
      finalDecisionPreview: preview,
    });
    const notRequired = buildRoomStateFixture({
      phase: "approval",
      selfParticipantId: "participant-engineer",
      activeProposalId: "proposal-1",
      finalDecisionPreview: preview,
    });
    expect(available(requiredApprover)).toContain("approve_final_decision");
    expect(available(notRequired)).not.toContain("approve_final_decision");
  });

  it("finalized rooms register only read-only tools", () => {
    const room = buildRoomStateFixture({ phase: "finalized", selfParticipantId: "participant-owner", finalizedAt: "2026-08-30T01:00:00.000Z" });
    const names = available(room);
    expect(names.filter((name) => MUTATION_TOOL_NAMES.has(name))).toEqual([]);
    expect(names).toContain("get_decision_record");
    expect(names).not.toContain("get_my_attention_items");
  });

  it("withholds get_my_attention_items from an unclaimed session", () => {
    const room = buildRoomStateFixture({ selfParticipantId: null });
    expect(available(room)).not.toContain("get_my_attention_items");
  });

  it("unregisters private mutation and attention tools for a removed participant", () => {
    const baseline = buildRoomStateFixture();
    const room = buildRoomStateFixture({
      phase: "deliberation",
      selfParticipantId: "participant-engineer",
      participants: baseline.participants.map((participant) =>
        participant.id === "participant-engineer"
          ? { ...participant, status: "removed" as const, removedAt: "2026-08-30T02:00:00.000Z" }
          : participant,
      ),
    });
    const names = available(room);
    expect(names.filter((name) => MUTATION_TOOL_NAMES.has(name))).toEqual([]);
    expect(names).not.toContain("get_my_attention_items");
  });

  it("uses unique, short tool names and strict object schemas", () => {
    const tools = Object.values(fullCatalog);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(40);
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
      if (!("oneOf" in tool.inputSchema)) {
        expect(tool.inputSchema).toMatchObject({ additionalProperties: false });
      }
    }
  });

  const EXPERT_GATED_TOOL_NAMES = ["request_security_review", "get_expert_advice", "record_expert_advice_outcome"];
  const expertParticipant = {
    id: "participant-security", name: "Security Expert", role: "Security Expert · Advisory",
    kind: "expert" as const, meetingRole: "participant" as const, decisionRole: "advisor" as const,
    isClaimed: true, isReady: false, status: "active" as const, removedAt: null,
    createdAt: "2026-08-30T00:00:00.000Z",
  };

  it("marks every tool name in the catalog as covered by exactly one availability rule", () => {
    for (const name of Object.keys(fullCatalog)) {
      const anyAvailable = LIFECYCLE.some((phase) =>
        available(buildRoomStateFixture({
          phase,
          selfParticipantId: "participant-owner",
          isLocked: name === "unlock_meeting",
          activeProposalId: [
            "advance_discussion", "request_team_alignment", "review_final_decision", "request_security_review",
          ].includes(name)
            ? "proposal-1"
            : null,
          ...(EXPERT_GATED_TOOL_NAMES.includes(name)
            ? {
                participants: [...buildRoomStateFixture().participants, expertParticipant],
                expertFindings: name === "record_expert_advice_outcome"
                  ? [{
                      id: "finding-1", roomId: "room-under-test", expertParticipantId: "participant-security",
                      expertKey: "security" as const, proposalId: "proposal-1", category: "behavioral_tracking",
                      title: "t", summary: "s", recommendation: "r", status: "open" as const,
                      resolutionRationale: null, createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
                    }]
                  : [],
              }
            : {}),
          ...(phase === "approval"
            ? {
                activeProposalId: "proposal-1",
                finalDecisionPreview: {
                  proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null, status: "candidate" as const, createdAt: "2026-08-30T00:00:00.000Z" },
                  rationale: "r", acceptedTradeoffs: [], unresolvedWarnings: [], alignments: [],
                  decisionPolicy: "owner_decides" as const, owners: [], deadlines: [], actionItems: [], dissent: [],
                  expertAdvice: [],
                  requiredApprovalParticipantIds: ["participant-owner"], decisionHash: "hash-1", approvals: [],
                  missingApprovalParticipantIds: ["participant-owner"],
                },
              }
            : {}),
        })).includes(name),
      );
      expect(anyAvailable, `${name} is never available to any owner in any phase`).toBe(true);
    }
  });

  it("marks read tools read-only and every participant-content output untrusted", () => {
    for (const name of [
      "get_meeting_context",
      "get_coordination_status",
      "get_room_updates",
      "get_current_decision",
      "get_open_issues",
      "get_alignment",
      "get_decision_record",
      "get_my_attention_items",
      "get_waiting_participants",
      "get_expert_advice",
    ]) {
      expect(fullCatalog[name]?.annotations?.readOnlyHint).toBe(true);
      expect(fullCatalog[name]?.annotations?.untrustedContentHint).toBe(true);
    }
    for (const name of MUTATION_TOOL_NAMES) {
      if (name === "create_meeting" || name === "join_meeting") continue; // onboarding tools, not in this catalog
      expect(fullCatalog[name]?.annotations?.readOnlyHint, name).toBe(false);
    }
  });
});
