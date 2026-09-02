"use client";

import { useEffect, useState } from "react";
import type {
  ActionResult,
  DemoHumanRole,
  JoinRequest,
  MeetingSourceVisibility,
  RoomPhase,
} from "@/contracts/room";
import {
  subscribeToUiConfirmation,
  type ConfirmationRequest,
} from "@/webmcp/confirmation-bridge";
import { useRoom } from "./room-provider";

/**
 * Minimal browser-integration surface for Playwright.
 *
 * This component is never rendered in the normal product UI. It consumes the
 * same RoomProvider as DesktopShell, so E2E coverage still exercises the real
 * ApiRoomClient, anonymous auth, realtime, WebMCP registration, HTTP adapters,
 * domain operations, and Supabase state without coupling those tests to the
 * evolving 3D/desktop presentation.
 */
export function RoomE2EHarness() {
  const { room, self, actions } = useRoom();
  const [confirmedDecisionHash, setConfirmedDecisionHash] = useState<string | null>(null);
  const [status, setStatus] = useState("Connected");
  const [soloRole, setSoloRole] = useState<DemoHumanRole>("product");
  const [webMcpConfirmation, setWebMcpConfirmation] = useState<ConfirmationRequest | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceVisibility, setSourceVisibility] = useState<MeetingSourceVisibility>("shared_room");

  useEffect(
    () => subscribeToUiConfirmation((request) => setWebMcpConfirmation(request)),
    [],
  );

  const decisionHash = room.finalDecisionPreview?.decisionHash ?? null;

  /**
   * The demo room is the only room the demo-only endpoints accept, so it is
   * also the only room whose controls are offered here. A created room gets
   * the production controls instead: readiness and the owner phase route.
   */
  const isDemoRoom = room.id === "demo";
  const isOwner = self?.id === room.ownerParticipantId && self?.meetingRole === "owner";

  const [waitingRequests, setWaitingRequests] = useState<JoinRequest[]>([]);
  const [waitingBusyId, setWaitingBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOwner) return;
    let active = true;
    const refresh = async () => {
      const result = await actions.listJoinRequests();
      if (active && result.ok) setWaitingRequests(result.data);
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [actions, isOwner]);

  async function resolveWaitingRequest(request: JoinRequest, decision: "admit" | "reject") {
    setWaitingBusyId(request.id);
    const result = decision === "admit"
      ? await actions.admitJoinRequest({ joinRequestId: request.id })
      : await actions.rejectJoinRequest({ joinRequestId: request.id });
    setWaitingBusyId(null);
    if (result.ok) {
      const refreshed = await actions.listJoinRequests();
      if (refreshed.ok) setWaitingRequests(refreshed.data);
    }
  }

  const nextPhase: RoomPhase | null = room.phase === "input"
    ? "proposals"
    : room.phase === "proposals"
      ? "deliberation"
      : room.phase === "deliberation"
        ? "voting"
        : room.phase === "voting"
          ? "approval"
          : null;

  async function run<T>(action: Promise<ActionResult<T>>) {
    setStatus("Saving…");
    try {
      const result = await action;
      setStatus(result.ok ? result.message : result.error.message);
      return result;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed.");
      throw error;
    }
  }

  async function attachSource() {
    if (!sourceFile) return;
    await run(actions.uploadMeetingSource({ file: sourceFile, visibility: sourceVisibility }));
    setSourceFile(null);
  }

  async function confirmWebMcpParticipantAction() {
    if (!webMcpConfirmation || webMcpConfirmation.kind !== "participants") return;
    const result = webMcpConfirmation.action === "remove"
      ? await run(actions.removeParticipant({ participantId: webMcpConfirmation.participantId }))
      : await run(actions.transferOwnership({ participantId: webMcpConfirmation.participantId }));
    if (result.ok) setWebMcpConfirmation(null);
  }

  return (
    <main className="shell room-shell" data-testid="e2e-room-harness">
      <p data-testid="connection-status">{status === "Saving…" ? "Saving…" : "Connected"}</p>
      {/* The structured message of the last action, including a refusal. */}
      <p data-testid="last-action">{status}</p>
      <p data-testid="room-id">{room.id}</p>
      <p>Room · <span data-testid="room-phase">{room.phase}</span></p>
      <p>Version <span data-testid="room-version">{room.version}</span></p>

      {webMcpConfirmation?.kind === "participants" ? (
        <section role="alertdialog" data-testid="webmcp-participant-confirmation">
          <p>
            Confirm {webMcpConfirmation.action === "remove" ? "participant removal" : "ownership transfer"}?
          </p>
          <button type="button" onClick={() => setWebMcpConfirmation(null)}>Cancel</button>
          <button type="button" data-testid="confirm-webmcp-participant-action" onClick={() => void confirmWebMcpParticipantAction()}>
            Confirm
          </button>
        </section>
      ) : null}

      {webMcpConfirmation?.kind === "decision" ? (
        <p role="status" data-testid="webmcp-decision-confirmation">Final decision requires visible human confirmation.</p>
      ) : null}

      {isDemoRoom ? (
        <section data-testid="demo-controls">
          <p data-testid="demo-mode">Mode: {room.demoMode ?? "none"}</p>
          <label>
            Judge role
            <select
              data-testid="demo-human-role"
              value={soloRole}
              onChange={(event) => setSoloRole(event.target.value as DemoHumanRole)}
            >
              <option value="product">Product Manager</option>
              <option value="engineer">Engineer</option>
              <option value="designer">Designer</option>
              <option value="marketing">Marketing Lead</option>
            </select>
          </label>
          <button
            type="button"
            data-testid="start-solo-demo"
            onClick={() => void run(actions.startDemoScenario({
              mode: "solo_judge",
              humanRole: soloRole,
            }))}
          >
            Start solo demo
          </button>
          <button
            type="button"
            data-testid="reset-multi-user-demo"
            onClick={() => void run(actions.startDemoScenario({
              mode: "multi_user",
              humanRole: null,
            }))}
          >
            Reset multi-user demo
          </button>
        </section>
      ) : null}

      <section aria-label="Participant seats">
        {/* A removed participant's chair disappears from the live roster the
            same way it disappears from the 3D room; their historical rows
            (positions, alignments, activity) stay inspectable through the
            other testids below regardless of status. */}
        {room.participants.filter((participant) => participant.status === "active").map((participant) => (
          <article key={participant.id}>
            <strong>{participant.role}</strong>
            <span>{participant.name}</span>
            <span data-testid={`participant-kind-${participant.id}`}>
              {participant.kind === "expert"
                ? "Security Expert · Advisory"
                : participant.kind === "simulation"
                  ? "Simulated Participant"
                  : "Human Participant"}
              {` · ${participant.meetingRole} · ${participant.decisionRole}`}
            </span>
            <span data-testid={`participant-status-${participant.id}`}>
              {participant.id === room.selfParticipantId
                ? "Your seat"
                : participant.isClaimed
                  ? "Claimed"
                  : "Available"}
            </span>
            <span data-testid={`participant-ready-${participant.id}`}>
              {participant.isReady ? "Ready" : "Not ready"}
            </span>
            {!self && participant.kind === "human" && !participant.isClaimed ? (
              <button
                type="button"
                data-testid={`claim-${participant.id}`}
                onClick={() => void run(actions.claimSeat({ seatId: participant.id }))}
              >
                Claim seat
              </button>
            ) : null}
            {isOwner && participant.id !== room.ownerParticipantId && participant.kind === "human" ? (
              <>
                <button
                  type="button"
                  data-testid={`remove-${participant.id}`}
                  onClick={() => void run(actions.removeParticipant({ participantId: participant.id }))}
                >
                  Remove
                </button>
                <button
                  type="button"
                  data-testid={`transfer-owner-${participant.id}`}
                  onClick={() => void run(actions.transferOwnership({ participantId: participant.id }))}
                >
                  Make owner
                </button>
                <button
                  type="button"
                  data-testid={`make-decision-maker-${participant.id}`}
                  onClick={() => void run(actions.setParticipantDecisionRole({
                    participantId: participant.id, decisionRole: "decision_maker",
                  }))}
                >
                  Make decision maker
                </button>
                <button
                  type="button"
                  data-testid={`make-contributor-${participant.id}`}
                  onClick={() => void run(actions.setParticipantDecisionRole({
                    participantId: participant.id, decisionRole: "contributor",
                  }))}
                >
                  Make contributor
                </button>
              </>
            ) : null}
          </article>
        ))}
      </section>

      {isOwner ? (
        <section data-testid="decision-policy-controls">
          <p data-testid="decision-policy">{room.decisionPolicy}</p>
          <button
            type="button"
            data-testid="set-policy-owner-decides"
            onClick={() => void run(actions.setDecisionPolicy({ decisionPolicy: "owner_decides" }))}
          >
            Responsible owner decides
          </button>
          <button
            type="button"
            data-testid="set-policy-consensus"
            onClick={() => void run(actions.setDecisionPolicy({ decisionPolicy: "equal_authority_consensus" }))}
          >
            Equal decision-makers must agree
          </button>
        </section>
      ) : (
        <p data-testid="decision-policy">{room.decisionPolicy}</p>
      )}

      {isOwner ? (
        <section data-testid="lock-controls">
          <p data-testid="room-locked">{String(room.isLocked)}</p>
          <button
            type="button"
            data-testid="lock-meeting"
            onClick={() => void run(actions.lockMeeting())}
          >
            Lock meeting
          </button>
          <button
            type="button"
            data-testid="unlock-meeting"
            onClick={() => void run(actions.unlockMeeting())}
          >
            Unlock meeting
          </button>
        </section>
      ) : null}

      {isOwner ? (
        <section data-testid="waiting-room">
          {waitingRequests.map((request) => (
            <article key={request.id} data-testid={`join-request-${request.id}`}>
              <span>{request.displayName} · {request.role} · {request.status}</span>
              <button
                type="button"
                data-testid={`admit-${request.id}`}
                disabled={waitingBusyId === request.id}
                onClick={() => void resolveWaitingRequest(request, "admit")}
              >
                Admit
              </button>
              <button
                type="button"
                data-testid={`reject-${request.id}`}
                disabled={waitingBusyId === request.id}
                onClick={() => void resolveWaitingRequest(request, "reject")}
              >
                Reject
              </button>
            </article>
          ))}
        </section>
      ) : null}

      {self && room.phase === "deliberation" && room.activeProposalId ? (
        <form
          data-testid="objection-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(actions.raiseObjection({
              proposalId: room.activeProposalId!,
              constraintId: String(data.get("constraintId")),
              reason: String(data.get("reason")),
              severity: "blocking",
            }));
          }}
        >
          <label>
            Related constraint
            <select name="constraintId">
              {room.constraints.map((constraint) => (
                <option key={constraint.id} value={constraint.id}>
                  {constraint.text}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reason
            <input name="reason" required />
          </label>
          <button type="submit">Raise blocking objection</button>
        </form>
      ) : null}

      {self && room.demoMode !== "solo_judge" && room.phase === "deliberation" && room.conflicts.some((conflict) => conflict.status === "open") ? (
        <section data-testid="resolution-controls">
          {room.conflicts
            .filter((conflict) => conflict.status === "open")
            .map((conflict) => (
              <button
                type="button"
                key={conflict.id}
                onClick={() => void run(actions.resolveObjection({
                  conflictId: conflict.id,
                  resolutionNote: "Reviewed against the revised active proposal and explicitly accepted for voting.",
                }))}
              >
                Resolve: {conflict.reason}
              </button>
            ))}
        </section>
      ) : null}

      {self && room.phase === "approval" && room.finalDecisionPreview ? (
        <section data-testid="approval-panel">
          <h2>Review exact final decision</h2>
          <p>{room.finalDecisionPreview.proposal.title}</p>
          <p>
            <strong>Decision hash:</strong>{" "}
            <code data-testid="decision-hash">{room.finalDecisionPreview.decisionHash}</code>
          </p>
          <p data-testid="missing-approvals">
            Missing approvals: {room.finalDecisionPreview.missingApprovalParticipantIds.join(", ") || "none"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={confirmedDecisionHash === decisionHash}
              onChange={(event) => setConfirmedDecisionHash(
                event.target.checked ? decisionHash : null,
              )}
            />
            I reviewed and confirm this exact final decision.
          </label>
          <button
            type="button"
            data-testid="confirm-approval"
            disabled={confirmedDecisionHash !== decisionHash}
            onClick={() => void run(actions.approveFinalDecision({
              decisionHash: room.finalDecisionPreview!.decisionHash,
            }))}
          >
            Approve my participant decision
          </button>
        </section>
      ) : null}

      {self && isDemoRoom && room.demoMode !== "solo_judge" && nextPhase ? (
        <button
          type="button"
          data-testid="advance-phase"
          onClick={() => void run(actions.advanceDemoPhase(nextPhase))}
        >
          Advance demo to {nextPhase}
        </button>
      ) : null}

      {/*
        A created room progresses through the production route only. The button
        is offered to every seated participant on purpose: the server, not this
        harness, is what refuses a non-owner.
      */}
      {self && !isDemoRoom && room.phase === "input" ? (
        <button
          type="button"
          data-testid="mark-ready"
          onClick={() => void run(actions.markMyInputReady())}
        >
          Mark my input ready
        </button>
      ) : null}

      {self && !isDemoRoom && nextPhase ? (
        <button
          type="button"
          data-testid="advance-room-phase"
          onClick={() => void run(actions.advanceRoomPhase(nextPhase))}
        >
          Advance room to {nextPhase}
        </button>
      ) : null}

      {self && room.phase === "input" ? (
        <section data-testid="source-upload">
          <label>
            Source file
            <input
              type="file"
              data-testid="source-file"
              onChange={(event) => setSourceFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <label>
            Visibility
            <select
              data-testid="source-visibility"
              value={sourceVisibility}
              onChange={(event) => setSourceVisibility(event.target.value as MeetingSourceVisibility)}
            >
              <option value="shared_room">shared_room</option>
              <option value="private_to_participant">private_to_participant</option>
            </select>
          </label>
          <button type="button" data-testid="attach-source" onClick={() => void attachSource()}>
            Attach source
          </button>
        </section>
      ) : null}

      <section>
        <ul data-testid="positions">
          {room.positions.map((position) => <li key={position.id}>{position.summary}</li>)}
        </ul>
        <ul data-testid="constraints">
          {room.constraints.map((constraint) => <li key={constraint.id}>{constraint.text}</li>)}
        </ul>
        <ul data-testid="sources">
          {room.sources.filter((source) => source.status !== "removed").map((source) => (
            <li key={source.id}>
              {source.filename}
              <span data-testid={`source-status-${source.id}`}>{source.status}</span>
              <span data-testid={`source-visibility-${source.id}`}>{source.visibility}</span>
            </li>
          ))}
        </ul>
        <ul data-testid="proposals">
          {room.proposals.map((proposal) => <li key={proposal.id}>{proposal.title}: {proposal.summary} ({proposal.status})</li>)}
        </ul>
        <ul data-testid="proposal-lineage">
          {room.proposals.map((proposal) => (
            <li key={proposal.id}>
              {proposal.title} ← {room.proposals.find(
                (candidate) => candidate.id === proposal.parentProposalId,
              )?.title ?? "root"}
            </li>
          ))}
        </ul>
        <ul data-testid="conflicts">
          {room.conflicts
            .filter((conflict) => conflict.status === "open")
            .map((conflict) => <li key={conflict.id}>{conflict.severity}: {conflict.reason}</li>)}
        </ul>
        <ul data-testid="tradeoffs">
          {room.tradeoffs.map((tradeoff) => <li key={tradeoff.id}>{tradeoff.description}: {tradeoff.expectedEffect}</li>)}
        </ul>
        <ul data-testid="alignments">
          {room.alignments.map((alignment) => <li key={`${alignment.proposalId}:${alignment.participantId}`}>{alignment.participantId}: {alignment.choice}</li>)}
        </ul>
        <ul data-testid="approvals">
          {room.approvals.map((approval) => <li key={approval.participantId}>{approval.participantId}: {approval.decisionHash}</li>)}
        </ul>
        {room.finalizedAt ? <p data-testid="finalized-at">Finalized at {room.finalizedAt}</p> : null}
        <ul data-testid="activity">
          {room.activity.map((event) => <li key={event.id}>{event.action} · {event.origin} · v{event.resultingRoomVersion}</li>)}
        </ul>
      </section>
    </main>
  );
}
