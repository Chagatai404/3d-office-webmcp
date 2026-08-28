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
  RoomState,
  SubmitProposalInput,
} from "@/contracts/room";
import { getRoomClient } from "@/room-client/room-client";
import {
  createRoomVisualizationState,
  type RoomVisualizationState,
} from "@/visualization/room-view-model";

/**
 * The single frontend owner of the latest room snapshot.
 *
 * BACKEND CONTRACT:
 * The server stays authoritative. This provider holds a cached snapshot and
 * routes every mutation through `RoomClient`, so swapping `MockRoomClient` for
 * `ApiRoomClient` changes nothing below this component.
 */

/** Room actions, pre-bound to the room this provider owns. */
export interface RoomActions {
  claimSeat(input: ClaimSeatInput): Promise<ActionResult>;
  addMyPosition(input: AddPositionInput): Promise<ActionResult>;
  submitProposal(input: SubmitProposalInput): Promise<ActionResult>;
  raiseObjection(input: RaiseObjectionInput): Promise<ActionResult>;
  proposeTradeoff(input: ProposeTradeoffInput): Promise<ActionResult>;
  castMyVote(input: CastVoteInput): Promise<ActionResult>;
  previewFinalDecision(): Promise<ActionResult<FinalDecisionPreview>>;
  approveFinalDecision(input: {
    decisionHash: string;
  }): Promise<ActionResult>;
  getDecisionRecord(): Promise<ActionResult<DecisionRecord>>;
}

export interface RoomContextValue {
  room: RoomState;
  /** Derived once per snapshot and handed to the 3D layer unchanged. */
  visualization: RoomVisualizationState;
  self: Participant | null;
  actions: RoomActions;
}

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = useContext(RoomContext);
  if (!value) {
    throw new Error("useRoom must be used inside a RoomProvider.");
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
  const client = useMemo(() => getRoomClient(), []);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Realtime first, so no snapshot emitted during the initial load is lost.
    const unsubscribe = client.subscribe(roomId, (next) => {
      if (active) setRoom(next);
    });

    client
      .getRoom(roomId)
      .then((next) => {
        if (active) setRoom((current) => current ?? next);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error ? error.message : "The room could not be loaded.",
        );
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, roomId]);

  const actions = useMemo<RoomActions>(
    () => ({
      claimSeat: (input) => client.claimSeat(roomId, input),
      addMyPosition: (input) => client.addMyPosition(roomId, input),
      submitProposal: (input) => client.submitProposal(roomId, input),
      raiseObjection: (input) => client.raiseObjection(roomId, input),
      proposeTradeoff: (input) => client.proposeTradeoff(roomId, input),
      castMyVote: (input) => client.castMyVote(roomId, input),
      previewFinalDecision: () => client.previewFinalDecision(roomId),
      approveFinalDecision: (input) =>
        client.approveFinalDecision(roomId, input),
      getDecisionRecord: () => client.getDecisionRecord(roomId),
    }),
    [client, roomId],
  );

  const value = useMemo<RoomContextValue | null>(() => {
    if (!room) return null;
    return {
      room,
      visualization: createRoomVisualizationState(room),
      self:
        room.participants.find(
          (participant) => participant.id === room.selfParticipantId,
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
          error instanceof Error ? error.message : "The room could not be loaded.",
        );
      });
  }, [client, roomId]);

  if (loadError) {
    return (
      <div className="room-status" role="alert">
        <h1>This room could not be opened</h1>
        <p>{loadError}</p>
        <button className="button" type="button" onClick={reload}>
          Try again
        </button>
      </div>
    );
  }

  if (!value) {
    return (
      <div className="room-status" role="status">
        <p>Loading the decision room…</p>
      </div>
    );
  }

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
