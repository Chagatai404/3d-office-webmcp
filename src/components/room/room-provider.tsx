"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  ActionResult,
  AddPositionInput,
  ClaimSeatInput,
  DecisionRecord,
  ExpressAlignmentInput,
  FinalDecisionPreview,
  JoinRequest,
  ManageJoinRequestInput,
  Participant,
  ProposeTradeoffInput,
  RaiseObjectionInput,
  RemoveParticipantInput,
  ResolveObjectionInput,
  RoomPhase,
  RoomState,
  SetDecisionPolicyInput,
  SetParticipantDecisionRoleInput,
  StartDemoScenarioInput,
  SubmitProposalInput,
  TransferOwnershipInput,
} from "@/contracts/room";

import { getRoomClient } from "@/room-client/room-client";
import { useRoomWebMcpTools } from "@/webmcp/register-tools";

import {
  createRoomVisualizationState,
  type RoomVisualizationState,
} from "@/visualization/room-view-model";

/**
 * The single frontend owner of the latest canonical room snapshot.
 *
 * The server remains authoritative.
 *
 * All mutations go through RoomClient, and the 2D/3D layers consume only
 * canonical RoomState / RoomVisualizationState.
 */
export interface RoomActions {
  claimSeat(input: ClaimSeatInput): Promise<ActionResult>;

  addMyPosition(
    input: AddPositionInput,
  ): Promise<ActionResult>;

  submitProposal(
    input: SubmitProposalInput,
  ): Promise<ActionResult>;

  raiseObjection(
    input: RaiseObjectionInput,
  ): Promise<ActionResult>;

  resolveObjection(
    input: ResolveObjectionInput,
  ): Promise<ActionResult>;

  proposeTradeoff(
    input: ProposeTradeoffInput,
  ): Promise<ActionResult>;

  expressMyAlignment(
    input: ExpressAlignmentInput,
  ): Promise<ActionResult>;

  previewFinalDecision(): Promise<
    ActionResult<FinalDecisionPreview>
  >;

  approveFinalDecision(input: {
    decisionHash: string;
  }): Promise<ActionResult>;

  getDecisionRecord(): Promise<
    ActionResult<DecisionRecord>
  >;

  /** Reset/reseed the single shared demo room through the guarded demo API. */
  startDemoScenario(input: StartDemoScenarioInput): Promise<ActionResult>;

  /** Demo-only phase transition used by the isolated browser integration harness. */
  advanceDemoPhase(phase: RoomPhase): Promise<ActionResult>;

  /** Claimed human marks their own published input ready. Input phase only. */
  markMyInputReady(): Promise<ActionResult>;

  /** Owner-only production phase advance. Kept separate from `advanceDemoPhase`. */
  advanceRoomPhase(phase: RoomPhase): Promise<ActionResult>;

  listJoinRequests(): Promise<ActionResult<JoinRequest[]>>;
  admitJoinRequest(input: ManageJoinRequestInput): Promise<ActionResult<JoinRequest>>;
  rejectJoinRequest(input: ManageJoinRequestInput): Promise<ActionResult<JoinRequest>>;

  /** Owner-only. Existing participants keep normal access; new join requests are refused. */
  lockMeeting(): Promise<ActionResult>;

  /** Owner-only. Allows new join requests again. */
  unlockMeeting(): Promise<ActionResult>;

  /** Owner-only. Marks an active human participant removed; history is preserved. */
  removeParticipant(input: RemoveParticipantInput): Promise<ActionResult>;

  /** Owner-only. Atomically moves meeting authority to another active human participant. */
  transferOwnership(input: TransferOwnershipInput): Promise<ActionResult>;

  /** Owner-only. Rejected once an exact decision candidate is frozen. */
  setDecisionPolicy(input: SetDecisionPolicyInput): Promise<ActionResult>;

  /** Owner-only. Rejected once an exact decision candidate is frozen. */
  setParticipantDecisionRole(input: SetParticipantDecisionRoleInput): Promise<ActionResult>;
}

export interface RoomContextValue {
  room: RoomState;

  /**
   * Derived exclusively from canonical RoomState.
   * The 3D layer must not own backend state.
   */
  visualization: RoomVisualizationState;

  self: Participant | null;

  actions: RoomActions;
}

const RoomContext =
  createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);

  if (!value) {
    throw new Error(
      "useRoom must be used inside a RoomProvider.",
    );
  }

  return value;
}

export function RoomProvider({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  /**
   * getRoomClient() is the frontend integration seam.
   *
   * It now returns ApiRoomClient instead of MockRoomClient,
   * without changing anything below this provider.
   */
  const client = useMemo(
    () => getRoomClient(),
    [],
  );

  const [room, setRoom] =
    useState<RoomState | null>(null);

  const [loadError, setLoadError] =
    useState<string | null>(null);

  const [reloadAttempt, setReloadAttempt] =
    useState(0);

  /**
   * Register browser-agent tools against the latest canonical room snapshot.
   *
   * When room.phase changes, the WebMCP hook unregisters/registers the
   * appropriate phase-specific tool set.
   */
  useRoomWebMcpTools(roomId, room);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    client
      .getRoom(roomId)
      .then((next) => {
        if (!active) return;

        setRoom(next);
        setLoadError(null);
        unsubscribe = client.subscribe(
          roomId,
          (updatedRoom) => {
            if (!active) return;

            setRoom(updatedRoom);
            setLoadError(null);
          },
          () => {
            if (!active) return;

            setRoom(null);
            setLoadError("The room could not be loaded.");
          },
        );
      })
      .catch((error: unknown) => {
        if (!active) return;

        setLoadError(
          error instanceof Error
            ? error.message
            : "The room could not be loaded.",
        );
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client, reloadAttempt, roomId]);

  const actions = useMemo<RoomActions>(
    () => ({
      claimSeat: (input) =>
        client.claimSeat(roomId, input),

      addMyPosition: (input) =>
        client.addMyPosition(roomId, input),

      submitProposal: (input) =>
        client.submitProposal(roomId, input),

      raiseObjection: (input) =>
        client.raiseObjection(roomId, input),

      resolveObjection: (input) =>
        client.resolveObjection(roomId, input),

      proposeTradeoff: (input) =>
        client.proposeTradeoff(roomId, input),

      expressMyAlignment: (input) =>
        client.expressMyAlignment(roomId, input),

      previewFinalDecision: () =>
        client.previewFinalDecision(roomId),

      approveFinalDecision: (input) =>
        client.approveFinalDecision(
          roomId,
          input,
        ),

      getDecisionRecord: () =>
        client.getDecisionRecord(roomId),

      startDemoScenario: (input) =>
        client.startDemoScenario(roomId, input),

      advanceDemoPhase: (phase) =>
        client.advanceDemoPhase(roomId, phase),

      markMyInputReady: () =>
        client.markMyInputReady(roomId),

      advanceRoomPhase: (phase) =>
        client.advanceRoomPhase(roomId, phase),

      listJoinRequests: () => client.listJoinRequests(roomId),
      admitJoinRequest: (input) => client.admitJoinRequest(roomId, input),
      rejectJoinRequest: (input) => client.rejectJoinRequest(roomId, input),

      lockMeeting: () => client.lockMeeting(roomId),
      unlockMeeting: () => client.unlockMeeting(roomId),
      removeParticipant: (input) => client.removeParticipant(roomId, input),
      transferOwnership: (input) => client.transferOwnership(roomId, input),
      setDecisionPolicy: (input) => client.setDecisionPolicy(roomId, input),
      setParticipantDecisionRole: (input) => client.setParticipantDecisionRole(roomId, input),
    }),
    [client, roomId],
  );

  /**
   * `/room/demo` bootstrap: a first-time judge should not have to know a
   * room ID/passcode or click anything to become the Founder/Product Lead.
   * The demo seed (`supabase/seed.sql`, and every `start_demo_scenario`
   * reset) leaves the fixed `demo-product` seat unclaimed
   * (`kind: "human"`, `user_id: null`); this reuses the existing, ordinary
   * `claimSeat` action -- the same one a normal room's owner-seat claim
   * would use -- rather than adding a new privileged endpoint. If the seat
   * is already claimed by a different session, `claim_participant_seat`
   * refuses with `NOT_AUTHORIZED` and this session simply stays a read-only
   * spectator of the live demo (see docs/judge-demo.md's noted
   * single-instance limitation).
   *
   * Scoped to `demoMode === "solo_judge"` specifically, not any `"demo"`
   * room id: the legacy `multi_user` demo shape has four independently
   * claimable human seats (each browser choosing its own), so silently
   * auto-claiming the Founder seat for every session that merely opens the
   * room would fight that flow instead of the one seat solo_judge actually
   * has to auto-claim.
   */
  const demoBootstrapAttempted = useRef(false);
  useEffect(() => {
    if (roomId !== "demo" || !room || room.demoMode !== "solo_judge" || room.selfParticipantId !== null) return;
    if (demoBootstrapAttempted.current) return;
    demoBootstrapAttempted.current = true;
    void actions.claimSeat({ seatId: "demo-product" });
  }, [roomId, room, actions]);

  const value =
    useMemo<RoomContextValue | null>(() => {
      if (!room) {
        return null;
      }

      return {
        room,

        visualization:
          createRoomVisualizationState(room),

        self:
          room.participants.find(
            (participant) =>
              participant.id ===
              room.selfParticipantId,
          ) ?? null,

        actions,
      };
    }, [room, actions]);

  const reload = useCallback(() => {
    setRoom(null);
    setLoadError(null);
    setReloadAttempt((attempt) => attempt + 1);
  }, []);

  if (loadError) {
    return (
      <div
        className="room-status"
        role="alert"
      >
        <h1>
          This room could not be opened
        </h1>

        <p>{loadError}</p>

        <button
          className="button"
          type="button"
          onClick={reload}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!value) {
    return (
      <div
        className="room-status"
        role="status"
      >
        <p>
          Loading the decision room…
        </p>
      </div>
    );
  }

  return (
    <RoomContext.Provider value={value}>
      {children}
    </RoomContext.Provider>
  );
}
