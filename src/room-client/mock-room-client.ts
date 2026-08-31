import {
  addPositionInputSchema,
  claimSeatInputSchema,
  createMeetingSourceInputSchema,
  markMeetingSourceFailedInputSchema,
  markMeetingSourceProcessedInputSchema,
  readMeetingSourceContentInputSchema,
  searchMeetingSourcesInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type ActivityEvent,
  type AddPositionInput,
  type AdmitJoinRequestInput,
  type ClaimSeatInput,
  type ConfigureParticipantInput,
  type Constraint,
  type CreateMeetingSourceInput,
  type DecisionRecord,
  type FinalDecisionPreview,
  type JsonValue,
  type JoinRequest,
  type ManageJoinRequestInput,
  type MarkMeetingSourceFailedInput,
  type MarkMeetingSourceProcessedInput,
  type MeetingSource,
  type MeetingSourceContent,
  type MeetingSourceSearchResults,
  type Participant,
  type Position,
  type ReadMeetingSourceContentInput,
  type RemoveParticipantInput,
  type ResolveObjectionInput,
  type RoomClient,
  type RoomPhase,
  type RoomState,
  type SearchMeetingSourcesInput,
  type SetDecisionPolicyInput,
  type SetParticipantDecisionRoleInput,
  type StartDemoScenarioInput,
  type TransferOwnershipInput,
} from "@/contracts/room";

/**
 * Local, deterministic stand-in for the server domain layer.
 *
 * BACKEND CONTRACT:
 * Nothing here is production authorization or production domain logic. The
 * mock exists only to exercise the frontend contract: it validates input,
 * derives the acting participant from its own session state instead of from
 * caller-supplied identity, increments `version`, appends an `ActivityEvent`,
 * and emits a fresh snapshot to subscribers.
 */

const CLOCK_STEP_MS = 1_000;

type Listener = (state: RoomState) => void;

function fail(
  code: ActionErrorCode,
  message: string,
  roomVersion: number,
  recovery?: string,
): ActionResult<never> {
  return {
    ok: false,
    error: recovery === undefined
      ? { code, message }
      : { code, message, recovery },
    roomVersion,
  };
}

/** Continues an `id-<n>` sequence past whatever the seed already used. */
function nextSequence(ids: readonly string[], prefix: string): number {
  let highest = 0;
  for (const id of ids) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

export class MockRoomClient implements RoomClient {
  #state: RoomState;
  #listeners = new Set<Listener>();
  #sourceChunks = new Map<string, MeetingSourceContent["chunks"]>();
  #clockMs: number;
  #positionSeq: number;
  #constraintSeq: number;
  #sourceSeq: number;
  #eventSeq: number;

  constructor(seed: RoomState) {
    this.#state = structuredClone(seed);

    const latestSeededTime = [...seed.activity]
      .map((event) => Date.parse(event.createdAt))
      .reduce((latest, current) => Math.max(latest, current), 0);
    this.#clockMs = latestSeededTime;

    this.#positionSeq = nextSequence(
      seed.positions.map((entry) => entry.id),
      "position",
    );
    this.#constraintSeq = nextSequence(
      seed.constraints.map((entry) => entry.id),
      "constraint",
    );
    this.#sourceSeq = nextSequence(
      seed.sources.map((entry) => entry.id),
      "source",
    );
    this.#eventSeq = nextSequence(
      seed.activity.map((entry) => entry.id),
      "event",
    );
  }

  async getRoom(roomId: string): Promise<RoomState> {
    if (roomId !== this.#state.id) {
      throw new Error(`Unknown room: ${roomId}`);
    }
    return this.#snapshot();
  }

  subscribe(roomId: string, callback: Listener): () => void {
    if (roomId !== this.#state.id) return () => {};

    this.#listeners.add(callback);
    // Imitates a realtime client delivering the current snapshot on connect.
    queueMicrotask(() => {
      if (this.#listeners.has(callback)) callback(this.#snapshot());
    });

    return () => {
      this.#listeners.delete(callback);
    };
  }

  async claimSeat(
    roomId: string,
    input: ClaimSeatInput,
  ): Promise<ActionResult> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const parsed = claimSeatInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        "The seat request was not in a valid shape.",
        this.#state.version,
        "Pick a seat from the participant list and try again.",
      );
    }

    const seat = this.#state.participants.find(
      (participant) => participant.id === parsed.data.seatId,
    );
    if (!seat) {
      return fail(
        "VALIDATION_ERROR",
        "That seat does not exist in this room.",
        this.#state.version,
        "Reload the room and choose an existing seat.",
      );
    }

    return this.#commit({
      apply: (draft) => {
        draft.selfParticipantId = seat.id;
        const claimedSeat = draft.participants.find(
          (participant) => participant.id === seat.id,
        );
        if (claimedSeat) claimedSeat.isClaimed = true;
      },
      actor: seat,
      origin: "manual_ui",
      action: "seat.claimed",
      entityType: "participant",
      entityId: seat.id,
      sanitizedInput: { seatId: seat.id },
      message: `You are seated as ${seat.name} (${seat.role}).`,
    });
  }

  async listMeetingSources(roomId: string): Promise<ActionResult<MeetingSource[]>> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const self = this.#self();
    if (!self) {
      return fail(
        "NOT_AUTHORIZED",
        "Only an active admitted participant can read meeting sources.",
        this.#state.version,
      );
    }

    return {
      ok: true,
      data: this.#visibleSourcesFor(self),
      roomVersion: this.#state.version,
      message: "Meeting sources loaded.",
    };
  }

  async createMeetingSource(
    roomId: string,
    input: CreateMeetingSourceInput,
  ): Promise<ActionResult<MeetingSource>> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const parsed = createMeetingSourceInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        "Meeting source input is invalid.",
        this.#state.version,
      );
    }
    if (this.#state.phase !== "input") {
      return fail(
        "WRONG_PHASE",
        "Meeting sources can only be added while the room is gathering input.",
        this.#state.version,
      );
    }

    const actor = this.#self();
    if (!actor) {
      return fail(
        "NOT_AUTHORIZED",
        "Only an active admitted participant can add meeting sources.",
        this.#state.version,
      );
    }

    const pending = parsed.data.expectsExtraction === true && parsed.data.chunks.length === 0;
    if (!pending && parsed.data.chunks.length === 0) {
      return fail(
        "VALIDATION_ERROR",
        "A ready source needs at least one text chunk.",
        this.#state.version,
      );
    }

    const sourceId = `source-${this.#sourceSeq++}`;
    const createdAt = this.#tick();
    const source: MeetingSource = {
      id: sourceId,
      roomId,
      uploadedByParticipantId: actor.id,
      visibility: parsed.data.visibility,
      title: parsed.data.title,
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      byteSize: parsed.data.byteSize,
      sha256: parsed.data.sha256,
      status: pending ? "processing" : "ready",
      summary: parsed.data.summary,
      errorMessage: null,
      createdAt,
      processedAt: pending ? null : createdAt,
      removedAt: null,
    };
    const chunks = parsed.data.chunks.map((text, index) => ({
      id: `${sourceId}-chunk-${index}`,
      sourceId,
      chunkIndex: index,
      text,
      tokenEstimate: Math.ceil(text.length / 4),
    }));

    const previousRoomVersion = this.#state.version;
    const draft = this.#snapshot();
    draft.sources.push(source);
    draft.version = previousRoomVersion + 1;
    draft.activity.push({
      id: `event-${this.#eventSeq++}`,
      actorType: "participant",
      actorId: actor.id,
      origin: "manual_ui",
      action: "source.uploaded",
      entityType: "source",
      entityId: source.id,
      sanitizedInput: {
        title: source.title,
        filename: source.filename,
        mimeType: source.mimeType,
        byteSize: source.byteSize,
        sha256: source.sha256,
        visibility: source.visibility,
        chunkCount: chunks.length,
      },
      result: { ok: true },
      previousRoomVersion,
      resultingRoomVersion: draft.version,
      confirmationRequired: false,
      createdAt,
    });
    this.#state = draft;
    this.#sourceChunks.set(sourceId, chunks);
    this.#emit();

    return {
      ok: true,
      data: structuredClone(source),
      roomVersion: draft.version,
      message: "Meeting source added.",
    };
  }

  async readMeetingSourceContent(
    roomId: string,
    input: ReadMeetingSourceContentInput,
  ): Promise<ActionResult<MeetingSourceContent>> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const parsed = readMeetingSourceContentInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        "Meeting source read input is invalid.",
        this.#state.version,
      );
    }

    const self = this.#self();
    if (!self) {
      return fail(
        "NOT_AUTHORIZED",
        "Only an active admitted participant can read meeting sources.",
        this.#state.version,
      );
    }

    const source = this.#visibleSourcesFor(self).find(
      (entry) => entry.id === parsed.data.sourceId,
    );
    if (!source) {
      return fail(
        "NOT_AUTHORIZED",
        "That meeting source is not available in this session.",
        this.#state.version,
      );
    }

    const allChunks = this.#sourceChunks.get(source.id) ?? [];
    const start = parsed.data.cursor === null ? 0 : Number(parsed.data.cursor);
    const safeStart = Number.isSafeInteger(start) && start >= 0 ? start : 0;
    const chunks = allChunks.slice(safeStart, safeStart + parsed.data.maxChunks);
    const nextOffset = safeStart + chunks.length;

    return {
      ok: true,
      data: {
        sourceId: source.id,
        chunks: structuredClone(chunks),
        nextCursor: nextOffset < allChunks.length ? String(nextOffset) : null,
      },
      roomVersion: this.#state.version,
      message: "Meeting source content loaded.",
    };
  }

  async searchMeetingSources(
    roomId: string,
    input: SearchMeetingSourcesInput,
  ): Promise<ActionResult<MeetingSourceSearchResults>> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const parsed = searchMeetingSourcesInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        "Meeting source search input is invalid.",
        this.#state.version,
      );
    }
    const self = this.#self();
    if (!self) {
      return fail(
        "NOT_AUTHORIZED",
        "Only an active admitted participant can search meeting sources.",
        this.#state.version,
      );
    }

    const query = parsed.data.query.toLowerCase();
    const sourceFilter = new Set(parsed.data.sourceIds);
    const visibleSources = this.#visibleSourcesFor(self).filter(
      (source) => source.status === "ready" && (sourceFilter.size === 0 || sourceFilter.has(source.id)),
    );
    const sourceTitles = new Map(visibleSources.map((source) => [source.id, source.title]));
    const results = visibleSources.flatMap((source) =>
      (this.#sourceChunks.get(source.id) ?? [])
        .filter((chunk) => chunk.text.toLowerCase().includes(query))
        .map((chunk) => ({
          sourceId: source.id,
          sourceTitle: sourceTitles.get(source.id) ?? source.title,
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          excerpt: chunk.text.slice(0, 320),
        })),
    ).slice(0, parsed.data.limit);

    return {
      ok: true,
      data: { query: parsed.data.query, results },
      roomVersion: this.#state.version,
      message: "Meeting sources searched.",
    };
  }

  async shareMeetingSource(roomId: string, sourceId: string): Promise<ActionResult<MeetingSource>> {
    const actor = this.#self();
    const source = this.#state.sources.find((entry) => entry.id === sourceId && entry.status !== "removed");
    const guard = this.#canManageSource(roomId, actor, source);
    if (guard) return guard;
    if (!actor || !source) throw new Error("Source guard failed.");

    if (source.visibility === "shared_room") {
      return {
        ok: true,
        data: structuredClone(source),
        roomVersion: this.#state.version,
        message: "Meeting source already shared.",
      };
    }

    const result = this.#commit({
      apply: (draft) => {
        const target = draft.sources.find((entry) => entry.id === source.id);
        if (target) target.visibility = "shared_room";
      },
      actor,
      origin: "manual_ui",
      action: "source.shared",
      entityType: "source",
      entityId: source.id,
      sanitizedInput: { sourceId: source.id, visibility: "shared_room" },
      message: "Meeting source shared.",
    });
    const shared = this.#state.sources.find((entry) => entry.id === source.id);
    if (!result.ok) return result;
    if (!shared) {
      return fail("VALIDATION_ERROR", "Meeting source not found.", this.#state.version);
    }
    return {
      ok: true,
      data: structuredClone(shared),
      roomVersion: result.roomVersion,
      message: result.message,
    };
  }

  /**
   * Mock stand-in for the API client's retry helper: re-extracts text from a
   * re-selected file and finishes (or fails) the same source row.
   */
  async retryMeetingSource(
    roomId: string,
    sourceId: string,
    file: File,
  ): Promise<ActionResult<MeetingSource>> {
    const text = (await file.text()).replace(/\r\n/g, "\n").trim();
    if (!text) {
      return this.markMeetingSourceFailed(roomId, {
        sourceId,
        errorMessage: "The file contained no readable text.",
      });
    }
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += 10_000) {
      chunks.push(text.slice(index, index + 10_000));
    }
    return this.markMeetingSourceProcessed(roomId, {
      sourceId,
      chunks,
      summary: text.length > 280 ? `${text.slice(0, 277)}...` : text,
    });
  }

  async markMeetingSourceProcessed(
    roomId: string,
    input: MarkMeetingSourceProcessedInput,
  ): Promise<ActionResult<MeetingSource>> {
    const parsed = markMeetingSourceProcessedInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Meeting source processing input is invalid.", this.#state.version);
    }
    const actor = this.#self();
    const source = this.#state.sources.find(
      (entry) => entry.id === parsed.data.sourceId && entry.status !== "removed",
    );
    const guard = this.#canManageSource(roomId, actor, source);
    if (guard) return guard;
    if (!actor || !source) throw new Error("Source guard failed.");
    if (source.status !== "processing" && source.status !== "failed") {
      return fail("VALIDATION_ERROR", "Only a processing or failed source can be marked processed.", this.#state.version);
    }

    const createdAt = this.#tick();
    const chunks = parsed.data.chunks.map((text, index) => ({
      id: `${source.id}-chunk-${index}`,
      sourceId: source.id,
      chunkIndex: index,
      text,
      tokenEstimate: Math.ceil(text.length / 4),
    }));
    const result = this.#commit({
      apply: (draft) => {
        const target = draft.sources.find((entry) => entry.id === source.id);
        if (target) {
          target.status = "ready";
          target.processedAt = createdAt;
          target.errorMessage = null;
          if (parsed.data.summary !== null) target.summary = parsed.data.summary;
        }
      },
      actor,
      origin: "manual_ui",
      action: "source.processed",
      entityType: "source",
      entityId: source.id,
      sanitizedInput: { sourceId: source.id, chunkCount: chunks.length },
      createdAt,
      message: "Meeting source processed.",
    });
    if (!result.ok) return result;
    this.#sourceChunks.set(source.id, chunks);
    const ready = this.#state.sources.find((entry) => entry.id === source.id);
    if (!ready) return fail("VALIDATION_ERROR", "Meeting source not found.", this.#state.version);
    return { ok: true, data: structuredClone(ready), roomVersion: result.roomVersion, message: result.message };
  }

  async markMeetingSourceFailed(
    roomId: string,
    input: MarkMeetingSourceFailedInput,
  ): Promise<ActionResult<MeetingSource>> {
    const parsed = markMeetingSourceFailedInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Meeting source failure input is invalid.", this.#state.version);
    }
    const actor = this.#self();
    const source = this.#state.sources.find(
      (entry) => entry.id === parsed.data.sourceId && entry.status !== "removed",
    );
    const guard = this.#canManageSource(roomId, actor, source);
    if (guard) return guard;
    if (!actor || !source) throw new Error("Source guard failed.");
    if (source.status === "ready") {
      return fail("VALIDATION_ERROR", "A ready source cannot be marked failed.", this.#state.version);
    }

    const createdAt = this.#tick();
    const result = this.#commit({
      apply: (draft) => {
        const target = draft.sources.find((entry) => entry.id === source.id);
        if (target) {
          target.status = "failed";
          target.errorMessage = parsed.data.errorMessage;
          target.processedAt = createdAt;
        }
      },
      actor,
      origin: "manual_ui",
      action: "source.processing_failed",
      entityType: "source",
      entityId: source.id,
      sanitizedInput: { sourceId: source.id, errorMessage: parsed.data.errorMessage },
      createdAt,
      message: "Meeting source marked failed.",
    });
    if (!result.ok) return result;
    const failed = this.#state.sources.find((entry) => entry.id === source.id);
    if (!failed) return fail("VALIDATION_ERROR", "Meeting source not found.", this.#state.version);
    return { ok: true, data: structuredClone(failed), roomVersion: result.roomVersion, message: result.message };
  }

  async removeMeetingSource(roomId: string, sourceId: string): Promise<ActionResult> {
    const actor = this.#self();
    const source = this.#state.sources.find((entry) => entry.id === sourceId && entry.status !== "removed");
    const guard = this.#canManageSource(roomId, actor, source);
    if (guard) return guard;
    if (!actor || !source) throw new Error("Source guard failed.");

    return this.#commit({
      apply: (draft) => {
        const target = draft.sources.find((entry) => entry.id === source.id);
        if (target) {
          target.status = "removed";
          target.removedAt = this.#tick();
        }
      },
      actor,
      origin: "manual_ui",
      action: "source.removed",
      entityType: "source",
      entityId: source.id,
      sanitizedInput: { sourceId: source.id },
      message: "Meeting source removed.",
    });
  }

  async addMyPosition(
    roomId: string,
    input: AddPositionInput,
  ): Promise<ActionResult> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    const parsed = addPositionInputSchema.safeParse(input);
    if (!parsed.success) {
      return fail(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ??
          "The position was not in a valid shape.",
        this.#state.version,
        "Add a summary, then give every constraint a category and a description.",
      );
    }

    if (this.#state.phase !== "input") {
      return fail(
        "WRONG_PHASE",
        "Positions can only be published while the room is gathering input.",
        this.#state.version,
        "Review the current phase; the room has moved past position input.",
      );
    }

    // BACKEND CONTRACT:
    // The acting participant is never taken from the caller. Production
    // derives it from the authenticated session and room membership.
    const actor = this.#self();
    if (!actor) {
      return fail(
        "NOT_AUTHORIZED",
        "You are not seated in this room.",
        this.#state.version,
        "Claim a seat before publishing a position.",
      );
    }

    const positionId = `position-${this.#positionSeq++}`;
    const createdAt = this.#tick();
    const position: Position = {
      id: positionId,
      participantId: actor.id,
      summary: parsed.data.summary,
      category: parsed.data.category,
      priority: parsed.data.priority,
      referencedSourceIds: this.#knownSourceIds(parsed.data.referencedSourceIds),
      createdAt,
    };
    // Constraints are created with the position so their IDs are stable
    // enough for later objections to reference.
    const constraints: Constraint[] = parsed.data.constraints.map(
      (constraint) => ({
        id: `constraint-${this.#constraintSeq++}`,
        participantId: actor.id,
        category: constraint.category,
        text: constraint.text,
        priority: constraint.priority,
        referencedSourceIds: this.#knownSourceIds(constraint.referencedSourceIds),
        createdAt,
      }),
    );

    return this.#commit({
      apply: (draft) => {
        draft.positions.push(position);
        draft.constraints.push(...constraints);
      },
      actor,
      origin: "manual_ui",
      action: "position.added",
      entityType: "position",
      entityId: positionId,
      sanitizedInput: { constraintCount: constraints.length },
      createdAt,
      message:
        constraints.length === 0
          ? "Your position was published to the room."
          : `Your position and ${constraints.length} constraint${
              constraints.length === 1 ? "" : "s"
            } were published to the room.`,
    });
  }

  // Later milestones fill these in. The parameter lists stay narrower than
  // the interface on purpose: nothing here inspects an input it cannot honour.
  async submitProposal(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(roomId, "proposals", "Submitting a proposal");
  }

  async raiseObjection(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(
      roomId,
      "deliberation",
      "Raising an objection",
    );
  }

  async resolveObjection(
    roomId: string,
    input: ResolveObjectionInput,
  ): Promise<ActionResult> {
    void input;
    return this.#notInThisMilestone(
      roomId,
      "deliberation",
      "Resolving an objection",
    );
  }

  async proposeTradeoff(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(
      roomId,
      "deliberation",
      "Proposing a trade-off",
    );
  }

  async expressMyAlignment(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(roomId, "voting", "Sharing alignment");
  }

  async previewFinalDecision(
    roomId: string,
  ): Promise<ActionResult<FinalDecisionPreview>> {
    return this.#notInThisMilestone(
      roomId,
      "approval",
      "Previewing the final decision",
    );
  }

  async approveFinalDecision(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(roomId, "approval", "Approving");
  }

  async getDecisionRecord(
    roomId: string,
  ): Promise<ActionResult<DecisionRecord>> {
    return this.#notInThisMilestone(
      roomId,
      "finalized",
      "Reading the decision record",
    );
  }

  async startDemoScenario(
    roomId: string,
    input: StartDemoScenarioInput,
  ): Promise<ActionResult> {
    void input;
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    return fail(
      "VALIDATION_ERROR",
      "Starting a demo scenario is not implemented in the mock client.",
      this.#state.version,
      "Use ApiRoomClient for backend-backed demo scenario orchestration.",
    );
  }

  async advanceDemoPhase(
    roomId: string,
    phase: RoomPhase,
  ): Promise<ActionResult> {
    void phase;

    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    return fail(
      "VALIDATION_ERROR",
      "Advancing demo phases is not implemented in the mock client.",
      this.#state.version,
      "Use ApiRoomClient for backend-backed demo phase progression.",
    );
  }

  async markMyInputReady(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(roomId, "input", "Marking input ready");
  }

  async advanceRoomPhase(
    roomId: string,
    phase: RoomPhase,
  ): Promise<ActionResult> {
    void phase;

    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    return fail(
      "VALIDATION_ERROR",
      "Advancing the production room phase is not implemented in the mock client.",
      this.#state.version,
      "Use ApiRoomClient for backend-backed production phase progression.",
    );
  }

  listJoinRequests(roomId: string): Promise<ActionResult<JoinRequest[]>> {
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Listing join requests"));
  }

  admitJoinRequest(roomId: string, input: AdmitJoinRequestInput): Promise<ActionResult<JoinRequest>> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Admitting a join request"));
  }

  rejectJoinRequest(roomId: string, input: ManageJoinRequestInput): Promise<ActionResult<JoinRequest>> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Rejecting a join request"));
  }

  lockMeeting(roomId: string): Promise<ActionResult> {
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Locking the meeting"));
  }

  unlockMeeting(roomId: string): Promise<ActionResult> {
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Unlocking the meeting"));
  }

  removeParticipant(roomId: string, input: RemoveParticipantInput): Promise<ActionResult> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Removing a participant"));
  }

  transferOwnership(roomId: string, input: TransferOwnershipInput): Promise<ActionResult> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Transferring ownership"));
  }

  setDecisionPolicy(roomId: string, input: SetDecisionPolicyInput): Promise<ActionResult> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Changing the decision policy"));
  }

  setParticipantDecisionRole(
    roomId: string,
    input: SetParticipantDecisionRoleInput,
  ): Promise<ActionResult> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Changing decision authority"));
  }

  configureParticipant(
    roomId: string,
    input: ConfigureParticipantInput,
  ): Promise<ActionResult> {
    void input;
    return Promise.resolve(this.#notInThisMilestone(roomId, "input", "Configuring a participant"));
  }

  #snapshot(): RoomState {
    return structuredClone(this.#state);
  }

  #self(): Participant | null {
    const selfId = this.#state.selfParticipantId;
    if (!selfId) return null;
    return (
      this.#state.participants.find(
        (participant) => participant.id === selfId,
      ) ?? null
    );
  }

  /**
   * Narrows caller-supplied source citations to sources that actually exist in
   * this room and are not removed. Production rejects an unknown id outright;
   * the mock only needs to keep the stored provenance honest.
   */
  #knownSourceIds(ids: readonly string[] | undefined): string[] {
    if (!ids || ids.length === 0) return [];
    const known = new Set(
      this.#state.sources
        .filter((source) => source.status !== "removed")
        .map((source) => source.id),
    );
    return [...new Set(ids)].filter((id) => known.has(id));
  }

  #visibleSourcesFor(self: Participant): MeetingSource[] {
    return structuredClone(
      this.#state.sources.filter(
        (source) =>
          source.status !== "removed" &&
          (source.visibility === "shared_room" ||
            source.uploadedByParticipantId === self.id),
      ),
    );
  }

  #canManageSource(
    roomId: string,
    actor: Participant | null,
    source: MeetingSource | undefined,
  ): ActionResult<never> | null {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;
    if (this.#state.phase === "finalized") {
      return fail("ALREADY_FINALIZED", "The finalized decision is immutable.", this.#state.version);
    }
    if (!actor) {
      return fail(
        "NOT_AUTHORIZED",
        "Only an active admitted participant can manage meeting sources.",
        this.#state.version,
      );
    }
    if (!source) {
      return fail("VALIDATION_ERROR", "Meeting source not found.", this.#state.version);
    }
    if (
      source.uploadedByParticipantId !== actor.id &&
      this.#state.ownerParticipantId !== actor.id
    ) {
      return fail(
        "NOT_AUTHORIZED",
        "Only the source uploader or room owner can manage this source.",
        this.#state.version,
      );
    }
    return null;
  }

  #requireRoom(roomId: string): ActionResult<never> | null {
    if (roomId === this.#state.id) return null;
    return fail(
      "VALIDATION_ERROR",
      `Unknown room: ${roomId}`,
      this.#state.version,
      "Open a room that exists and try again.",
    );
  }

  /** Deterministic monotonic clock so repeated runs produce identical data. */
  #tick(): string {
    this.#clockMs += CLOCK_STEP_MS;
    return new Date(this.#clockMs).toISOString();
  }

  #commit(options: {
    apply: (draft: RoomState) => void;
    actor: Participant;
    origin: ActivityEvent["origin"];
    action: string;
    entityType: string | null;
    entityId: string | null;
    sanitizedInput: JsonValue;
    message: string;
    createdAt?: string;
  }): ActionResult {
    const previousRoomVersion = this.#state.version;
    const draft = this.#snapshot();

    options.apply(draft);
    draft.version = previousRoomVersion + 1;
    draft.activity.push({
      id: `event-${this.#eventSeq++}`,
      actorType: "participant",
      actorId: options.actor.id,
      origin: options.origin,
      action: options.action,
      entityType: options.entityType,
      entityId: options.entityId,
      sanitizedInput: options.sanitizedInput,
      result: { ok: true },
      previousRoomVersion,
      resultingRoomVersion: draft.version,
      confirmationRequired: false,
      createdAt: options.createdAt ?? this.#tick(),
    });

    this.#state = draft;
    this.#emit();

    return {
      ok: true,
      data: null,
      roomVersion: draft.version,
      message: options.message,
    };
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#snapshot());
  }

  /**
   * Actions the first frontend milestone does not implement yet. While the
   * room sits in an earlier phase the honest answer is `WRONG_PHASE`, which is
   * exactly what the production adapter will return.
   */
  #notInThisMilestone(
    roomId: string,
    requiredPhase: RoomState["phase"],
    label: string,
  ): ActionResult<never> {
    const roomError = this.#requireRoom(roomId);
    if (roomError) return roomError;

    if (this.#state.phase !== requiredPhase) {
      return fail(
        "WRONG_PHASE",
        `${label} is not available while the room is in the ${this.#state.phase} phase.`,
        this.#state.version,
        `This action opens in the ${requiredPhase} phase.`,
      );
    }

    return fail(
      "VALIDATION_ERROR",
      `${label} is not implemented in the current mock milestone.`,
      this.#state.version,
      "This flow arrives in a later frontend milestone.",
    );
  }
}
