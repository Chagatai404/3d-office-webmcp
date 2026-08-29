"use client";

import { useState } from "react";
import type { ActionResult, DemoHumanRole, RoomPhase } from "@/contracts/room";
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

  const decisionHash = room.finalDecisionPreview?.decisionHash ?? null;
  const nextPhase: RoomPhase | null = room.phase === "input"
    ? "proposals"
    : room.phase === "proposals"
      ? "deliberation"
      : room.phase === "deliberation"
        ? "voting"
        : room.phase === "voting"
          ? "approval"
          : null;

  async function run(action: Promise<ActionResult>) {
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

  return (
    <main className="shell room-shell" data-testid="e2e-room-harness">
      <p data-testid="connection-status">{status === "Saving…" ? "Saving…" : "Connected"}</p>
      <p>Room · <span data-testid="room-phase">{room.phase}</span></p>
      <p>Version <span data-testid="room-version">{room.version}</span></p>

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

      <section aria-label="Participant seats">
        {room.participants.map((participant) => (
          <article key={participant.id}>
            <strong>{participant.role}</strong>
            <span>{participant.name}</span>
            <span data-testid={`participant-kind-${participant.id}`}>
              {participant.kind === "simulation" ? "Simulated Participant" : "Human Participant"}
              {participant.requiredForApproval ? " · Required approver" : ""}
            </span>
            <span>
              {participant.id === room.selfParticipantId
                ? "Your seat"
                : participant.isClaimed
                  ? "Claimed"
                  : "Available"}
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
          </article>
        ))}
      </section>

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

      {self && room.demoMode !== "solo_judge" && nextPhase ? (
        <button
          type="button"
          data-testid="advance-phase"
          onClick={() => void run(actions.advanceDemoPhase(nextPhase))}
        >
          Advance demo to {nextPhase}
        </button>
      ) : null}

      <section>
        <ul data-testid="positions">
          {room.positions.map((position) => <li key={position.id}>{position.summary}</li>)}
        </ul>
        <ul data-testid="constraints">
          {room.constraints.map((constraint) => <li key={constraint.id}>{constraint.text}</li>)}
        </ul>
        <ul data-testid="proposals">
          {room.proposals.map((proposal) => <li key={proposal.id}>{proposal.title}: {proposal.summary} ({proposal.status})</li>)}
        </ul>
        <ul data-testid="conflicts">
          {room.conflicts
            .filter((conflict) => conflict.status === "open")
            .map((conflict) => <li key={conflict.id}>{conflict.severity}: {conflict.reason}</li>)}
        </ul>
        <ul data-testid="tradeoffs">
          {room.tradeoffs.map((tradeoff) => <li key={tradeoff.id}>{tradeoff.description}: {tradeoff.expectedEffect}</li>)}
        </ul>
        <ul data-testid="votes">
          {room.votes.map((vote) => <li key={`${vote.proposalId}:${vote.participantId}`}>{vote.participantId}: {vote.choice}</li>)}
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
