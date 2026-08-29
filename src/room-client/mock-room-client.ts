import {
  addPositionInputSchema,
  claimSeatInputSchema,
  type ActionErrorCode,
  type ActionResult,
  type ActivityEvent,
  type AddPositionInput,
  type ClaimSeatInput,
  type Constraint,
  type DecisionRecord,
  type FinalDecisionPreview,
  type JsonValue,
  type Participant,
  type Position,
  type ResolveObjectionInput,
  type RoomClient,
  type RoomPhase,
  type RoomState,
  type StartDemoScenarioInput,
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
  #clockMs: number;
  #positionSeq: number;
  #constraintSeq: number;
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

  async castMyVote(roomId: string): Promise<ActionResult> {
    return this.#notInThisMilestone(roomId, "voting", "Voting");
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
