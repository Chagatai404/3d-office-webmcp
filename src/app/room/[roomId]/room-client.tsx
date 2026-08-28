"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiRoomClient } from "@/clients/api-room-client";
import type { ActionResult, RoomState } from "@/contracts/room";
import { useRoomWebMcpTools } from "@/webmcp/register-tools";

export function RoomClientView({ roomId }: { roomId: string }) {
  const client = useMemo(() => new ApiRoomClient(), []);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState("Starting anonymous session…");
  const [confirmedDecisionHash, setConfirmedDecisionHash] = useState<string | null>(null);

  useRoomWebMcpTools(roomId, room);

  useEffect(() => client.subscribe(roomId, (state) => {
    setRoom(state);
    setStatus("Connected");
  }), [client, roomId]);

  const decisionHash = room?.finalDecisionPreview?.decisionHash ?? null;

  async function run(action: Promise<ActionResult>) {
    setStatus("Saving…");
    try {
      const result = await action;
      setStatus(result.ok ? result.message : result.error.message);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Action failed.");
    }
  }

  if (!room) {
    return <main className="shell"><p data-testid="connection-status">{status}</p></main>;
  }

  const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
  const nextPhase = room.phase === "input"
    ? "proposals"
    : room.phase === "proposals"
      ? "deliberation"
      : room.phase === "deliberation"
        ? "voting"
        : room.phase === "voting"
          ? "approval"
          : null;

  return (
    <main className="shell room-shell">
      <p className="eyebrow">Room · <span data-testid="room-phase">{room.phase}</span></p>
      <h1>{room.title}</h1>
      <p className="lede">{room.brief}</p>
      <p className="note" data-testid="connection-status">{status}</p>

      <section className="panel" aria-label="Room status">
        <div><p className="label">Version</p><p className="metric" data-testid="room-version">{room.version}</p></div>
        <div><p className="label">Participants</p><p className="metric">{room.participants.length}</p></div>
        <div><p className="label">You</p><p className="metric small">{self?.role ?? "No seat"}</p></div>
      </section>

      <section className="workspace-section">
        <h2>Participant seats</h2>
        <div className="cards">
          {room.participants.map((participant) => (
            <article className="card" key={participant.id}>
              <strong>{participant.role}</strong><span>{participant.name}</span>
              <span>{participant.id === room.selfParticipantId ? "Your seat" : participant.isClaimed ? "Claimed" : "Available"}</span>
              {!self && !participant.isClaimed && participant.kind === "human" ? (
                <button data-testid={`claim-${participant.id}`} onClick={() => void run(client.claimSeat(roomId, { seatId: participant.id }))}>Claim seat</button>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      {self && room.phase === "input" ? (
        <form className="workspace-section form" data-testid="position-form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(client.addMyPosition(roomId, {
            summary: String(data.get("summary")), category: "delivery", priority: "critical",
            constraints: [{ category: "capacity", text: String(data.get("constraint")), priority: "critical" }],
          }));
        }}>
          <h2>Add your position</h2>
          <label>Summary<input name="summary" required /></label>
          <label>Constraint<input name="constraint" required /></label>
          <button type="submit">Add position and constraint</button>
        </form>
      ) : null}

      {self && room.phase === "proposals" ? (
        <form className="workspace-section form" data-testid="proposal-form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(client.submitProposal(roomId, {
            title: String(data.get("title")), summary: String(data.get("summary")),
            rationale: String(data.get("rationale")), expectedOutcomes: ["Ship safely in two weeks"],
            referencedConstraintIds: room.constraints.map((constraint) => constraint.id), parentProposalId: null,
          }));
        }}>
          <h2>Submit a proposal</h2>
          <label>Title<input name="title" required /></label>
          <label>Summary<input name="summary" required /></label>
          <label>Rationale<input name="rationale" required /></label>
          <button type="submit">Submit proposal</button>
        </form>
      ) : null}

      {self && room.phase === "deliberation" && room.activeProposalId ? (
        <form className="workspace-section form" data-testid="objection-form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(client.raiseObjection(roomId, {
            proposalId: room.activeProposalId!, constraintId: String(data.get("constraintId")),
            reason: String(data.get("reason")), severity: "blocking",
          }));
        }}>
          <h2>Raise an objection</h2>
          <label>Related constraint<select name="constraintId">{room.constraints.map((constraint) => <option key={constraint.id} value={constraint.id}>{constraint.text}</option>)}</select></label>
          <label>Reason<input name="reason" required /></label>
          <button type="submit">Raise blocking objection</button>
        </form>
      ) : null}

      {self && room.phase === "deliberation" && room.conflicts.some((conflict) => conflict.status === "open") ? (
        <section className="workspace-section" data-testid="resolution-controls">
          <h2>Resolve objections explicitly</h2>
          {room.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => (
            <button key={conflict.id} onClick={() => void run(client.resolveObjection(roomId, {
              conflictId: conflict.id,
              resolutionNote: "Reviewed against the revised active proposal and explicitly accepted for voting.",
            }))}>
              Resolve: {conflict.reason}
            </button>
          ))}
        </section>
      ) : null}

      {self && room.phase === "voting" && room.activeProposalId ? (
        <form className="workspace-section form" data-testid="vote-form" onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void run(client.castMyVote(roomId, {
            proposalId: room.activeProposalId!,
            choice: String(data.get("choice")) as "support" | "oppose" | "abstain" | "request_changes",
            comment: String(data.get("comment")) || null,
          }));
        }}>
          <h2>Cast your vote</h2>
          <label>Choice<select name="choice">
            <option value="support">Support</option>
            <option value="oppose">Oppose</option>
            <option value="abstain">Abstain</option>
            <option value="request_changes">Request changes</option>
          </select></label>
          <label>Comment<input name="comment" /></label>
          <button type="submit">Record my vote</button>
        </form>
      ) : null}

      {self && room.phase === "approval" && room.finalDecisionPreview ? (
        <section className="workspace-section" data-testid="approval-panel">
          <h2>Review exact final decision</h2>
          <h3>{room.finalDecisionPreview.proposal.title}</h3>
          <p>{room.finalDecisionPreview.proposal.summary}</p>
          <p>{room.finalDecisionPreview.rationale}</p>
          <p><strong>Decision hash:</strong> <code data-testid="decision-hash">{room.finalDecisionPreview.decisionHash}</code></p>
          <p>A support vote is not approval. Each required human must approve this exact hash.</p>
          <p data-testid="missing-approvals">Missing approvals: {room.finalDecisionPreview.missingApprovalParticipantIds.join(", ") || "none"}</p>
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
            data-testid="confirm-approval"
            disabled={confirmedDecisionHash !== decisionHash}
            onClick={() => void run(client.approveFinalDecision(roomId, {
              decisionHash: room.finalDecisionPreview!.decisionHash,
            }))}
          >Approve my participant decision</button>
        </section>
      ) : null}

      {self && nextPhase ? (
        <button className="button secondary" data-testid="advance-phase" onClick={() => void run(client.advanceDemoPhase(roomId, nextPhase))}>
          Advance demo to {nextPhase}
        </button>
      ) : null}

      <section className="workspace-section">
        <h2>Canonical state</h2>
        <h3>Positions</h3>
        <ul data-testid="positions">{room.positions.map((position) => <li key={position.id}>{position.summary}</li>)}</ul>
        <h3>Constraints</h3>
        <ul data-testid="constraints">{room.constraints.map((constraint) => <li key={constraint.id}>{constraint.text}</li>)}</ul>
        <h3>Proposals</h3>
        <ul data-testid="proposals">{room.proposals.map((proposal) => <li key={proposal.id}>{proposal.title}: {proposal.summary} ({proposal.status})</li>)}</ul>
        <h3>Open objections</h3>
        <ul data-testid="conflicts">{room.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => <li key={conflict.id}>{conflict.severity}: {conflict.reason}</li>)}</ul>
        <h3>Trade-offs</h3>
        <ul data-testid="tradeoffs">{room.tradeoffs.map((tradeoff) => <li key={tradeoff.id}>{tradeoff.description}: {tradeoff.expectedEffect}</li>)}</ul>
        <h3>Votes</h3>
        <ul data-testid="votes">{room.votes.map((vote) => <li key={`${vote.proposalId}:${vote.participantId}`}>{vote.participantId}: {vote.choice}</li>)}</ul>
        <h3>Approvals</h3>
        <ul data-testid="approvals">{room.approvals.map((approval) => <li key={approval.participantId}>{approval.participantId}: {approval.decisionHash}</li>)}</ul>
        {room.finalizedAt ? <p data-testid="finalized-at">Finalized at {room.finalizedAt}</p> : null}
        <h3>Activity ledger</h3>
        <ul data-testid="activity">{room.activity.map((event) => <li key={event.id}>{event.action} · {event.origin} · v{event.resultingRoomVersion}</li>)}</ul>
      </section>
    </main>
  );
}
