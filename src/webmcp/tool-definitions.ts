import { z } from "zod";
import {
  addPositionInputSchema,
  type RoomPhase,
} from "@/contracts/room";
import {
  addParticipantPosition,
  proposeParticipantTradeoff,
  raiseParticipantObjection,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { RoomWebMcpContext } from "./tool-context";
import { executeToolSafely, readToolSuccess } from "./tool-result";

export const ROOM_TOOL_NAMES_BY_PHASE = {
  input: ["add_my_position", "get_meeting_context"],
  proposals: ["get_meeting_context", "list_positions", "submit_proposal"],
  deliberation: [
    "get_meeting_context",
    "get_open_issues",
    "list_positions",
    "propose_tradeoff",
    "raise_objection",
  ],
  voting: ["get_meeting_context"],
  approval: ["get_meeting_context"],
  finalized: ["get_meeting_context"],
} as const satisfies Record<RoomPhase, readonly string[]>;

const noInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const nullableString = { type: ["string", "null"] } as const;
const stringArray = { type: "array", items: { type: "string", minLength: 1 } } as const;

const submitProposalToolInputSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  expectedOutcomes: z.array(z.string().min(1)),
  referencedConstraintIds: z.array(z.string().min(1)),
}).strict();

const proposeTradeoffToolInputSchema = z.object({
  conflictIds: z.array(z.string().min(1)).min(1),
  description: z.string().min(1),
  expectedEffect: z.string().min(1),
  revisedProposal: submitProposalToolInputSchema,
}).strict();

const raiseObjectionToolInputSchema = z.object({
  proposalId: z.string().min(1),
  constraintId: z.string().min(1),
  reason: z.string().min(1),
  severity: z.enum(["blocking", "warning"]),
}).strict();

export function createRoomWebMcpTools(context: RoomWebMcpContext) {
  const safely = (execute: () => unknown | Promise<unknown>) =>
    executeToolSafely(execute, () => context.getObservedRoomVersion());

  const tools: Record<string, WebMcpToolDefinition> = {
    get_meeting_context: {
      name: "get_meeting_context",
      description:
        "Read the canonical meeting state, including phase, version, participants, proposals, conflicts, trade-offs, and provenance.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => safely(async () => {
        const room = await context.getRoom();
        const self = room.participants.find(
          (participant) => participant.id === room.selfParticipantId,
        );
        const activeProposal = room.proposals.find(
          (proposal) => proposal.id === room.activeProposalId,
        );
        return readToolSuccess({
          roomId: room.id,
          title: room.title,
          brief: room.brief,
          phase: room.phase,
          roomVersion: room.version,
          currentParticipant: self
            ? { participantId: self.id, name: self.name, role: self.role }
            : null,
          participantRoles: room.participants.map((participant) => ({
            participantId: participant.id,
            name: participant.name,
            role: participant.role,
          })),
          positions: room.positions.map((position) => ({
            participantId: position.participantId,
            summary: position.summary,
            category: position.category,
            priority: position.priority,
          })),
          constraints: room.constraints.map((constraint) => ({
            id: constraint.id,
            participantId: constraint.participantId,
            category: constraint.category,
            text: constraint.text,
            priority: constraint.priority,
          })),
          activeProposal: activeProposal
            ? {
                id: activeProposal.id,
                title: activeProposal.title,
                summary: activeProposal.summary,
                rationale: activeProposal.rationale,
              }
            : null,
          stateSummary: {
            positionCount: room.positions.length,
            constraintCount: room.constraints.length,
            openIssueCount: room.conflicts.filter((conflict) => conflict.status === "open").length,
            tradeoffCount: room.tradeoffs.length,
          },
        }, room.version, "Meeting context loaded.");
      }),
    },
    add_my_position: {
      name: "add_my_position",
      description:
        "Add the authenticated participant's own position and constraints during input. This is not a proposal or objection.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", minLength: 1 },
          category: nullableString,
          priority: nullableString,
          constraints: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string", minLength: 1 },
                text: { type: "string", minLength: 1 },
                priority: nullableString,
              },
              required: ["category", "text", "priority"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "category", "priority", "constraints"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (rawInput) => safely(async () => {
        const input = addPositionInputSchema.parse(rawInput);
        return addParticipantPosition(
          context.repository,
          context.roomId,
          input,
          await context.mutationContext(),
        );
      }),
    },
    list_positions: {
      name: "list_positions",
      description:
        "List participant positions and their stable constraints. Positions express needs; they are not candidate proposals.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => safely(async () => {
        const room = await context.getRoom();
        const groups = room.participants.map((participant) => ({
          participant: {
            id: participant.id,
            name: participant.name,
            role: participant.role,
          },
          positions: room.positions
            .filter((position) => position.participantId === participant.id)
            .map((position) => ({
              id: position.id,
              summary: position.summary,
              category: position.category,
              priority: position.priority,
            })),
          constraints: room.constraints
            .filter((constraint) => constraint.participantId === participant.id)
            .map((constraint) => ({
              id: constraint.id,
              category: constraint.category,
              text: constraint.text,
              priority: constraint.priority,
            })),
        }));
        return readToolSuccess({ participantPositions: groups }, room.version, "Positions loaded.");
      }),
    },
    submit_proposal: {
      name: "submit_proposal",
      description:
        "Submit a new candidate proposal during the proposals phase, referencing stable constraint IDs where relevant.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 },
          expectedOutcomes: stringArray,
          referencedConstraintIds: stringArray,
        },
        required: ["title", "summary", "rationale", "expectedOutcomes", "referencedConstraintIds"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (rawInput) => safely(async () => {
        const input = submitProposalToolInputSchema.parse(rawInput);
        return submitParticipantProposal(
          context.repository,
          context.roomId,
          { ...input, parentProposalId: null },
          await context.mutationContext(),
        );
      }),
    },
    raise_objection: {
      name: "raise_objection",
      description:
        "Raise an open warning or blocking objection against a proposal during deliberation. This does not resolve the issue.",
      inputSchema: {
        type: "object",
        properties: {
          proposalId: { type: "string", minLength: 1 },
          constraintId: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["blocking", "warning"] },
        },
        required: ["proposalId", "constraintId", "reason", "severity"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (rawInput) => safely(async () => {
        const input = raiseObjectionToolInputSchema.parse(rawInput);
        return raiseParticipantObjection(
          context.repository,
          context.roomId,
          input,
          await context.mutationContext(),
        );
      }),
    },
    get_open_issues: {
      name: "get_open_issues",
      description:
        "Read only unresolved objections with proposal, constraint, severity, and actor context for deliberation.",
      inputSchema: noInputSchema,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => safely(async () => {
        const room = await context.getRoom();
        return readToolSuccess(
          { openIssues: await context.getOpenIssues() },
          room.version,
          "Open issues loaded.",
        );
      }),
    },
    propose_tradeoff: {
      name: "propose_tradeoff",
      description:
        "Atomically record a trade-off for open issues and create its revised child proposal. Referenced conflicts stay open for later verification.",
      inputSchema: {
        type: "object",
        properties: {
          conflictIds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
          description: { type: "string", minLength: 1 },
          expectedEffect: { type: "string", minLength: 1 },
          revisedProposal: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
              summary: { type: "string", minLength: 1 },
              rationale: { type: "string", minLength: 1 },
              expectedOutcomes: stringArray,
              referencedConstraintIds: stringArray,
            },
            required: ["title", "summary", "rationale", "expectedOutcomes", "referencedConstraintIds"],
            additionalProperties: false,
          },
        },
        required: ["conflictIds", "description", "expectedEffect", "revisedProposal"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (rawInput) => safely(async () => {
        const input = proposeTradeoffToolInputSchema.parse(rawInput);
        return proposeParticipantTradeoff(
          context.repository,
          context.roomId,
          input,
          await context.mutationContext(),
        );
      }),
    },
  };
  return tools;
}

export function getRoomWebMcpToolsForPhase(
  context: RoomWebMcpContext,
  phase: RoomPhase,
): WebMcpToolDefinition[] {
  const tools = createRoomWebMcpTools(context);
  return ROOM_TOOL_NAMES_BY_PHASE[phase].map((name) => tools[name]!);
}
