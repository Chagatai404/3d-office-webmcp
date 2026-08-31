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
  ClaimSeatInput,
  DecisionRecord,
  ExpressAlignmentInput,
  FinalDecisionPreview,
  JoinRequest,
  ManageJoinRequestInput,
  MeetingReport,
  MeetingSource,
  MeetingSourceContent,
  MeetingSourceSearchResults,
  MeetingSourceVisibility,
  Participant,
  ProposeTradeoffInput,
  RaiseObjectionInput,
  ReadMeetingSourceContentInput,
  RemoveParticipantInput,
  ResolveObjectionInput,
  RoomPhase,
  RoomState,
  SearchMeetingSourcesInput,
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

  uploadMeetingSource(input: {
    file: File;
    title?: string;
    visibility: MeetingSourceVisibility;
  }): Promise<ActionResult<MeetingSource>>;

  listMeetingSources(): Promise<ActionResult<MeetingSource[]>>;

  readMeetingSourceContent(
    input: ReadMeetingSourceContentInput,
  ): Promise<ActionResult<MeetingSourceContent>>;

  searchMeetingSources(
    input: SearchMeetingSourcesInput,
  ): Promise<ActionResult<MeetingSourceSearchResults>>;

  shareMeetingSource(sourceId: string): Promise<ActionResult<MeetingSource>>;

  removeMeetingSource(sourceId: string): Promise<ActionResult>;

  /** Retry a failed source by re-extracting text from a re-selected file. */
  retryMeetingSource(
    sourceId: string,
    file: File,
  ): Promise<ActionResult<MeetingSource>>;

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

  getMeetingReport(): Promise<ActionResult<MeetingReport>>;

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

  /**
   * True once this session's own attempt to claim the solo-judge Founder
   * seat (via `claimDemoSeat`, from the toolbar's "Take the wheel" button)
   * has come back `NOT_AUTHORIZED` -- someone else already holds
   * "demo-product". The session stays a read-only spectator of the live
   * demo (see `docs/judge-demo.md`'s disclosed single-instance
   * limitation); this only exists so the UI can say why, instead of
   * leaving every control silently inert.
   */
  demoSeatClaimBlocked: boolean;

  /**
   * The solo-judge demo's one explicit, human-initiated path onto the
   * Founder / Product Lead seat.
   *
   * A plain page load no longer claims this seat automatically: any tab
   * that merely opened `/room/demo` -- another visitor, a duplicate tab, a
   * link-preview bot -- used to silently become the Founder and lock
   * everyone else into spectating, including this app's own devtools
   * testing sessions racing a just-reset room. A WebMCP-capable browser
   * agent still claims automatically (see `useRoomWebMcpTools`), since
   * there is no human present there to click anything; a plain human now
   * has to ask for the seat once, on purpose.
   */
  claimDemoSeat(): Promise<ActionResult>;
}

const RoomContext =
  createContext<RoomContextValue | null>(null);

interface SourceUploadClient {
  uploadMeetingSource(
    roomId: string,
    input: {
      file: File;
      title?: string;
      visibility: MeetingSourceVisibility;
    },
  ): Promise<ActionResult<MeetingSource>>;
  retryMeetingSource(
    roomId: string,
    sourceId: string,
    file: File,
  ): Promise<ActionResult<MeetingSource>>;
}

function unsupportedSourceAction<T>(roomVersion: number): ActionResult<T> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Meeting source files are not available in this client.",
      recovery: "Reload the room with the API-backed client and try again.",
    },
    roomVersion,
  };
}

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

      uploadMeetingSource: (input) => {
        const sourceClient = client as typeof client & Partial<SourceUploadClient>;
        return sourceClient.uploadMeetingSource
          ? sourceClient.uploadMeetingSource(roomId, input)
          : Promise.resolve(unsupportedSourceAction<MeetingSource>(room?.version ?? 0));
      },

      listMeetingSources: () =>
        client.listMeetingSources
          ? client.listMeetingSources(roomId)
          : Promise.resolve(unsupportedSourceAction<MeetingSource[]>(room?.version ?? 0)),

      readMeetingSourceContent: (input) =>
        client.readMeetingSourceContent
          ? client.readMeetingSourceContent(roomId, input)
          : Promise.resolve(unsupportedSourceAction<MeetingSourceContent>(room?.version ?? 0)),

      searchMeetingSources: (input) =>
        client.searchMeetingSources
          ? client.searchMeetingSources(roomId, input)
          : Promise.resolve(unsupportedSourceAction<MeetingSourceSearchResults>(room?.version ?? 0)),

      shareMeetingSource: (sourceId) =>
        client.shareMeetingSource
          ? client.shareMeetingSource(roomId, sourceId)
          : Promise.resolve(unsupportedSourceAction<MeetingSource>(room?.version ?? 0)),

      removeMeetingSource: (sourceId) =>
        client.removeMeetingSource
          ? client.removeMeetingSource(roomId, sourceId)
          : Promise.resolve(unsupportedSourceAction(room?.version ?? 0)),

      retryMeetingSource: (sourceId, file) => {
        const sourceClient = client as typeof client & Partial<SourceUploadClient>;
        return sourceClient.retryMeetingSource
          ? sourceClient.retryMeetingSource(roomId, sourceId, file)
          : Promise.resolve(unsupportedSourceAction<MeetingSource>(room?.version ?? 0));
      },

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

      getMeetingReport: () =>
        client.getMeetingReport(roomId),

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
    [client, room?.version, roomId],
  );

  /**
   * Register browser-agent tools against the latest canonical room snapshot,
   * and -- for the solo-judge demo specifically -- the one path onto its
   * unclaimed Founder seat that still happens without a click: a WebMCP
   * agent has no human present to press a button, so it claims for itself.
   * See the doc comment on `useRoomWebMcpTools` for why a plain page load no
   * longer does the same thing.
   */
  useRoomWebMcpTools(roomId, room, actions.claimSeat);

  const [demoSeatClaimBlocked, setDemoSeatClaimBlocked] = useState(false);

  /**
   * `/room/demo`'s explicit, human-initiated claim of its one Founder /
   * Product Lead seat -- see `RoomContextValue.claimDemoSeat`'s doc comment
   * for why this replaced the old silent auto-claim on page load. Reuses the
   * same ordinary `claimSeat` action a normal room's owner-seat claim would
   * use, rather than a new privileged endpoint; if the seat is already
   * claimed by a different session, `claim_participant_seat` refuses with
   * `NOT_AUTHORIZED` and this sets `demoSeatClaimBlocked` so the toolbar can
   * say why, instead of the button just silently failing.
   */
  const claimDemoSeat = useCallback(async () => {
    const result = await actions.claimSeat({ seatId: "demo-product" });
    if (!result.ok) setDemoSeatClaimBlocked(true);
    return result;
  }, [actions]);

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

        demoSeatClaimBlocked,

        claimDemoSeat,
      };
    }, [room, actions, demoSeatClaimBlocked, claimDemoSeat]);

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
