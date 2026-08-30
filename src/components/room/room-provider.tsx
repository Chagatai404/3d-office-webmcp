"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type {
  ActionResult,
  AddPositionInput,
  CastVoteInput,
  ClaimSeatInput,
  DecisionRecord,
  FinalDecisionPreview,
  Participant,
  ProposeTradeoffInput,
  RaiseObjectionInput,
  ResolveObjectionInput,
  RoomPhase,
  RoomState,
  StartDemoScenarioInput,
  SubmitProposalInput,
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

  castMyVote(
    input: CastVoteInput,
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

  /**
   * Register browser-agent tools against the latest canonical room snapshot.
   *
   * When room.phase changes, the WebMCP hook unregisters/registers the
   * appropriate phase-specific tool set.
   */
  useRoomWebMcpTools(roomId, room);

  useEffect(() => {
    let active = true;

    /**
     * Subscribe first so a realtime update occurring during initial load
     * cannot be missed.
     */
    const unsubscribe = client.subscribe(
      roomId,
      (next) => {
        if (!active) return;

        setRoom(next);
        setLoadError(null);
      },
    );

    client
      .getRoom(roomId)
      .then((next) => {
        if (!active) return;

        /**
         * If realtime already provided a newer snapshot,
         * don't overwrite it with the initial request.
         */
        setRoom((current) => current ?? next);
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
      unsubscribe();
    };
  }, [client, roomId]);

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

      castMyVote: (input) =>
        client.castMyVote(roomId, input),

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
    }),
    [client, roomId],
  );

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
    setLoadError(null);

    client
      .getRoom(roomId)
      .then(setRoom)
      .catch((error: unknown) => {
        setLoadError(
          error instanceof Error
            ? error.message
            : "The room could not be loaded.",
        );
      });
  }, [client, roomId]);

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
