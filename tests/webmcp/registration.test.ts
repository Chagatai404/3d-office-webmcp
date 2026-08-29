import { describe, expect, it } from "vitest";
import { roomPhaseSchema, type RoomPhase } from "@/contracts/room";
import {
  createRoomWebMcpTools,
  getRoomWebMcpToolNames,
  getRoomWebMcpToolsForPhase,
  PARTICIPANT_MUTATION_TOOL_NAMES,
  ROOM_TOOL_NAMES_BY_PHASE,
} from "@/webmcp/tool-definitions";
import { fakeRoomWebMcpContext } from "./fake-context";

const context = fakeRoomWebMcpContext();

/** The lifecycle order a real room walks, used as the regression sequence. */
const LIFECYCLE: readonly RoomPhase[] = [
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
  "finalized",
];

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

  it("covers every canonical phase and no invented one", () => {
    expect(Object.keys(ROOM_TOOL_NAMES_BY_PHASE).sort()).toEqual(
      [...roomPhaseSchema.options].sort(),
    );
    expect(LIFECYCLE).toEqual(roomPhaseSchema.options);
  });

  it("registers the claimed participant's full phase catalogue across the lifecycle", () => {
    const claimed = LIFECYCLE.map((phase) =>
      getRoomWebMcpToolNames(phase, { hasClaimedSeat: true }),
    );

    expect(claimed).toEqual([
      ["add_my_position", "get_meeting_context"],
      ["get_meeting_context", "list_positions", "submit_proposal"],
      [
        "get_meeting_context",
        "get_open_issues",
        "list_positions",
        "propose_tradeoff",
        "raise_objection",
      ],
      ["cast_my_vote", "get_meeting_context", "get_open_issues"],
      ["approve_final_decision", "get_meeting_context", "preview_final_decision"],
      ["get_decision_record"],
    ]);
  });

  it("registers no participant mutation tool before a seat is claimed", () => {
    const unclaimed = LIFECYCLE.map((phase) =>
      getRoomWebMcpToolNames(phase, { hasClaimedSeat: false }),
    );

    expect(unclaimed).toEqual([
      ["get_meeting_context"],
      ["get_meeting_context", "list_positions"],
      ["get_meeting_context", "get_open_issues", "list_positions"],
      ["get_meeting_context", "get_open_issues"],
      ["get_meeting_context", "preview_final_decision"],
      ["get_decision_record"],
    ]);

    for (const names of unclaimed) {
      expect(names.filter((name) => PARTICIPANT_MUTATION_TOOL_NAMES.has(name))).toEqual([]);
    }
  });

  it("keeps read-only orientation available before a claim, in every phase", () => {
    for (const phase of LIFECYCLE) {
      const unclaimed = getRoomWebMcpToolNames(phase, { hasClaimedSeat: false });
      const claimed = getRoomWebMcpToolNames(phase, { hasClaimedSeat: true });

      expect(unclaimed.length).toBeGreaterThan(0);
      expect(unclaimed).toEqual(
        claimed.filter((name) => !PARTICIPANT_MUTATION_TOOL_NAMES.has(name)),
      );
      for (const name of unclaimed) {
        expect(createRoomWebMcpTools(context)[name]?.annotations?.readOnlyHint).toBe(true);
      }
    }
  });

  it("resolves registered definitions that match the names for a phase", () => {
    for (const phase of LIFECYCLE) {
      for (const hasClaimedSeat of [true, false]) {
        const definitions = getRoomWebMcpToolsForPhase(context, phase, { hasClaimedSeat });
        expect(definitions.map((tool) => tool.name)).toEqual(
          getRoomWebMcpToolNames(phase, { hasClaimedSeat }),
        );
        expect(definitions.every((tool) => typeof tool.execute === "function")).toBe(true);
      }
    }
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
    for (const name of PARTICIPANT_MUTATION_TOOL_NAMES) {
      expect(tools[name]?.annotations).toEqual({
        readOnlyHint: false,
        untrustedContentHint: true,
      });
    }
  });

  it("describes tools as asynchronous shared-state operations, not agent-to-agent chat", () => {
    const tools = Object.values(createRoomWebMcpTools(context));

    for (const tool of tools) {
      expect(tool.description).toMatch(/shared room state/);
      expect(tool.description.toLowerCase()).not.toMatch(
        /chat with|send a message|message (the|another)|talk to|reply to (the|another) agent/,
      );
    }

    for (const tool of tools.filter((candidate) =>
      PARTICIPANT_MUTATION_TOOL_NAMES.has(candidate.name),
    )) {
      expect(tool.description).toMatch(/asynchronous|Other participants|anyone else/);
    }
  });
});
