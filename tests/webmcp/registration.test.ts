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
        "get_meeting_context",
        "get_my_attention_items",
        "get_waiting_participants",
        "lock_meeting",
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
    const byPhase = LIFECYCLE.map((phase) => {
      const room = buildRoomStateFixture({ phase, selfParticipantId: "participant-engineer" });
      return available(room).filter((name) => !name.startsWith("get_"));
    });
    expect(byPhase).toEqual([
      ["share_my_context"],
      ["suggest_option"],
      ["raise_concern", "resolve_my_concern", "respond_to_concern"],
      ["express_my_alignment"],
      [], // approval: contributor is never a required approver under owner_decides
      [],
    ]);
  });

  it("withholds owner-only tools from a non-owner claimed participant", () => {
    for (const phase of LIFECYCLE) {
      const room = buildRoomStateFixture({ phase, selfParticipantId: "participant-engineer" });
      const names = available(room);
      for (const ownerTool of [
        "get_waiting_participants",
        "admit_participant",
        "reject_participant",
        "lock_meeting",
        "unlock_meeting",
        "advance_discussion",
        "request_team_alignment",
        "review_final_decision",
        "set_decision_policy",
        "set_participant_decision_role",
        "remove_participant",
        "transfer_ownership",
      ]) {
        expect(names, `${phase}: ${ownerTool}`).not.toContain(ownerTool);
      }
    }
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
    expect(names).toContain("request_final_decision_confirmation");
  });

  it("registers request_final_decision_confirmation only for the participant currently required to approve", () => {
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
    expect(available(requiredApprover)).toContain("request_final_decision_confirmation");
    expect(available(notRequired)).not.toContain("request_final_decision_confirmation");
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

  it("marks every tool name in the catalog as covered by exactly one availability rule", () => {
    for (const name of Object.keys(fullCatalog)) {
      const anyAvailable = LIFECYCLE.some((phase) =>
        available(buildRoomStateFixture({
          phase,
          selfParticipantId: "participant-owner",
          isLocked: name === "unlock_meeting",
          activeProposalId: ["advance_discussion", "request_team_alignment", "review_final_decision"].includes(name)
            ? "proposal-1"
            : null,
          ...(phase === "approval"
            ? {
                activeProposalId: "proposal-1",
                finalDecisionPreview: {
                  proposal: { id: "proposal-1", participantId: "participant-owner", title: "t", summary: "s", rationale: "r", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null, status: "candidate" as const, createdAt: "2026-08-30T00:00:00.000Z" },
                  rationale: "r", acceptedTradeoffs: [], unresolvedWarnings: [], alignments: [],
                  decisionPolicy: "owner_decides" as const, owners: [], deadlines: [], actionItems: [], dissent: [],
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
      "get_current_decision",
      "get_open_issues",
      "get_alignment",
      "get_decision_record",
      "get_my_attention_items",
      "get_waiting_participants",
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
