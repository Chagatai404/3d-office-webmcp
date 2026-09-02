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

export const demoModeSchema = z.enum(["multi_user", "solo_judge"]);
export type DemoMode = z.infer<typeof demoModeSchema>;

export const demoHumanRoleSchema = z.enum([
  "product",
  "engineer",
  "designer",
  "marketing",
]);
export type DemoHumanRole = z.infer<typeof demoHumanRoleSchema>;

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

export const meetingRoleSchema = z.enum(["owner", "cohost", "participant"]);
export type MeetingRole = z.infer<typeof meetingRoleSchema>;

export const decisionRoleSchema = z.enum([
  "decision_maker",
  "contributor",
  "advisor",
]);
export type DecisionRole = z.infer<typeof decisionRoleSchema>;

export const decisionPolicySchema = z.enum([
  "owner_decides",
  "equal_authority_consensus",
]);
export type DecisionPolicy = z.infer<typeof decisionPolicySchema>;

export const participantStatusSchema = z.enum(["active", "removed"]);
export type ParticipantStatus = z.infer<typeof participantStatusSchema>;

export const joinRequestStatusSchema = z.enum([
  "waiting",
  "admitted",
  "rejected",
  "cancelled",
]);
export type JoinRequestStatus = z.infer<typeof joinRequestStatusSchema>;

export const joinRequestSchema = z
  .object({
    id: idSchema,
    roomId: idSchema,
    displayName: z.string().min(1),
    role: z.string().min(1),
    status: joinRequestStatusSchema,
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const meetingSourceVisibilitySchema = z.enum([
  "shared_room",
  "private_to_participant",
]);
export type MeetingSourceVisibility = z.infer<typeof meetingSourceVisibilitySchema>;

export const meetingSourceStatusSchema = z.enum([
  "uploading",
  "processing",
  "ready",
  "failed",
  "removed",
]);
export type MeetingSourceStatus = z.infer<typeof meetingSourceStatusSchema>;

export const meetingSourceSchema = z
  .object({
    id: idSchema,
    roomId: idSchema,
    uploadedByParticipantId: idSchema,
    visibility: meetingSourceVisibilitySchema,
    title: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    byteSize: z.number().int().nonnegative(),
    sha256: z.string().min(1),
    status: meetingSourceStatusSchema,
    summary: nullableTextSchema,
    /**
     * Human-readable reason a `failed` source could not be processed. Always
     * server-generated and safe to show; never contains raw source text.
     * `null` for every non-failed status.
     */
    errorMessage: nullableTextSchema,
    createdAt: timestampSchema,
    processedAt: timestampSchema.nullable(),
    removedAt: timestampSchema.nullable(),
  })
  .strict();
export type MeetingSource = z.infer<typeof meetingSourceSchema>;

export const meetingSourceChunkSchema = z
  .object({
    id: idSchema,
    sourceId: idSchema,
    chunkIndex: z.number().int().nonnegative(),
    text: z.string().min(1),
    tokenEstimate: z.number().int().nonnegative(),
  })
  .strict();
export type MeetingSourceChunk = z.infer<typeof meetingSourceChunkSchema>;

export const meetingSourceContentSchema = z
  .object({
    sourceId: idSchema,
    chunks: z.array(meetingSourceChunkSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type MeetingSourceContent = z.infer<typeof meetingSourceContentSchema>;

export const meetingSourceSearchResultSchema = z
  .object({
    sourceId: idSchema,
    sourceTitle: z.string().min(1),
    chunkId: idSchema,
    chunkIndex: z.number().int().nonnegative(),
    excerpt: z.string().min(1),
  })
  .strict();
export type MeetingSourceSearchResult = z.infer<
  typeof meetingSourceSearchResultSchema
>;

export const meetingSourceSearchResultsSchema = z
  .object({
    query: z.string().min(1),
    results: z.array(meetingSourceSearchResultSchema),
  })
  .strict();
export type MeetingSourceSearchResults = z.infer<
  typeof meetingSourceSearchResultsSchema
>;

/**
 * `expert` is a distinct, non-human actor kind: an advisory service actor
 * (see `ExpertFinding` below), never an admitted human and never a
 * simulated teammate. Every place in this codebase that branches on
 * `kind === "human"` already excludes it by construction; every place that
 * branches on `kind === "simulation"` must not be assumed to include it.
 */
export const participantSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    role: z.string().min(1),
    kind: z.enum(["human", "simulation", "expert"]),
    meetingRole: meetingRoleSchema,
    decisionRole: decisionRoleSchema,
    isClaimed: z.boolean(),
    isReady: z.boolean(),
    status: participantStatusSchema,
    removedAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .strict();
export type Participant = z.infer<typeof participantSchema>;

/**
 * `referencedSourceIds` links a participant-owned input back to the meeting
 * sources that informed it. It is provenance metadata only: it never grants a
 * source any decision authority, and an unknown or non-visible id is rejected
 * server-side rather than silently kept.
 */
export const positionSchema = z
  .object({
    id: idSchema,
    participantId: idSchema,
    summary: z.string().min(1),
    category: nullableTextSchema,
    priority: nullableTextSchema,
    referencedSourceIds: z.array(idSchema),
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
    referencedSourceIds: z.array(idSchema),
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
    referencedSourceIds: z.array(idSchema),
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
    resolvedByActorType: actorTypeSchema.nullable(),
    resolvedByActorId: idSchema.nullable(),
    resolutionNote: nullableTextSchema,
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

/**
 * Alignment replaces Vote as the canonical product/domain concept.
 *
 * Alignment is informative, not decisive: it exposes support, concerns,
 * strong objections, and missing perspectives to the responsible decision
 * authority. It never mechanically determines a room's outcome — see
 * `DecisionPolicy` and the policy-aware finalization functions in
 * `src/domain/rooms/operations.ts`.
 */
export const alignmentChoiceSchema = z.enum([
  "support",
  "concern",
  "strong_objection",
  "needs_clarification",
]);
export type AlignmentChoice = z.infer<typeof alignmentChoiceSchema>;

export const alignmentSchema = z
  .object({
    proposalId: idSchema,
    participantId: idSchema,
    choice: alignmentChoiceSchema,
    comment: nullableTextSchema,
    updatedAt: timestampSchema,
  })
  .strict();
export type Alignment = z.infer<typeof alignmentSchema>;

export const approvalSchema = z
  .object({
    participantId: idSchema,
    decisionHash: z.string().min(1),
    approvedAt: timestampSchema,
  })
  .strict();
export type Approval = z.infer<typeof approvalSchema>;

/**
 * ExpertFinding is advisory data, never a human Conflict and never a vote.
 * It carries no mechanical authority over any phase transition or
 * finalization -- see `record_expert_advice_outcome` / the owner-only
 * disposition operation in `src/domain/rooms/expert.ts` for the only way its
 * `status` changes, and `docs/webmcp-demo.md` / `docs/judge-demo.md` for how
 * it surfaces in the final decision record.
 */
export const expertKeySchema = z.enum(["security"]);
export type ExpertKey = z.infer<typeof expertKeySchema>;

export const expertFindingStatusSchema = z.enum([
  "open",
  "resolved",
  "accepted_risk",
  "rejected",
]);
export type ExpertFindingStatus = z.infer<typeof expertFindingStatusSchema>;

export const expertFindingSchema = z
  .object({
    id: idSchema,
    roomId: idSchema,
    expertParticipantId: idSchema,
    expertKey: expertKeySchema,
    proposalId: idSchema,
    category: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    recommendation: z.string().min(1),
    status: expertFindingStatusSchema,
    resolutionRationale: nullableTextSchema,
    createdAt: timestampSchema,
    resolvedAt: timestampSchema.nullable(),
  })
  .strict();
export type ExpertFinding = z.infer<typeof expertFindingSchema>;

export const recordExpertAdviceOutcomeInputSchema = z
  .object({
    findingId: idSchema,
    status: z.enum(["resolved", "accepted_risk", "rejected"]),
    rationale: z.string().min(1),
  })
  .strict();
export type RecordExpertAdviceOutcomeInput = z.infer<
  typeof recordExpertAdviceOutcomeInputSchema
>;

/**
 * The deterministic, hash-stable projection of expert advice embedded in a
 * frozen `FinalDecisionCandidate`. Deliberately narrower than `ExpertFinding`
 * -- no free-form `summary`/`recommendation` prose duplication beyond
 * `title`, so a candidate already frozen can never have its hash silently
 * redefined by later prose edits (there are none: findings are immutable
 * except for `status`/`resolutionRationale`, which *are* included here on
 * purpose so a disposition change before freeze is reflected in the hash).
 */
export const decisionExpertAdviceSchema = z
  .object({
    expertKey: expertKeySchema,
    findingId: idSchema,
    proposalId: idSchema,
    category: z.string().min(1),
    title: z.string().min(1),
    status: expertFindingStatusSchema,
    resolutionRationale: nullableTextSchema,
  })
  .strict();
export type DecisionExpertAdvice = z.infer<typeof decisionExpertAdviceSchema>;

/**
 * AttentionItem is a derived projection of canonical room state, never a
 * second source of authority. It is computed fresh on every read
 * (`src/domain/rooms/attention.ts`) and never persisted: nothing here
 * gates a mutation, and nothing here can be stale in a way that matters,
 * because it is recomputed from the same `RoomState` every time.
 */
export const attentionItemTypeSchema = z.enum([
  "input_required",
  "admission_request",
  "conflict_requires_human",
  "alignment_required",
  "owner_decision_required",
  "consensus_approval_required",
  "owner_progress_required",
  "expert_advice_needs_disposition",
]);
export type AttentionItemType = z.infer<typeof attentionItemTypeSchema>;

export const attentionPrioritySchema = z.enum(["normal", "high", "critical"]);
export type AttentionPriority = z.infer<typeof attentionPrioritySchema>;

export const attentionItemSchema = z
  .object({
    id: idSchema,
    type: attentionItemTypeSchema,
    priority: attentionPrioritySchema,
    title: z.string().min(1),
    summary: z.string().min(1),
    phase: roomPhaseSchema,
    relatedEntityId: idSchema.nullable(),
    requiresHumanConfirmation: z.boolean(),
  })
  .strict();
export type AttentionItem = z.infer<typeof attentionItemSchema>;

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

/**
 * One human-readable line of `MeetingReport.activityLog` (A8) -- the same
 * projection `computeRoomUpdates` (`src/domain/rooms/room-updates.ts`) builds
 * for `get_room_updates`, reused here so the report's full chronological
 * account of every participant action is derived once, not reconstructed
 * per consumer.
 */
export const reportActivityEntrySchema = z
  .object({
    roomVersion: z.number().int().nonnegative(),
    actorType: actorTypeSchema,
    actorName: z.string().nullable(),
    summary: z.string().min(1),
    createdAt: timestampSchema,
  })
  .strict();
export type ReportActivityEntry = z.infer<typeof reportActivityEntrySchema>;

export const claimSeatInputSchema = z
  .object({
    seatId: idSchema,
  })
  .strict();
export type ClaimSeatInput = z.infer<typeof claimSeatInputSchema>;

export const createMeetingSourceInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    filename: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(1).max(160),
    byteSize: z.number().int().nonnegative().max(25 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    visibility: meetingSourceVisibilitySchema,
    chunks: z.array(z.string().trim().min(1).max(12_000)).max(200),
    summary: nullableTextSchema,
    /**
     * When true, the source is created in `processing` with no chunks yet and
     * a later `mark_meeting_source_processed` / `mark_meeting_source_failed`
     * transition finishes it. Used for binary file types (`.pdf`, `.docx`)
     * whose text is extracted out of band. When absent/false, `chunks` must be
     * non-empty and the source is created `ready`.
     */
    expectsExtraction: z.boolean().optional(),
    /**
     * Server-only pointer to the private object-storage location of the raw
     * bytes. Never projected back into `RoomState` (the canonical read DTO
     * `meetingSourceSchema` has no storage fields) — it exists so the upload
     * route can persist the storage convention alongside the metadata row.
     */
    storageBucket: z.string().trim().min(1).max(128).optional(),
    storagePath: z.string().trim().min(1).max(1024).optional(),
  })
  .strict();
export type CreateMeetingSourceInput = z.infer<
  typeof createMeetingSourceInputSchema
>;

export const markMeetingSourceProcessedInputSchema = z
  .object({
    sourceId: idSchema,
    chunks: z.array(z.string().trim().min(1).max(12_000)).min(1).max(200),
    summary: nullableTextSchema,
  })
  .strict();
export type MarkMeetingSourceProcessedInput = z.infer<
  typeof markMeetingSourceProcessedInputSchema
>;

export const markMeetingSourceFailedInputSchema = z
  .object({
    sourceId: idSchema,
    errorMessage: z.string().trim().min(1).max(500),
  })
  .strict();
export type MarkMeetingSourceFailedInput = z.infer<
  typeof markMeetingSourceFailedInputSchema
>;

export const readMeetingSourceContentInputSchema = z
  .object({
    sourceId: idSchema,
    cursor: z.string().min(1).nullable(),
    maxChunks: z.number().int().min(1).max(20),
  })
  .strict();
export type ReadMeetingSourceContentInput = z.infer<
  typeof readMeetingSourceContentInputSchema
>;

export const searchMeetingSourcesInputSchema = z
  .object({
    query: z.string().trim().min(1).max(240),
    sourceIds: z.array(idSchema).max(20),
    limit: z.number().int().min(1).max(20),
  })
  .strict();
export type SearchMeetingSourcesInput = z.infer<
  typeof searchMeetingSourcesInputSchema
>;

export const meetingSourceIdInputSchema = z
  .object({
    sourceId: idSchema,
  })
  .strict();
export type MeetingSourceIdInput = z.infer<typeof meetingSourceIdInputSchema>;

export const addPositionInputSchema = z
  .object({
    summary: z.string().min(1),
    category: nullableTextSchema,
    priority: nullableTextSchema,
    referencedSourceIds: z.array(idSchema).max(20).optional(),
    constraints: z.array(
      z
        .object({
          category: z.string().min(1),
          text: z.string().min(1),
          priority: nullableTextSchema,
          referencedSourceIds: z.array(idSchema).max(20).optional(),
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
    referencedSourceIds: z.array(idSchema).max(20).optional(),
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

export const resolveObjectionInputSchema = z
  .object({
    conflictId: idSchema,
    resolutionNote: z.string().min(1),
  })
  .strict();
export type ResolveObjectionInput = z.infer<typeof resolveObjectionInputSchema>;

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

export const expressAlignmentInputSchema = z
  .object({
    proposalId: idSchema,
    choice: alignmentChoiceSchema,
    comment: nullableTextSchema,
  })
  .strict();
export type ExpressAlignmentInput = z.infer<typeof expressAlignmentInputSchema>;

/**
 * The only decision roles an owner may assign through
 * `setParticipantDecisionRole`. `advisor` is reserved for expert/simulation
 * actors and is never assignable to an ordinary human through this input.
 */
export const assignableDecisionRoleSchema = z.enum([
  "decision_maker",
  "contributor",
]);
export type AssignableDecisionRole = z.infer<typeof assignableDecisionRoleSchema>;

export const setParticipantDecisionRoleInputSchema = z
  .object({
    participantId: idSchema,
    decisionRole: assignableDecisionRoleSchema,
  })
  .strict();
export type SetParticipantDecisionRoleInput = z.infer<
  typeof setParticipantDecisionRoleInputSchema
>;

/**
 * A6: the single post-admission role/decision-authority configuration
 * capability -- "one clear configuration capability rather than many
 * ambiguous controls." `participantId` is always the target, never caller
 * authority, exactly like every other owner-only input in this contract.
 * At least one of `role`/`decisionRole` must be present; `decisionRole`
 * reuses `assignableDecisionRoleSchema`, so `advisor` (reserved for expert/
 * simulation actors) can never be assigned to a human through this path.
 */
export const configureParticipantInputSchema = z
  .object({
    participantId: idSchema,
    role: z.string().trim().min(1).max(120).nullish(),
    decisionRole: assignableDecisionRoleSchema.nullish(),
  })
  .strict()
  .refine((input) => input.role != null || input.decisionRole != null, {
    message: "Provide a role, a decision role, or both.",
  });
export type ConfigureParticipantInput = z.infer<typeof configureParticipantInputSchema>;

export const setDecisionPolicyInputSchema = z
  .object({
    decisionPolicy: decisionPolicySchema,
  })
  .strict();
export type SetDecisionPolicyInput = z.infer<typeof setDecisionPolicyInputSchema>;

export const approveFinalDecisionInputSchema = z
  .object({ decisionHash: z.string().min(1) })
  .strict();
export type ApproveFinalDecisionInput = z.infer<
  typeof approveFinalDecisionInputSchema
>;

export const startDemoScenarioInputSchema = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("multi_user"), humanRole: z.null() })
    .strict(),
  z
    .object({ mode: z.literal("solo_judge"), humanRole: demoHumanRoleSchema })
    .strict(),
]);
export type StartDemoScenarioInput = z.infer<
  typeof startDemoScenarioInputSchema
>;

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

/**
 * A single meeting source's deterministic, hash-stable fingerprint embedded in
 * a frozen `FinalDecisionCandidate`. Deliberately excludes the mutable
 * `summary` / `title` / `filename` prose: a source's extracted summary can be
 * regenerated without redefining an already-frozen decision hash. Only
 * `shared_room`, non-removed sources are included — a private participant-only
 * source never enters another participant's decision record.
 */
export const decisionSourceProvenanceSchema = z
  .object({
    sourceId: idSchema,
    uploadedByParticipantId: idSchema,
    visibility: meetingSourceVisibilitySchema,
    sha256: z.string().min(1),
    status: meetingSourceStatusSchema,
  })
  .strict();
export type DecisionSourceProvenance = z.infer<
  typeof decisionSourceProvenanceSchema
>;

export const finalDecisionCandidateSchema = z
  .object({
    proposal: proposalSchema,
    rationale: z.string().min(1),
    acceptedTradeoffs: z.array(tradeoffSchema),
    unresolvedWarnings: z.array(conflictSchema),
    alignments: z.array(alignmentSchema),
    /**
     * The policy this candidate was frozen under. Required-approver
     * authority (below) is computed from this policy, never from the
     * legacy, private `required_for_approval` compatibility column.
     */
    decisionPolicy: decisionPolicySchema,
    owners: z.array(decisionOwnerSchema),
    deadlines: z.array(decisionDeadlineSchema),
    actionItems: z.array(decisionActionItemSchema),
    /**
     * Deterministically derived from concern / strong_objection alignments
     * and unresolved warnings — never generated prose — so the candidate
     * hash stays reproducible.
     */
    dissent: z.array(z.string().min(1)),
    /**
     * Deterministic fingerprints of the shared meeting sources that were
     * attached when the candidate was frozen. Provenance only: never counted
     * toward approval authority and never a source of dissent.
     */
    sourceProvenance: z.array(decisionSourceProvenanceSchema),
    requiredApprovalParticipantIds: z.array(idSchema),
    /**
     * Deterministic expert advice relevant to this candidate's proposal
     * lineage. Never counted toward `requiredApprovalParticipantIds` and
     * never a source of dissent by itself -- see `decisionExpertAdviceSchema`.
     */
    expertAdvice: z.array(decisionExpertAdviceSchema),
  })
  .strict();
export type FinalDecisionCandidate = z.infer<
  typeof finalDecisionCandidateSchema
>;

export const finalDecisionPreviewSchema = finalDecisionCandidateSchema
  .extend({
    decisionHash: z.string().min(1),
    approvals: z.array(approvalSchema),
    missingApprovalParticipantIds: z.array(idSchema),
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
    alignments: z.array(alignmentSchema),
    approvals: z.array(approvalSchema),
    provenance: z.array(activityEventSchema),
  })
  .strict();
export type DecisionRecord = z.infer<typeof decisionRecordSchema>;

/**
 * A8: the single canonical final-report projection. Every consumer --
 * `get_final_report` (WebMCP), the finalized-room report UI (B7), and the
 * PDF export (A9) -- reads this same shape, computed once by
 * `computeMeetingReport` (`src/domain/rooms/report.ts`) from a finalized
 * `RoomState` plus its `DecisionRecord`. Nothing here is a second
 * reconstruction of the decision: every decision-shaped field is carried
 * over from `DecisionRecord.decision` unchanged, and every added field
 * (title, brief, roster, inputs, constraints, proposals, concerns) is
 * read directly off canonical room state, never re-derived or
 * approximated.
 */
export const meetingReportSchema = z
  .object({
    roomId: idSchema,
    title: z.string().min(1),
    brief: z.string().min(1),
    /** One deterministic, templated paragraph built only from structured fields below -- never freeform/generated prose. */
    executiveSummary: z.string().min(1),
    finalDecision: z
      .object({
        title: z.string().min(1),
        summary: z.string().min(1),
      })
      .strict(),
    rationale: z.string().min(1),
    participants: z.array(participantSchema),
    decisionPolicy: decisionPolicySchema,
    keyInputs: z.array(positionSchema),
    constraints: z.array(constraintSchema),
    proposalsConsidered: z.array(proposalSchema),
    concernsRaised: z.array(conflictSchema),
    resolvedConcerns: z.array(conflictSchema),
    unresolvedWarnings: z.array(conflictSchema),
    acceptedTradeoffs: z.array(tradeoffSchema),
    alignment: z.array(alignmentSchema),
    dissent: z.array(z.string().min(1)),
    expertAdvice: z.array(decisionExpertAdviceSchema),
    actionItems: z.array(decisionActionItemSchema),
    owners: z.array(decisionOwnerSchema),
    deadlines: z.array(decisionDeadlineSchema),
    requiredApprovalParticipantIds: z.array(idSchema),
    approvals: z.array(approvalSchema),
    decisionHash: z.string().min(1),
    finalizedAt: timestampSchema,
    /** An event-count-by-action summary, kept alongside `activityLog` for callers that only need volume, not narrative. */
    provenanceSummary: z
      .object({
        totalEvents: z.number().int().nonnegative(),
        byAction: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    /**
     * The full chronological, human-readable account of every recorded
     * action in the room -- who did what and when, from creation through
     * finalization. This is what makes the report a complete record of how
     * the decision was reached, not just its outcome.
     */
    activityLog: z.array(reportActivityEntrySchema),
  })
  .strict();
export type MeetingReport = z.infer<typeof meetingReportSchema>;

export const roomStateSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1),
    brief: z.string().min(1),
    demoMode: demoModeSchema.nullable(),
    phase: roomPhaseSchema,
    version: z.number().int().nonnegative(),
    ownerParticipantId: idSchema,
    decisionPolicy: decisionPolicySchema,
    isLocked: z.boolean(),
    selfParticipantId: idSchema.nullable(),
    activeProposalId: idSchema.nullable(),
    finalizedAt: timestampSchema.nullable(),
    finalDecisionPreview: finalDecisionPreviewSchema.nullable(),
    participants: z.array(participantSchema),
    positions: z.array(positionSchema),
    constraints: z.array(constraintSchema),
    proposals: z.array(proposalSchema),
    conflicts: z.array(conflictSchema),
    tradeoffs: z.array(tradeoffSchema),
    alignments: z.array(alignmentSchema),
    approvals: z.array(approvalSchema),
    activity: z.array(activityEventSchema),
    expertFindings: z.array(expertFindingSchema),
    sources: z.array(meetingSourceSchema),
  })
  .strict();
export type RoomState = z.infer<typeof roomStateSchema>;

export const actionErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "NOT_AUTHORIZED",
  "WRONG_PHASE",
  "STALE_ROOM_STATE",
  "WAITING_FOR_PARTICIPANTS",
  "UNRESOLVED_BLOCKING_CONFLICT",
  "HUMAN_CONFIRMATION_REQUIRED",
  "DECISION_CHANGED",
  "ALREADY_FINALIZED",
  "INVALID_JOIN_CREDENTIALS",
  "ALREADY_PARTICIPANT",
  "REQUEST_ALREADY_RESOLVED",
  "MEETING_LOCKED",
  "RATE_LIMITED",
]);
export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

/**
 * Optional, JSON-safe structured detail carried by some refusals -- e.g.
 * `WAITING_FOR_PARTICIPANTS`'s `{ waitingParticipantIds: [...] }`. Kept as
 * a generic `JsonValue` rather than a per-code union: `ActionResult` is
 * shared across every mutation, and a natural-language agent already reads
 * `message`/`recovery`; `details` exists for the rarer case where an agent
 * (or the UI) wants the exact structured list instead of parsing prose.
 */
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
        details?: JsonValue;
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
            details: jsonValueSchema.optional(),
          })
          .strict(),
        roomVersion: z.number().int().nonnegative(),
      })
      .strict(),
  ]);

/**
 * Pre-membership onboarding contract: room creation and invitation
 * preview/claim. These happen before a caller has an authenticated seat in
 * a room, so their DTOs are kept separate from `RoomState`.
 */

export const createRoomInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    brief: z.string().trim().min(1).max(4_000),
    creatorName: z.string().trim().min(1).max(120),
    creatorRole: z.string().trim().min(1).max(120),
    decisionPolicy: decisionPolicySchema.optional(),
  })
  .strict();
export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;

export const createdRoomSchema = z
  .object({
    roomId: idSchema,
    ownerParticipantId: idSchema,
    inviteUrl: z.string().url(),
    passcode: z.string().min(6),
  })
  .strict();
export type CreatedRoom = z.infer<typeof createdRoomSchema>;

export const roomInvitePreviewSchema = z.discriminatedUnion("inviteValid", [
  z.object({
    inviteValid: z.literal(true),
    roomId: idSchema,
    title: z.string().min(1),
    brief: z.string().min(1),
    ownerDisplayName: z.string().min(1),
  }).strict(),
  z.object({ inviteValid: z.literal(false) }).strict(),
]);
export type RoomInvitePreview = z.infer<typeof roomInvitePreviewSchema>;

export const requestJoinByPasscodeInputSchema = z.object({
  roomId: idSchema,
  passcode: z.string().min(1).max(64),
  displayName: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
}).strict();
export type RequestJoinByPasscodeInput = z.infer<typeof requestJoinByPasscodeInputSchema>;

export const requestJoinByInviteInputSchema = z.object({
  inviteToken: z.string().min(1).max(512),
  displayName: z.string().trim().min(1).max(120),
  role: z.string().trim().min(1).max(120),
}).strict();
export type RequestJoinByInviteInput = z.infer<typeof requestJoinByInviteInputSchema>;

export const manageJoinRequestInputSchema = z.object({
  joinRequestId: idSchema,
}).strict();
export type ManageJoinRequestInput = z.infer<typeof manageJoinRequestInputSchema>;

/**
 * A6: the joiner's own requested `role` is metadata, not unquestioned
 * authority. Admitting them accepts the owner's explicit `role`/
 * `decisionRole` overrides in the same call ("Admit Deniz as CTO and give
 * him decision authority") -- both nullish, meaning "use the joiner's own
 * requested role" and "default to contributor" respectively, exactly
 * preserving the previous behavior when the owner supplies neither.
 * `decisionRole` reuses `assignableDecisionRoleSchema`, so `advisor` can
 * never be requested through this path either.
 */
export const admitJoinRequestInputSchema = manageJoinRequestInputSchema.extend({
  role: z.string().trim().min(1).max(120).nullish(),
  decisionRole: assignableDecisionRoleSchema.nullish(),
}).strict();
export type AdmitJoinRequestInput = z.infer<typeof admitJoinRequestInputSchema>;

export const joinRequestResultSchema = z.object({
  roomId: idSchema,
  joinRequest: joinRequestSchema,
}).strict();
export type JoinRequestResult = z.infer<typeof joinRequestResultSchema>;

/**
 * Owner-only membership lifecycle inputs. `participantId` is always the
 * *target*, never the caller's own authority: the acting owner is derived
 * server-side from the authenticated session, exactly like every other
 * owner-only operation in this contract.
 */
export const removeParticipantInputSchema = z.object({
  participantId: idSchema,
}).strict();
export type RemoveParticipantInput = z.infer<typeof removeParticipantInputSchema>;

export const transferOwnershipInputSchema = z.object({
  participantId: idSchema,
}).strict();
export type TransferOwnershipInput = z.infer<typeof transferOwnershipInputSchema>;

export interface RoomClient {
  getRoom(roomId: string): Promise<RoomState>;

  subscribe(
    roomId: string,
    callback: (state: RoomState) => void,
    onUnavailable?: () => void,
  ): () => void;

  claimSeat(roomId: string, input: ClaimSeatInput): Promise<ActionResult>;

  /** Read source metadata visible to the authenticated participant. */
  listMeetingSources?(
    roomId: string,
  ): Promise<ActionResult<MeetingSource[]>>;

  /**
   * Create a meeting source from already-extracted text chunks. Browser file
   * upload helpers live outside this canonical JSON contract.
   */
  createMeetingSource?(
    roomId: string,
    input: CreateMeetingSourceInput,
  ): Promise<ActionResult<MeetingSource>>;

  /** Read source content in bounded chunks. */
  readMeetingSourceContent?(
    roomId: string,
    input: ReadMeetingSourceContentInput,
  ): Promise<ActionResult<MeetingSourceContent>>;

  /** Search visible source chunks without trusting their text as instructions. */
  searchMeetingSources?(
    roomId: string,
    input: SearchMeetingSourcesInput,
  ): Promise<ActionResult<MeetingSourceSearchResults>>;

  /**
   * Finish a `processing` (or retry a `failed`) source by attaching its
   * extracted text chunks. Uploader or room owner only, before finalization.
   */
  markMeetingSourceProcessed?(
    roomId: string,
    input: MarkMeetingSourceProcessedInput,
  ): Promise<ActionResult<MeetingSource>>;

  /** Record a retryable processing failure on a source. */
  markMeetingSourceFailed?(
    roomId: string,
    input: MarkMeetingSourceFailedInput,
  ): Promise<ActionResult<MeetingSource>>;

  /** Make a private uploaded source visible to the room. */
  shareMeetingSource?(
    roomId: string,
    sourceId: string,
  ): Promise<ActionResult<MeetingSource>>;

  /** Soft-remove a source the caller is allowed to manage. */
  removeMeetingSource?(
    roomId: string,
    sourceId: string,
  ): Promise<ActionResult>;

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

  resolveObjection(
    roomId: string,
    input: ResolveObjectionInput,
  ): Promise<ActionResult>;

  proposeTradeoff(
    roomId: string,
    input: ProposeTradeoffInput,
  ): Promise<ActionResult>;

  /**
   * Express or update only the authenticated participant's own alignment on
   * the active proposal. Alignment informs the responsible decision
   * authority; it never mechanically decides the outcome by itself.
   */
  expressMyAlignment(
    roomId: string,
    input: ExpressAlignmentInput,
  ): Promise<ActionResult>;

  previewFinalDecision(
    roomId: string,
  ): Promise<ActionResult<FinalDecisionPreview>>;

  approveFinalDecision(
    roomId: string,
    input: ApproveFinalDecisionInput,
  ): Promise<ActionResult>;

  getDecisionRecord(roomId: string): Promise<ActionResult<DecisionRecord>>;

  /** Canonical human-facing report projection, available only after finalization. */
  getMeetingReport(roomId: string): Promise<ActionResult<MeetingReport>>;

  startDemoScenario(
    roomId: string,
    input: StartDemoScenarioInput,
  ): Promise<ActionResult>;

  advanceDemoPhase(
    roomId: string,
    phase: RoomPhase,
  ): Promise<ActionResult>;

  /** Claimed human marks their own published input ready. Input phase only. */
  markMyInputReady(roomId: string): Promise<ActionResult>;

  /** Owner-only production phase advance. Kept separate from `advanceDemoPhase`. */
  advanceRoomPhase(
    roomId: string,
    phase: RoomPhase,
  ): Promise<ActionResult>;

  listJoinRequests(roomId: string): Promise<ActionResult<JoinRequest[]>>;

  /** `input.role`/`input.decisionRole` let the owner assign an explicit role and decision authority in the same call. */
  admitJoinRequest(
    roomId: string,
    input: AdmitJoinRequestInput,
  ): Promise<ActionResult<JoinRequest>>;

  rejectJoinRequest(
    roomId: string,
    input: ManageJoinRequestInput,
  ): Promise<ActionResult<JoinRequest>>;

  /** Owner-only. Existing participants keep normal access; new join requests are refused. */
  lockMeeting(roomId: string): Promise<ActionResult>;

  /** Owner-only. Allows new join requests again. */
  unlockMeeting(roomId: string): Promise<ActionResult>;

  /** Owner-only. Marks an active human participant removed; history is preserved. */
  removeParticipant(
    roomId: string,
    input: RemoveParticipantInput,
  ): Promise<ActionResult>;

  /** Owner-only. Atomically moves meeting authority to another active human participant. */
  transferOwnership(
    roomId: string,
    input: TransferOwnershipInput,
  ): Promise<ActionResult>;

  /**
   * Owner-only. Changes the room's decision authority model. Rejected once
   * an exact decision candidate is frozen; return to Alignment first.
   */
  setDecisionPolicy(
    roomId: string,
    input: SetDecisionPolicyInput,
  ): Promise<ActionResult>;

  /**
   * Owner-only. Promotes/demotes an active human participant between
   * `decision_maker` and `contributor`. The current owner can never cease
   * being a decision-maker, and simulations/experts can never be assigned.
   */
  setParticipantDecisionRole(
    roomId: string,
    input: SetParticipantDecisionRoleInput,
  ): Promise<ActionResult>;

  /**
   * Owner-only. Updates an active human participant's human-readable role,
   * decision authority, or both in one call -- the single post-admission
   * configuration capability (A6). Same invariants as
   * `setParticipantDecisionRole`: the current owner can never cease being a
   * decision-maker, experts/simulations can never be targeted, and a
   * decision-role change is rejected once an exact decision candidate is
   * frozen.
   */
  configureParticipant(
    roomId: string,
    input: ConfigureParticipantInput,
  ): Promise<ActionResult>;
}
