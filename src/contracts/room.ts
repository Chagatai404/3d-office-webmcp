import { z } from "zod";

/**
 * Canonical, presentation-independent integration contract.
 *
 * Keep this module JSON-safe and environment-neutral. It must not import UI,
 * framework, database-client, route-handler, or Node-only modules.
 */

const idSchema = z.string().min(1);
const nullableTextSchema = z.string().min(1).nullable();
const timestampSchema = z.string().datetime({ offset: true });

export const roomPhaseSchema = z.enum([
  "input",
  "proposals",
  "deliberation",
  "voting",
  "approval",
  "finalized",
]);
export type RoomPhase = z.infer<typeof roomPhaseSchema>;

export const actorTypeSchema = z.enum(["participant", "expert", "system"]);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const actionOriginSchema = z.enum([
  "manual_ui",
  "webmcp",
  "simulation",
  "expert_service",
  "system",
]);
export type ActionOrigin = z.infer<typeof actionOriginSchema>;

export const participantSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    role: z.string().min(1),
    kind: z.enum(["human", "simulation"]),
    requiredForApproval: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();
export type Participant = z.infer<typeof participantSchema>;

export const positionSchema = z
  .object({
    id: idSchema,
    participantId: idSchema,
    summary: z.string().min(1),
    category: nullableTextSchema,
    priority: nullableTextSchema,
    createdAt: timestampSchema,
  })
  .strict();
export type Position = z.infer<typeof positionSchema>;

export const constraintSchema = z
  .object({
    id: idSchema,
    participantId: idSchema,
    category: z.string().min(1),
    text: z.string().min(1),
    priority: nullableTextSchema,
    createdAt: timestampSchema,
  })
  .strict();
export type Constraint = z.infer<typeof constraintSchema>;

export const proposalStatusSchema = z.enum([
  "draft",
  "candidate",
  "superseded",
  "accepted",
]);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalSchema = z
  .object({
    id: idSchema,
    participantId: idSchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    rationale: z.string().min(1),
    expectedOutcomes: z.array(z.string().min(1)),
    referencedConstraintIds: z.array(idSchema),
    parentProposalId: idSchema.nullable(),
    status: proposalStatusSchema,
    createdAt: timestampSchema,
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;

export const conflictSchema = z
  .object({
    id: idSchema,
    proposalId: idSchema,
    constraintId: idSchema.nullable(),
    raisedByActorType: actorTypeSchema,
    raisedByActorId: idSchema.nullable(),
    severity: z.enum(["blocking", "warning"]),
    reason: z.string().min(1),
    status: z.enum(["open", "resolved"]),
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();
export type Conflict = z.infer<typeof conflictSchema>;

export const tradeoffSchema = z
  .object({
    id: idSchema,
    conflictIds: z.array(idSchema).min(1),
    createdByActorType: actorTypeSchema,
    createdByActorId: idSchema.nullable(),
    description: z.string().min(1),
    expectedEffect: z.string().min(1),
    resultingProposalId: idSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();
export type Tradeoff = z.infer<typeof tradeoffSchema>;

export const voteChoiceSchema = z.enum([
  "support",
  "oppose",
  "abstain",
  "request_changes",
]);
export type VoteChoice = z.infer<typeof voteChoiceSchema>;

export const voteSchema = z
  .object({
    proposalId: idSchema,
    participantId: idSchema,
    choice: voteChoiceSchema,
    comment: nullableTextSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type Vote = z.infer<typeof voteSchema>;

export const approvalSchema = z
  .object({
    participantId: idSchema,
    decisionHash: z.string().min(1),
    approvedAt: timestampSchema,
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const activityEventSchema = z
  .object({
    id: idSchema,
    actorType: actorTypeSchema,
    actorId: idSchema.nullable(),
    origin: actionOriginSchema,
    action: z.string().min(1),
    entityType: nullableTextSchema,
    entityId: idSchema.nullable(),
    sanitizedInput: jsonValueSchema,
    result: jsonValueSchema,
    previousRoomVersion: z.number().int().nonnegative(),
    resultingRoomVersion: z.number().int().nonnegative(),
    confirmationRequired: z.boolean(),
    createdAt: timestampSchema,
  })
  .strict();
export type ActivityEvent = z.infer<typeof activityEventSchema>;

export const roomStateSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1),
    brief: z.string().min(1),
    phase: roomPhaseSchema,
    version: z.number().int().nonnegative(),
    selfParticipantId: idSchema.nullable(),
    activeProposalId: idSchema.nullable(),
    participants: z.array(participantSchema),
    positions: z.array(positionSchema),
    constraints: z.array(constraintSchema),
    proposals: z.array(proposalSchema),
    conflicts: z.array(conflictSchema),
    tradeoffs: z.array(tradeoffSchema),
    votes: z.array(voteSchema),
    approvals: z.array(approvalSchema),
    activity: z.array(activityEventSchema),
  })
  .strict();
export type RoomState = z.infer<typeof roomStateSchema>;

export const claimSeatInputSchema = z
  .object({
    seatId: idSchema,
  })
  .strict();
export type ClaimSeatInput = z.infer<typeof claimSeatInputSchema>;

export const addPositionInputSchema = z
  .object({
    summary: z.string().min(1),
    category: nullableTextSchema,
    priority: nullableTextSchema,
    constraints: z.array(
      z
        .object({
          category: z.string().min(1),
          text: z.string().min(1),
          priority: nullableTextSchema,
        })
        .strict(),
    ),
  })
  .strict();
export type AddPositionInput = z.infer<typeof addPositionInputSchema>;

export const submitProposalInputSchema = z
  .object({
    title: z.string().min(1),
    summary: z.string().min(1),
    rationale: z.string().min(1),
    expectedOutcomes: z.array(z.string().min(1)),
    referencedConstraintIds: z.array(idSchema),
    parentProposalId: idSchema.nullable(),
  })
  .strict();
export type SubmitProposalInput = z.infer<typeof submitProposalInputSchema>;

export const raiseObjectionInputSchema = z
  .object({
    proposalId: idSchema,
    constraintId: idSchema.nullable(),
    reason: z.string().min(1),
    severity: z.enum(["blocking", "warning"]),
  })
  .strict();
export type RaiseObjectionInput = z.infer<typeof raiseObjectionInputSchema>;

const revisedProposalSchema = submitProposalInputSchema.omit({
  parentProposalId: true,
});

export const proposeTradeoffInputSchema = z
  .object({
    conflictIds: z.array(idSchema).min(1),
    description: z.string().min(1),
    expectedEffect: z.string().min(1),
    revisedProposal: revisedProposalSchema.nullable(),
  })
  .strict();
export type ProposeTradeoffInput = z.infer<
  typeof proposeTradeoffInputSchema
>;

export const castVoteInputSchema = z
  .object({
    proposalId: idSchema,
    choice: voteChoiceSchema,
    comment: nullableTextSchema,
  })
  .strict();
export type CastVoteInput = z.infer<typeof castVoteInputSchema>;

export const decisionOwnerSchema = z
  .object({
    participantId: idSchema,
    responsibility: z.string().min(1),
  })
  .strict();
export type DecisionOwner = z.infer<typeof decisionOwnerSchema>;

export const decisionDeadlineSchema = z
  .object({
    label: z.string().min(1),
    dueAt: timestampSchema,
  })
  .strict();
export type DecisionDeadline = z.infer<typeof decisionDeadlineSchema>;

export const decisionActionItemSchema = z
  .object({
    id: idSchema,
    text: z.string().min(1),
    ownerParticipantId: idSchema.nullable(),
    dueAt: timestampSchema.nullable(),
  })
  .strict();
export type DecisionActionItem = z.infer<typeof decisionActionItemSchema>;

export const finalDecisionPreviewSchema = z
  .object({
    proposal: proposalSchema,
    rationale: z.string().min(1),
    unresolvedWarnings: z.array(conflictSchema),
    owners: z.array(decisionOwnerSchema),
    deadlines: z.array(decisionDeadlineSchema),
    actionItems: z.array(decisionActionItemSchema),
    dissent: z.array(z.string().min(1)),
    requiredApprovalParticipantIds: z.array(idSchema),
    decisionHash: z.string().min(1),
  })
  .strict();
export type FinalDecisionPreview = z.infer<
  typeof finalDecisionPreviewSchema
>;

export const decisionRecordSchema = z
  .object({
    roomId: idSchema,
    finalizedAt: timestampSchema,
    decision: finalDecisionPreviewSchema,
    acceptedTradeoffs: z.array(tradeoffSchema),
    votes: z.array(voteSchema),
    approvals: z.array(approvalSchema),
    provenance: z.array(activityEventSchema),
  })
  .strict();
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

export const actionErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_AUTHORIZED",
  "WRONG_PHASE",
  "STALE_ROOM_STATE",
  "UNRESOLVED_BLOCKING_CONFLICT",
  "HUMAN_CONFIRMATION_REQUIRED",
  "DECISION_CHANGED",
  "ALREADY_FINALIZED",
]);
export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

export type ActionResult<T = null> =
  | {
      ok: true;
      data: T;
      roomVersion: number;
      message: string;
    }
  | {
      ok: false;
      error: {
        code: ActionErrorCode;
        message: string;
        recovery?: string;
      };
      roomVersion: number;
    };

export const actionResultSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.discriminatedUnion("ok", [
    z
      .object({
        ok: z.literal(true),
        data: dataSchema,
        roomVersion: z.number().int().nonnegative(),
        message: z.string(),
      })
      .strict(),
    z
      .object({
        ok: z.literal(false),
        error: z
          .object({
            code: actionErrorCodeSchema,
            message: z.string().min(1),
            recovery: z.string().min(1).optional(),
          })
          .strict(),
        roomVersion: z.number().int().nonnegative(),
      })
      .strict(),
  ]);

export interface RoomClient {
  getRoom(roomId: string): Promise<RoomState>;

  subscribe(roomId: string, callback: (state: RoomState) => void): () => void;

  claimSeat(roomId: string, input: ClaimSeatInput): Promise<ActionResult>;

  addMyPosition(
    roomId: string,
    input: AddPositionInput,
  ): Promise<ActionResult>;

  submitProposal(
    roomId: string,
    input: SubmitProposalInput,
  ): Promise<ActionResult>;

  raiseObjection(
    roomId: string,
    input: RaiseObjectionInput,
  ): Promise<ActionResult>;

  proposeTradeoff(
    roomId: string,
    input: ProposeTradeoffInput,
  ): Promise<ActionResult>;

  castMyVote(roomId: string, input: CastVoteInput): Promise<ActionResult>;

  previewFinalDecision(
    roomId: string,
  ): Promise<ActionResult<FinalDecisionPreview>>;

  approveFinalDecision(
    roomId: string,
    input: { decisionHash: string },
  ): Promise<ActionResult>;

  getDecisionRecord(roomId: string): Promise<ActionResult<DecisionRecord>>;
}
