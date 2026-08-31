import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAttentionWebMcpTool } from "@/webmcp/attention";
import { createRoomWebMcpTools } from "@/webmcp/room-tools";
import {
  buildRoomStateFixture,
  executeTool,
  fakeRoomWebMcpContext,
  VALID_MUTATION_TOOL_INPUTS,
} from "./fake-context";

vi.mock("@/domain/rooms/operations", () => ({
  addParticipantPosition: vi.fn(),
  admitJoinRequest: vi.fn(),
  advanceRoomPhase: vi.fn(),
  approveParticipantFinalDecision: vi.fn(),
  configureParticipant: vi.fn(),
  expressMyAlignment: vi.fn(),
  getFinalDecisionRecord: vi.fn(),
  getMeetingContext: vi.fn(),
  listJoinRequests: vi.fn(),
  lockMeeting: vi.fn(),
  markMyInputReady: vi.fn(),
  previewFinalDecision: vi.fn(),
  proposeParticipantTradeoff: vi.fn(),
  raiseParticipantObjection: vi.fn(),
  rejectJoinRequest: vi.fn(),
  resolveParticipantObjection: vi.fn(),
  setDecisionPolicy: vi.fn(),
  setParticipantDecisionRole: vi.fn(),
  submitParticipantProposal: vi.fn(),
  unlockMeeting: vi.fn(),
}));

vi.mock("@/webmcp/confirmation-bridge", () => ({
  requestUiConfirmation: vi.fn(),
}));

const operations = await import("@/domain/rooms/operations");
const confirmationBridge = await import("@/webmcp/confirmation-bridge");

/** Tools gated by the `asClaimedParticipant` second gate -- see room-tools.ts. */
const PARTICIPANT_GATED_TOOL_NAMES = [
  "share_my_context",
  "mark_my_input_ready",
  "suggest_option",
  "raise_concern",
  "respond_to_concern",
  "resolve_my_concern",
  "express_my_alignment",
  "approve_final_decision",
  "request_source_upload",
];

const DOMAIN_OPERATION_BY_TOOL = {
  share_my_context: operations.addParticipantPosition,
  mark_my_input_ready: operations.markMyInputReady,
  suggest_option: operations.submitParticipantProposal,
  raise_concern: operations.raiseParticipantObjection,
  respond_to_concern: operations.proposeParticipantTradeoff,
  resolve_my_concern: operations.resolveParticipantObjection,
  express_my_alignment: operations.expressMyAlignment,
  approve_final_decision: operations.approveParticipantFinalDecision,
} as const;

function allPropertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allPropertyNames);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allPropertyNames(child)]);
}

const DOMAIN_SUCCESS = { ok: true, data: null, roomVersion: 13, message: "Saved." };

beforeEach(() => {
  vi.clearAllMocks();
  for (const operation of Object.values(operations)) {
    if (typeof operation === "function" && "mockResolvedValue" in operation) {
      vi.mocked(operation).mockResolvedValue(DOMAIN_SUCCESS as never);
    }
  }
});

function catalog(context = fakeRoomWebMcpContext()) {
  return { ...createRoomWebMcpTools(context), ...createAttentionWebMcpTool(context) };
}

describe("WebMCP participant/owner authority", () => {
  it("never accepts trusted identity, authority, or origin fields in any tool's schema", () => {
    const forbidden = new Set([
      "actorId",
      "actorType",
      "authUserId",
      "origin",
      "userId",
      "humanConfirmed",
      "organizerUserId",
      "onBehalfOf",
      "ownerParticipantId",
      "selfParticipantId",
      "meetingRole",
    ]);
    for (const tool of Object.values(catalog())) {
      const schemaNames = allPropertyNames(tool.inputSchema);
      expect(schemaNames.filter((name) => forbidden.has(name)), tool.name).toEqual([]);
    }

    // Target participant IDs are legitimate object references for owner
    // management tools; they are never interpreted as the caller's identity.
    for (const [name, tool] of Object.entries(catalog())) {
      const participantIds = allPropertyNames(tool.inputSchema).filter((field) => field === "participantId");
      expect(participantIds, name).toEqual(
        ["set_participant_decision_role", "configure_participant", "remove_participant", "transfer_ownership"].includes(name)
          ? ["participantId"]
          : [],
      );
    }
  });

  it("rejects an authority-injection argument before reaching the domain", async () => {
    const tool = catalog(fakeRoomWebMcpContext({ roomVersion: 12 })).raise_concern!;

    expect(await executeTool(tool, {
      proposalId: "proposal-1",
      constraintId: "constraint-1",
      reason: "Concern",
      severity: "blocking",
      actorId: "another-participant",
    })).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool arguments are invalid.",
        recovery: "Correct the arguments to match the registered input schema and retry.",
      },
      roomVersion: 12,
    });
    expect(operations.raiseParticipantObjection).not.toHaveBeenCalled();
  });

  it("keeps alignment and final-decision confirmation participant-scoped", async () => {
    const tools = catalog(fakeRoomWebMcpContext({ roomVersion: 20 }));

    const alignment = await executeTool(tools.express_my_alignment!, {
      proposalId: "proposal-1", choice: "support", comment: null, participantId: "demo-designer",
    }) as { error: { code: string } };
    const confirmation = await executeTool(tools.approve_final_decision!, {
      decisionHash: "hash", actorId: "demo-designer",
    }) as { error: { code: string } };

    expect(alignment.error.code).toBe("VALIDATION_ERROR");
    expect(confirmation.error.code).toBe("VALIDATION_ERROR");
    expect(operations.expressMyAlignment).not.toHaveBeenCalled();
    expect(operations.approveParticipantFinalDecision).not.toHaveBeenCalled();
  });

  it("refuses every participant-gated mutation before this session claims a seat", async () => {
    const tools = catalog(fakeRoomWebMcpContext({ roomVersion: 7, selfParticipantId: null }));

    for (const name of PARTICIPANT_GATED_TOOL_NAMES) {
      expect(await executeTool(tools[name]!, VALID_MUTATION_TOOL_INPUTS[name])).toEqual({
        ok: false,
        error: {
          code: "NOT_AUTHORIZED",
          message: "This browser session has not claimed a participant seat in this room.",
          recovery: "Claim a seat in the visible application UI. No tool argument can supply a participant.",
        },
        roomVersion: 7,
      });
    }

    for (const [name, operation] of Object.entries(DOMAIN_OPERATION_BY_TOOL)) {
      expect(operation, name).not.toHaveBeenCalled();
    }
  });

  it("checks the claim before the arguments, so an unclaimed session learns nothing", async () => {
    const tool = catalog(fakeRoomWebMcpContext({ roomVersion: 7, selfParticipantId: null })).express_my_alignment!;
    const refusal = await executeTool(tool, { nonsense: true }) as { error: { code: string } };
    expect(refusal.error.code).toBe("NOT_AUTHORIZED");
  });

  it("leaves read-only tools usable before a claim", async () => {
    const room = buildRoomStateFixture({ selfParticipantId: null });
    const tools = catalog(fakeRoomWebMcpContext({ selfParticipantId: null, room }));
    expect(await executeTool(tools.get_meeting_context!, {})).toMatchObject({ ok: true });
  });

  it("forwards only the tool's own arguments to the domain, once a seat is claimed", async () => {
    const mutationContext = { actor: { authUserId: "auth-user-1", origin: "webmcp" as const }, expectedRoomVersion: 12 };
    const context = fakeRoomWebMcpContext();
    Object.assign(context, { mutationContext: () => Promise.resolve(mutationContext) });
    const tools = catalog(context);

    for (const [name, operation] of Object.entries(DOMAIN_OPERATION_BY_TOOL)) {
      await executeTool(tools[name]!, VALID_MUTATION_TOOL_INPUTS[name]);
      expect(operation, name).toHaveBeenCalledOnce();
      // The mutation context is always the last argument -- most operations
      // also take an `input` argument between `roomId` and it, but
      // `mark_my_input_ready` takes no domain input at all.
      const call = vi.mocked(operation).mock.calls[0]!;
      const [, roomId] = call;
      const forwardedContext = call[call.length - 1];
      expect(roomId, name).toBe("room-under-test");
      expect(forwardedContext, name).toEqual(mutationContext);
      expect(forwardedContext, name).not.toHaveProperty("humanConfirmed");
    }
  });

  it("never asks the domain to treat a WebMCP call as human-confirmed", async () => {
    const context = fakeRoomWebMcpContext();
    Object.assign(context, {
      mutationContext: () => Promise.resolve({ actor: { authUserId: "auth-user-1", origin: "webmcp" as const }, expectedRoomVersion: 12 }),
    });

    await executeTool(catalog(context).approve_final_decision!, VALID_MUTATION_TOOL_INPUTS.approve_final_decision);

    const [, , input, forwardedContext] = vi.mocked(operations.approveParticipantFinalDecision).mock.calls[0]!;
    expect(input).toEqual({ decisionHash: "decision-hash-1" });
    expect((forwardedContext as { humanConfirmed?: boolean }).humanConfirmed).toBeUndefined();
  });

  it("opens the Decision workspace when requesting final decision confirmation", async () => {
    vi.mocked(operations.approveParticipantFinalDecision).mockResolvedValueOnce({
      ok: false,
      error: { code: "HUMAN_CONFIRMATION_REQUIRED", message: "Confirm visibly." },
      roomVersion: 12,
    } as never);
    await executeTool(catalog().approve_final_decision!, VALID_MUTATION_TOOL_INPUTS.approve_final_decision);
    expect(confirmationBridge.requestUiConfirmation).toHaveBeenCalledWith({ kind: "decision" });
  });

  it("opens the source workspace without uploading a file itself", async () => {
    const result = await executeTool(catalog().request_source_upload!, {}) as { error: { code: string } };
    expect(result.error.code).toBe("HUMAN_CONFIRMATION_REQUIRED");
    expect(confirmationBridge.requestUiConfirmation).toHaveBeenCalledWith({ kind: "sources", action: "upload" });
  });

  it("does not open confirmation UI when the decision hash is stale or unauthorized", async () => {
    vi.mocked(operations.approveParticipantFinalDecision).mockResolvedValueOnce({
      ok: false,
      error: { code: "DECISION_CHANGED", message: "The hash changed." },
      roomVersion: 13,
    } as never);
    await executeTool(catalog().approve_final_decision!, VALID_MUTATION_TOOL_INPUTS.approve_final_decision);
    expect(confirmationBridge.requestUiConfirmation).not.toHaveBeenCalled();
  });

  describe("resolve_my_concern is raiser-only at the WebMCP layer", () => {
    it("refuses a concern raised by a different participant, without calling the domain", async () => {
      const room = buildRoomStateFixture({
        phase: "deliberation",
        selfParticipantId: "participant-engineer",
        conflicts: [{
          id: "conflict-1", proposalId: "proposal-1", constraintId: null,
          raisedByActorType: "participant", raisedByActorId: "participant-owner",
          severity: "blocking", reason: "Needs review", status: "open",
          resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
          createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
        }],
      });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-engineer" });
      const result = await executeTool(catalog(context).resolve_my_concern!, VALID_MUTATION_TOOL_INPUTS.resolve_my_concern) as { error: { code: string } };
      expect(result.error.code).toBe("NOT_AUTHORIZED");
      expect(operations.resolveParticipantObjection).not.toHaveBeenCalled();
    });

    it("allows resolving a concern the session itself raised", async () => {
      const room = buildRoomStateFixture({
        phase: "deliberation",
        selfParticipantId: "participant-engineer",
        conflicts: [{
          id: "conflict-1", proposalId: "proposal-1", constraintId: null,
          raisedByActorType: "participant", raisedByActorId: "participant-engineer",
          severity: "blocking", reason: "Needs review", status: "open",
          resolvedByActorType: null, resolvedByActorId: null, resolutionNote: null,
          createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: null,
        }],
      });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-engineer" });
      await executeTool(catalog(context).resolve_my_concern!, VALID_MUTATION_TOOL_INPUTS.resolve_my_concern);
      expect(operations.resolveParticipantObjection).toHaveBeenCalledOnce();
    });
  });

  describe("transfer_ownership and remove_participant never call the mutation directly", () => {
    it("transfer_ownership validates the target, arms the bridge, and returns HUMAN_CONFIRMATION_REQUIRED", async () => {
      const room = buildRoomStateFixture({ selfParticipantId: "participant-owner" });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-owner" });
      const result = await executeTool(catalog(context).transfer_ownership!, { participantId: "participant-engineer" }) as { error: { code: string } };
      expect(result.error.code).toBe("HUMAN_CONFIRMATION_REQUIRED");
      expect(confirmationBridge.requestUiConfirmation).toHaveBeenCalledWith({ kind: "participants", action: "transfer", participantId: "participant-engineer" });
    });

    it("remove_participant validates the target, arms the bridge, and returns HUMAN_CONFIRMATION_REQUIRED", async () => {
      const room = buildRoomStateFixture({ selfParticipantId: "participant-owner" });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-owner" });
      const result = await executeTool(catalog(context).remove_participant!, { participantId: "participant-engineer" }) as { error: { code: string } };
      expect(result.error.code).toBe("HUMAN_CONFIRMATION_REQUIRED");
      expect(confirmationBridge.requestUiConfirmation).toHaveBeenCalledWith({ kind: "participants", action: "remove", participantId: "participant-engineer" });
    });

    it("refuses removing the current owner through remove_participant", async () => {
      const room = buildRoomStateFixture({ selfParticipantId: "participant-owner" });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-owner" });
      const result = await executeTool(catalog(context).remove_participant!, { participantId: "participant-owner" }) as { error: { code: string } };
      expect(result.error.code).toBe("NOT_AUTHORIZED");
      expect(confirmationBridge.requestUiConfirmation).not.toHaveBeenCalled();
    });

    it("refuses a non-owner calling transfer_ownership or remove_participant", async () => {
      const room = buildRoomStateFixture({ selfParticipantId: "participant-engineer" });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-engineer" });
      const transfer = await executeTool(catalog(context).transfer_ownership!, { participantId: "participant-owner" }) as { error: { code: string } };
      const removal = await executeTool(catalog(context).remove_participant!, { participantId: "participant-owner" }) as { error: { code: string } };
      expect(transfer.error.code).toBe("NOT_AUTHORIZED");
      expect(removal.error.code).toBe("NOT_AUTHORIZED");
      expect(confirmationBridge.requestUiConfirmation).not.toHaveBeenCalled();
    });
  });

  describe("owner phase-progression tools accept no phase argument", () => {
    it("advance_discussion derives the next phase from current state, never from an argument", async () => {
      const inputRoom = buildRoomStateFixture({ phase: "input", selfParticipantId: "participant-owner" });
      const context = fakeRoomWebMcpContext({ room: inputRoom, selfParticipantId: "participant-owner" });
      await executeTool(catalog(context).advance_discussion!, { phase: "approval" });
      expect(operations.advanceRoomPhase).toHaveBeenCalledWith(expect.anything(), "room-under-test", "proposals", expect.anything());
    });

    it("advance_discussion refuses outside Input/Proposals without calling the domain", async () => {
      const room = buildRoomStateFixture({ phase: "deliberation", selfParticipantId: "participant-owner" });
      const context = fakeRoomWebMcpContext({ room, selfParticipantId: "participant-owner" });
      const result = await executeTool(catalog(context).advance_discussion!, {}) as { error: { code: string } };
      expect(result.error.code).toBe("WRONG_PHASE");
      expect(operations.advanceRoomPhase).not.toHaveBeenCalled();
    });

    it("request_team_alignment always requests the Alignment phase", async () => {
      await executeTool(catalog().request_team_alignment!, {});
      expect(operations.advanceRoomPhase).toHaveBeenCalledWith(expect.anything(), "room-under-test", "voting", expect.anything());
    });

    it("review_final_decision always requests the Decision phase", async () => {
      await executeTool(catalog().review_final_decision!, {});
      expect(operations.advanceRoomPhase).toHaveBeenCalledWith(expect.anything(), "room-under-test", "approval", expect.anything());
    });
  });

  it("wires owner join-request and lock tools to the correct domain operations", async () => {
    await executeTool(catalog().admit_participant!, VALID_MUTATION_TOOL_INPUTS.admit_participant);
    await executeTool(catalog().reject_participant!, VALID_MUTATION_TOOL_INPUTS.reject_participant);
    await executeTool(catalog().lock_meeting!, {});
    await executeTool(catalog().unlock_meeting!, {});
    expect(operations.admitJoinRequest).toHaveBeenCalledOnce();
    expect(operations.rejectJoinRequest).toHaveBeenCalledOnce();
    expect(operations.lockMeeting).toHaveBeenCalledOnce();
    expect(operations.unlockMeeting).toHaveBeenCalledOnce();
  });

  it("wires decision-policy and decision-role tools to the correct domain operations", async () => {
    await executeTool(catalog().set_decision_policy!, VALID_MUTATION_TOOL_INPUTS.set_decision_policy);
    await executeTool(catalog().set_participant_decision_role!, VALID_MUTATION_TOOL_INPUTS.set_participant_decision_role);
    expect(operations.setDecisionPolicy).toHaveBeenCalledOnce();
    expect(operations.setParticipantDecisionRole).toHaveBeenCalledOnce();
  });

  describe("A6: explicit role and decision-authority assignment", () => {
    it("forwards admit_participant's role/decisionRole through to the domain unchanged", async () => {
      await executeTool(catalog().admit_participant!, {
        joinRequestId: "join-request-1", role: "CTO", decisionRole: "decision_maker",
      });
      expect(operations.admitJoinRequest).toHaveBeenCalledOnce();
      const [, , input] = vi.mocked(operations.admitJoinRequest).mock.calls[0]!;
      expect(input).toEqual({ joinRequestId: "join-request-1", role: "CTO", decisionRole: "decision_maker" });
    });

    it("admits with the joiner's own role and contributor when role/decisionRole are null", async () => {
      await executeTool(catalog().admit_participant!, {
        joinRequestId: "join-request-1", role: null, decisionRole: null,
      });
      const [, , input] = vi.mocked(operations.admitJoinRequest).mock.calls[0]!;
      expect(input).toEqual({ joinRequestId: "join-request-1", role: null, decisionRole: null });
    });

    it("wires configure_participant to the domain operation with only the target as an id field", async () => {
      await executeTool(catalog().configure_participant!, {
        participantId: "participant-engineer", role: "CTO", decisionRole: "decision_maker",
      });
      expect(operations.configureParticipant).toHaveBeenCalledOnce();
      const [, , input] = vi.mocked(operations.configureParticipant).mock.calls[0]!;
      expect(input).toEqual({ participantId: "participant-engineer", role: "CTO", decisionRole: "decision_maker" });
    });

    it("rejects configure_participant with both role and decisionRole null before reaching the domain", async () => {
      const result = await executeTool(catalog().configure_participant!, {
        participantId: "participant-engineer", role: null, decisionRole: null,
      }) as { ok: boolean; error: { code: string } };
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(operations.configureParticipant).not.toHaveBeenCalled();
    });
  });

  it("forwards a domain refusal unchanged, proving no WebMCP-layer bypass (stale-reference proof)", async () => {
    const refusal = { ok: false, error: { code: "ALREADY_FINALIZED", message: "The finalized decision is immutable." }, roomVersion: 99 };
    vi.mocked(operations.expressMyAlignment).mockResolvedValueOnce(refusal as never);
    const result = await executeTool(catalog().express_my_alignment!, VALID_MUTATION_TOOL_INPUTS.express_my_alignment);
    expect(result).toEqual(refusal);
  });

  it("gives an explicit re-read instruction for stale room state", async () => {
    vi.mocked(operations.expressMyAlignment).mockResolvedValueOnce({
      ok: false,
      error: { code: "STALE_ROOM_STATE", message: "The room changed." },
      roomVersion: 99,
    } as never);
    const result = await executeTool(catalog().express_my_alignment!, VALID_MUTATION_TOOL_INPUTS.express_my_alignment) as {
      error: { recovery: string };
    };
    expect(result.error.recovery).toContain("get_meeting_context");
  });
});
