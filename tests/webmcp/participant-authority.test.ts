import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRoomWebMcpTools,
  PARTICIPANT_MUTATION_TOOL_NAMES,
} from "@/webmcp/tool-definitions";
import {
  executeTool,
  fakeRoomWebMcpContext,
  VALID_MUTATION_TOOL_INPUTS,
} from "./fake-context";

vi.mock("@/domain/rooms/operations", () => ({
  addParticipantPosition: vi.fn(),
  approveParticipantFinalDecision: vi.fn(),
  expressMyAlignment: vi.fn(),
  getFinalDecisionRecord: vi.fn(),
  getMeetingContext: vi.fn(),
  previewFinalDecision: vi.fn(),
  proposeParticipantTradeoff: vi.fn(),
  raiseParticipantObjection: vi.fn(),
  submitParticipantProposal: vi.fn(),
}));

const operations = await import("@/domain/rooms/operations");

const DOMAIN_OPERATION_BY_TOOL = {
  add_my_position: operations.addParticipantPosition,
  submit_proposal: operations.submitParticipantProposal,
  raise_objection: operations.raiseParticipantObjection,
  propose_tradeoff: operations.proposeParticipantTradeoff,
  express_my_alignment: operations.expressMyAlignment,
  approve_final_decision: operations.approveParticipantFinalDecision,
} as const;

function allPropertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allPropertyNames);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allPropertyNames(child)]);
}

/** Every domain operation resolves an `ActionResult`, so the tools do too. */
const DOMAIN_SUCCESS = { ok: true, data: null, roomVersion: 13, message: "Saved." };

beforeEach(() => {
  vi.clearAllMocks();
  for (const operation of Object.values(DOMAIN_OPERATION_BY_TOOL)) {
    vi.mocked(operation).mockResolvedValue(DOMAIN_SUCCESS as never);
  }
});

describe("WebMCP participant authority", () => {
  it("never accepts trusted participant identity or action provenance", () => {
    const forbidden = new Set([
      "participantId",
      "actorId",
      "actorType",
      "authUserId",
      "origin",
      "role",
      "userId",
      "humanConfirmed",
      "organizerUserId",
      "onBehalfOf",
    ]);
    for (const tool of Object.values(createRoomWebMcpTools(fakeRoomWebMcpContext()))) {
      const schemaNames = allPropertyNames(tool.inputSchema);
      expect(schemaNames.filter((name) => forbidden.has(name))).toEqual([]);
    }
  });

  it("rejects an authority-injection argument before reaching the domain", async () => {
    const tool = createRoomWebMcpTools(fakeRoomWebMcpContext({ roomVersion: 12 })).raise_objection!;

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

  it("keeps alignment and approval participant-scoped", async () => {
    const tools = createRoomWebMcpTools(fakeRoomWebMcpContext({ roomVersion: 20 }));

    const alignment = await executeTool(tools.express_my_alignment!, {
      proposalId: "proposal-1",
      choice: "support",
      comment: null,
      participantId: "demo-designer",
    }) as { error: { code: string } };
    const approval = await executeTool(tools.approve_final_decision!, {
      decisionHash: "hash",
      actorId: "demo-designer",
    }) as { error: { code: string } };

    expect(alignment.error.code).toBe("VALIDATION_ERROR");
    expect(approval.error.code).toBe("VALIDATION_ERROR");
    expect(operations.expressMyAlignment).not.toHaveBeenCalled();
    expect(operations.approveParticipantFinalDecision).not.toHaveBeenCalled();
  });

  it("refuses every participant mutation before this session claims a seat", async () => {
    const tools = createRoomWebMcpTools(
      fakeRoomWebMcpContext({ roomVersion: 7, selfParticipantId: null }),
    );

    for (const name of PARTICIPANT_MUTATION_TOOL_NAMES) {
      expect(await executeTool(tools[name]!, VALID_MUTATION_TOOL_INPUTS[name])).toEqual({
        ok: false,
        error: {
          code: "NOT_AUTHORIZED",
          message: "This browser session has not claimed a participant seat in this room.",
          recovery:
            "Claim a seat in the visible application UI. No tool argument can supply a participant.",
        },
        roomVersion: 7,
      });
    }

    for (const operation of Object.values(DOMAIN_OPERATION_BY_TOOL)) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("checks the claim before the arguments, so an unclaimed session learns nothing", async () => {
    const tool = createRoomWebMcpTools(
      fakeRoomWebMcpContext({ roomVersion: 7, selfParticipantId: null }),
    ).express_my_alignment!;

    const refusal = await executeTool(tool, { nonsense: true }) as { error: { code: string } };

    expect(refusal.error.code).toBe("NOT_AUTHORIZED");
  });

  it("leaves read-only tools usable before a claim", async () => {
    const context = fakeRoomWebMcpContext({ selfParticipantId: null });
    const preview = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "WRONG_PHASE", message: "The room is not in approval yet." },
      roomVersion: 7,
    });
    Object.assign(context, { previewFinalDecision: preview });

    expect(await executeTool(
      createRoomWebMcpTools(context).preview_final_decision!,
      {},
    )).toMatchObject({ error: { code: "WRONG_PHASE" } });
    expect(preview).toHaveBeenCalledOnce();
  });

  it("forwards only the tool's own arguments to the domain, once a seat is claimed", async () => {
    const mutationContext = {
      actor: { authUserId: "auth-user-1", origin: "webmcp" as const },
      expectedRoomVersion: 12,
    };
    const context = fakeRoomWebMcpContext();
    Object.assign(context, { mutationContext: () => Promise.resolve(mutationContext) });
    const tools = createRoomWebMcpTools(context);

    for (const [name, operation] of Object.entries(DOMAIN_OPERATION_BY_TOOL)) {
      await executeTool(tools[name]!, VALID_MUTATION_TOOL_INPUTS[name]);

      expect(operation).toHaveBeenCalledOnce();
      const [, roomId, , forwardedContext] = vi.mocked(operation).mock.calls[0]!;
      expect(roomId).toBe("room-under-test");
      // Authority reaches the domain as an authenticated user plus an origin,
      // never as a participant the agent chose.
      expect(forwardedContext).toEqual(mutationContext);
      expect(forwardedContext).not.toHaveProperty("humanConfirmed");
    }
  });

  it("never asks the domain to treat a WebMCP call as human-confirmed", async () => {
    const context = fakeRoomWebMcpContext();
    Object.assign(context, {
      mutationContext: () => Promise.resolve({
        actor: { authUserId: "auth-user-1", origin: "webmcp" as const },
        expectedRoomVersion: 12,
      }),
    });

    await executeTool(
      createRoomWebMcpTools(context).approve_final_decision!,
      VALID_MUTATION_TOOL_INPUTS.approve_final_decision,
    );

    const [, , input, forwardedContext] = vi
      .mocked(operations.approveParticipantFinalDecision)
      .mock.calls[0]!;
    expect(input).toEqual({ decisionHash: "decision-hash-1" });
    expect((forwardedContext as { humanConfirmed?: boolean }).humanConfirmed).toBeUndefined();
  });
});
