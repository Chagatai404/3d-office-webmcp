"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult, DecisionRecord } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { shortDecisionHash } from "./coordination";
import {
  ConflictList,
  DecisionList,
  ExpertAdviceList,
  participantLabel,
} from "./decision-shared";
import { ALIGNMENT_CHOICE_LABEL, formatActionName, formatTime } from "./room-labels";
import { useRoom } from "./room-provider";

/**
 * What a finalized meeting leaves behind: one report, the same for everyone.
 *
 * BACKEND CONTRACT:
 * Every word below is read out of the server's own `DecisionRecord` — the
 * immutable record fetched after finalization — plus the canonical
 * `RoomState` it belongs to. There is no frontend report model here, and
 * there must never be one: two participants comparing screens are comparing
 * one server-side artifact, down to the decision hash, not two local
 * reconstructions that happen to agree today.
 *
 * When Developer A's canonical `MeetingReport` projection lands (A8), this
 * component swaps `getDecisionRecord()` for `get_final_report`'s projection
 * and drops the small amount of lookup it does here (constraints by id,
 * resolved objections). The sections stay exactly as they are, because they
 * are already the report's sections rather than a dump of room state.
 *
 * The PDF button points at the authenticated report endpoint (A9). It is a
 * plain same-origin link on purpose: the session cookie goes with it, the
 * server decides whether this caller may have it, and no service credential
 * is ever within reach of this file.
 */
export function FinalReport() {
  const { room, actions } = useRoom();

  const [record, setRecord] = useState<DecisionRecord | null>(null);
  const [result, setResult] = useState<ActionResult<DecisionRecord> | null>(null);
  const [pending, setPending] = useState(false);

  /* A finalized room exposes its report without being asked — B7's whole
     point is that the meeting ends in a shared artifact, not in a button
     someone has to know to press. Keyed by the finalization, so it is fetched
     once and never on a loop. */
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (room.phase !== "finalized") return;

    const key = `${room.id}:${room.finalizedAt ?? ""}`;
    if (fetchedFor.current === key) return;
    fetchedFor.current = key;

    let cancelled = false;
    setPending(true);
    void actions.getDecisionRecord().then((next) => {
      if (cancelled) return;
      setPending(false);
      setResult(next);
      if (next.ok) setRecord(next.data);
    });

    return () => {
      cancelled = true;
    };
  }, [actions, room.phase, room.id, room.finalizedAt]);

  async function reload() {
    if (pending) return;
    setPending(true);
    const next = await actions.getDecisionRecord();
    setPending(false);
    setResult(next);
    if (next.ok) setRecord(next.data);
  }

  if (!record) {
    return (
      <section
        className="panel-block decision-panel"
        aria-labelledby="report-heading"
        data-testid="final-report"
      >
        <h2 className="panel-heading" id="report-heading">
          Decision report
        </h2>
        <p className="panel-note">
          {pending
            ? "Loading the recorded decision from the server…"
            : "The recorded decision has not loaded yet."}
        </p>
        <ActionFeedback result={result} />
        {!pending && result && !result.ok ? (
          <button className="button-quiet" type="button" onClick={() => void reload()}>
            Try again
          </button>
        ) : null}
      </section>
    );
  }

  const { decision } = record;
  const { proposal } = decision;

  const constraints = decision.proposal.referencedConstraintIds
    .map((id) => room.constraints.find((constraint) => constraint.id === id))
    .filter((constraint) => constraint !== undefined);

  const resolvedConflicts = room.conflicts.filter((conflict) => conflict.status === "resolved");

  return (
    <section
      className="panel-block decision-panel report"
      aria-labelledby="report-heading"
      data-testid="final-report"
    >
      <header className="report-head">
        <h2 className="panel-heading" id="report-heading">
          Decision report
        </h2>
        <p className="report-meta">
          {room.title} · finalized {formatTime(record.finalizedAt)} ·{" "}
          {/* The hash identifies the artifact and belongs on the page, but it
              is not what anyone came to read: short here, exact under
              provenance. */}
          <code title={decision.decisionHash} data-testid="report-hash">
            {shortDecisionHash(decision.decisionHash)}
          </code>
        </p>
        <p className="panel-note">
          Every participant reads this same record. It is immutable, and it is the server&rsquo;s,
          not this screen&rsquo;s.
        </p>
      </header>

      <section className="decision-section" aria-labelledby="report-decision-heading">
        <h3 className="panel-subheading" id="report-decision-heading">
          Decision
        </h3>
        <article className="decision-card report-decision">
          <strong>{proposal.title}</strong>
          <p>{proposal.summary}</p>
        </article>
        <DecisionList
          title="What this is expected to produce"
          entries={proposal.expectedOutcomes}
          empty="No expected outcomes were recorded."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-why-heading">
        <h3 className="panel-subheading" id="report-why-heading">
          Why we chose it
        </h3>
        <p>{decision.rationale}</p>
      </section>

      <section className="decision-section" aria-labelledby="report-constraints-heading">
        <h3 className="panel-subheading" id="report-constraints-heading">
          Key constraints
        </h3>
        <DecisionList
          title="Carried into the decision"
          entries={constraints.map(
            (constraint) => `${constraint.category}: ${constraint.text}`,
          )}
          empty="This decision referenced no constraints."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-concerns-heading">
        <h3 className="panel-subheading" id="report-concerns-heading">
          Concerns addressed
        </h3>
        {resolvedConflicts.length === 0 ? (
          <p className="panel-empty">No objections were raised against this decision.</p>
        ) : (
          <ConflictList room={room} conflicts={resolvedConflicts} />
        )}
        {decision.unresolvedWarnings.length > 0 ? (
          <>
            <h4 className="panel-subheading">Warnings carried with the decision</h4>
            {/* Not hidden and not softened: a warning that travelled with the
                decision is part of what was decided. */}
            <ConflictList room={room} conflicts={decision.unresolvedWarnings} />
          </>
        ) : null}
      </section>

      <section className="decision-section" aria-labelledby="report-tradeoffs-heading">
        <h3 className="panel-subheading" id="report-tradeoffs-heading">
          Trade-offs
        </h3>
        <DecisionList
          title="Accepted"
          entries={record.acceptedTradeoffs.map(
            (tradeoff) => `${tradeoff.description} — ${tradeoff.expectedEffect}`,
          )}
          empty="No trade-offs were accepted."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-alignment-heading">
        <h3 className="panel-subheading" id="report-alignment-heading">
          Team alignment
        </h3>
        <DecisionList
          title="Where people stood"
          entries={record.alignments.map(
            (alignment) =>
              `${participantLabel(room, alignment.participantId)}: ${
                ALIGNMENT_CHOICE_LABEL[alignment.choice]
              }${alignment.comment ? ` — ${alignment.comment}` : ""}`,
          )}
          empty="Nobody shared where they stood."
        />
        {/* Dissent is a first-class part of the record, never a footnote: a
            decision made over an objection has to say so. */}
        <DecisionList
          title="Dissent"
          entries={decision.dissent}
          empty="No dissent was recorded."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-owners-heading">
        <h3 className="panel-subheading" id="report-owners-heading">
          Owners &amp; actions
        </h3>
        <DecisionList
          title="Owners"
          entries={decision.owners.map(
            (owner) =>
              `${participantLabel(room, owner.participantId)} — ${owner.responsibility}`,
          )}
          empty="No owner was named."
        />
        <DecisionList
          title="Action items"
          entries={decision.actionItems.map((item) => {
            const owner =
              item.ownerParticipantId === null
                ? "unassigned"
                : participantLabel(room, item.ownerParticipantId);
            const due = item.dueAt ? `, due ${formatTime(item.dueAt)}` : "";
            return `${item.text} (${owner}${due})`;
          })}
          empty="No action items were recorded."
        />
        <DecisionList
          title="Deadlines"
          entries={decision.deadlines.map(
            (deadline) => `${deadline.label} — ${formatTime(deadline.dueAt)}`,
          )}
          empty="No deadline was set."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-security-heading">
        <h3 className="panel-subheading" id="report-security-heading">
          Security advice
        </h3>
        {decision.expertAdvice.length === 0 ? (
          <p className="panel-empty">The Security Expert raised nothing against this decision.</p>
        ) : (
          <ExpertAdviceList advice={decision.expertAdvice} />
        )}
        <p className="panel-note">
          Advisory only. The Security Expert never aligned, approved, or owned any part of this
          decision.
        </p>
      </section>

      <section className="decision-section report-export" aria-labelledby="report-export-heading">
        <h3 className="panel-subheading" id="report-export-heading">
          Take it with you
        </h3>
        <a className="button report-pdf" href={`/api/rooms/${room.id}/report.pdf`}>
          Download PDF
        </a>
        <p className="panel-note">
          The PDF is generated from this same record on the server, so its decision hash is the one
          above.
        </p>
      </section>

      {/* Provenance is available, never in the way: the report is what was
          decided, and the audit trail is for whoever asks a second question. */}
      <details className="report-provenance" data-testid="report-provenance">
        <summary>View detailed provenance</summary>
        <div className="report-provenance-body">
          <dl className="decision-facts">
            <div>
              <dt>Decision hash</dt>
              <dd>
                <code>{decision.decisionHash}</code>
              </dd>
            </div>
            <div>
              <dt>Finalized</dt>
              <dd>{formatTime(record.finalizedAt)}</dd>
            </div>
            <div>
              <dt>Room version</dt>
              <dd>{room.version}</dd>
            </div>
          </dl>
          <DecisionList
            title="Approvals"
            entries={record.approvals.map(
              (approval) =>
                `${participantLabel(room, approval.participantId)} confirmed ${shortDecisionHash(
                  approval.decisionHash,
                )} at ${formatTime(approval.approvedAt)}`,
            )}
            empty="No approval was recorded."
          />
          <DecisionList
            title="Provenance"
            entries={record.provenance.map(
              (event) =>
                `${participantLabel(room, event.actorId)} via ${event.origin}: ${formatActionName(
                  event.action,
                )}`,
            )}
            empty="No provenance was recorded."
          />
        </div>
      </details>

      <ActionFeedback result={result && !result.ok ? result : null} />
    </section>
  );
}
