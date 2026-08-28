import { describe, expect, it } from "vitest";
import type { RoomPhase } from "@/contracts/room";
import type { RoomWebMcpContext } from "@/webmcp/tool-context";
import {
  createRoomWebMcpTools,
  ROOM_TOOL_NAMES_BY_PHASE,
} from "@/webmcp/tool-definitions";

const context = {} as RoomWebMcpContext;

function allPropertyNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allPropertyNames);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allPropertyNames(child)]);
}

describe("phase-aware WebMCP registration", () => {
  it("exposes exactly the milestone tools in each phase", () => {
    expect(ROOM_TOOL_NAMES_BY_PHASE).toEqual({
      input: ["add_my_position", "get_meeting_context"],
      proposals: ["get_meeting_context", "list_positions", "submit_proposal"],
      deliberation: [
        "get_meeting_context",
        "get_open_issues",
        "list_positions",
        "propose_tradeoff",
        "raise_objection",
      ],
      voting: ["cast_my_vote", "get_meeting_context", "get_open_issues"],
      approval: [
        "approve_final_decision",
        "get_meeting_context",
        "preview_final_decision",
      ],
      finalized: ["get_decision_record"],
    } satisfies Record<RoomPhase, readonly string[]>);
  });

  it("uses unique, short tool names and strict object schemas", () => {
    const tools = Object.values(createRoomWebMcpTools(context));
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
    }
  });

  it("never accepts trusted participant identity or action provenance", () => {
    const forbidden = new Set([
      "participantId",
      "actorId",
      "actorType",
      "authUserId",
      "origin",
      "role",
      "userId",
    ]);
    for (const tool of Object.values(createRoomWebMcpTools(context))) {
      const schemaNames = allPropertyNames(tool.inputSchema);
      expect(schemaNames.filter((name) => forbidden.has(name))).toEqual([]);
    }
  });

  it("rejects an authority-injection argument before reaching the domain", async () => {
    const guardedContext = {
      getObservedRoomVersion: () => 12,
    } as RoomWebMcpContext;
    const tool = createRoomWebMcpTools(guardedContext).raise_objection!;
    const result = JSON.parse(String(await tool.execute({
      proposalId: "proposal-1",
      constraintId: "constraint-1",
      reason: "Concern",
      severity: "blocking",
      actorId: "another-participant",
    }, { signal: new AbortController().signal })));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "The tool arguments are invalid.",
        recovery: "Correct the arguments to match the registered input schema and retry.",
      },
      roomVersion: 12,
    });
  });

  it("marks query tools read-only and user-content outputs untrusted", () => {
    const tools = createRoomWebMcpTools(context);
    for (const name of [
      "get_meeting_context",
      "list_positions",
      "get_open_issues",
      "preview_final_decision",
      "get_decision_record",
    ]) {
      expect(tools[name]?.annotations).toEqual({
        readOnlyHint: true,
        untrustedContentHint: true,
      });
    }
    for (const name of [
      "add_my_position",
      "submit_proposal",
      "raise_objection",
      "propose_tradeoff",
      "cast_my_vote",
      "approve_final_decision",
    ]) {
      expect(tools[name]?.annotations).toEqual({
        readOnlyHint: false,
        untrustedContentHint: true,
      });
    }
  });

  it("keeps voting and approval participant-scoped", async () => {
    const guardedContext = {
      getObservedRoomVersion: () => 20,
    } as RoomWebMcpContext;
    const tools = createRoomWebMcpTools(guardedContext);
    const vote = JSON.parse(String(await tools.cast_my_vote!.execute({
      proposalId: "proposal-1",
      choice: "support",
      comment: null,
      participantId: "demo-designer",
    }, { signal: new AbortController().signal })));
    const approval = JSON.parse(String(await tools.approve_final_decision!.execute({
      decisionHash: "hash",
      actorId: "demo-designer",
    }, { signal: new AbortController().signal })));

    expect(vote.error.code).toBe("VALIDATION_ERROR");
    expect(approval.error.code).toBe("VALIDATION_ERROR");
  });
});
