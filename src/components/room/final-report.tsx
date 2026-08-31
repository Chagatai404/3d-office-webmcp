"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionResult, DecisionRecord, MeetingReport } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { shortDecisionHash } from "./coordination";
import {
  ConflictList,
  DecisionList,
  ExpertAdviceList,
} from "./decision-shared";
import { ALIGNMENT_CHOICE_LABEL, formatActionName, formatTime } from "./room-labels";
import { useRoom } from "./room-provider";

/**
 * What a finalized meeting leaves behind: one report, the same for everyone.
 *
 * BACKEND CONTRACT:
 * Every primary section below is read directly from the server's canonical
 * `MeetingReport`. The raw `DecisionRecord` is fetched only for the explicitly
 * expanded line-by-line provenance view; it never reconstructs report content.
 *
 * The PDF button points at the authenticated report endpoint (A9). It is a
 * plain same-origin link on purpose: the session cookie goes with it, the
 * server decides whether this caller may have it, and no service credential
 * is ever within reach of this file.
 */
export function FinalReport() {
  const { room, actions } = useRoom();

  const [report, setReport] = useState<MeetingReport | null>(null);
  const [record, setRecord] = useState<DecisionRecord | null>(null);
  const [result, setResult] = useState<ActionResult<MeetingReport> | null>(null);
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
    void Promise.all([actions.getMeetingReport(), actions.getDecisionRecord()]).then(([next, raw]) => {
      if (cancelled) return;
      setPending(false);
      setResult(next);
      if (next.ok) setReport(next.data);
      if (raw.ok) setRecord(raw.data);
    });

    return () => {
      cancelled = true;
    };
  }, [actions, room.phase, room.id, room.finalizedAt]);

  async function reload() {
    if (pending) return;
    setPending(true);
    const next = await actions.getMeetingReport();
    setPending(false);
    setResult(next);
    if (next.ok) setReport(next.data);
  }

  if (!report) {
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

  const participantName = (participantId: string) =>
    report.participants.find((participant) => participant.id === participantId)?.name
      ?? participantId;

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
          {report.title} · finalized {formatTime(report.finalizedAt)} ·{" "}
          {/* The hash identifies the artifact and belongs on the page, but it
              is not what anyone came to read: short here, exact under
              provenance. */}
          <code title={report.decisionHash} data-testid="report-hash">
            {shortDecisionHash(report.decisionHash)}
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
          <strong>{report.finalDecision.title}</strong>
          <p>{report.finalDecision.summary}</p>
        </article>
      </section>

      <section className="decision-section" aria-labelledby="report-why-heading">
        <h3 className="panel-subheading" id="report-why-heading">
          Why we chose it
        </h3>
        <p>{report.rationale}</p>
      </section>

      <section className="decision-section" aria-labelledby="report-constraints-heading">
        <h3 className="panel-subheading" id="report-constraints-heading">
          Key constraints
        </h3>
        <DecisionList
          title="Carried into the decision"
          entries={report.constraints.map(
            (constraint) => `${constraint.category}: ${constraint.text}`,
          )}
          empty="This decision referenced no constraints."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-concerns-heading">
        <h3 className="panel-subheading" id="report-concerns-heading">
          Concerns addressed
        </h3>
        {report.resolvedConcerns.length === 0 ? (
          <p className="panel-empty">No objections were raised against this decision.</p>
        ) : (
          <ConflictList room={room} conflicts={report.resolvedConcerns} />
        )}
        {report.unresolvedWarnings.length > 0 ? (
          <>
            <h4 className="panel-subheading">Warnings carried with the decision</h4>
            {/* Not hidden and not softened: a warning that travelled with the
                decision is part of what was decided. */}
            <ConflictList room={room} conflicts={report.unresolvedWarnings} />
          </>
        ) : null}
      </section>

      <section className="decision-section" aria-labelledby="report-tradeoffs-heading">
        <h3 className="panel-subheading" id="report-tradeoffs-heading">
          Trade-offs
        </h3>
        <DecisionList
          title="Accepted"
          entries={report.acceptedTradeoffs.map(
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
          entries={report.alignment.map(
            (alignment) =>
              `${participantName(alignment.participantId)}: ${
                ALIGNMENT_CHOICE_LABEL[alignment.choice]
              }${alignment.comment ? ` — ${alignment.comment}` : ""}`,
          )}
          empty="Nobody shared where they stood."
        />
        {/* Dissent is a first-class part of the record, never a footnote: a
            decision made over an objection has to say so. */}
        <DecisionList
          title="Dissent"
          entries={report.dissent}
          empty="No dissent was recorded."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-owners-heading">
        <h3 className="panel-subheading" id="report-owners-heading">
          Owners &amp; actions
        </h3>
        <DecisionList
          title="Owners"
          entries={report.owners.map(
            (owner) =>
              `${participantName(owner.participantId)} — ${owner.responsibility}`,
          )}
          empty="No owner was named."
        />
        <DecisionList
          title="Action items"
          entries={report.actionItems.map((item) => {
            const owner =
              item.ownerParticipantId === null
                ? "unassigned"
                : participantName(item.ownerParticipantId);
            const due = item.dueAt ? `, due ${formatTime(item.dueAt)}` : "";
            return `${item.text} (${owner}${due})`;
          })}
          empty="No action items were recorded."
        />
        <DecisionList
          title="Deadlines"
          entries={report.deadlines.map(
            (deadline) => `${deadline.label} — ${formatTime(deadline.dueAt)}`,
          )}
          empty="No deadline was set."
        />
      </section>

      <section className="decision-section" aria-labelledby="report-security-heading">
        <h3 className="panel-subheading" id="report-security-heading">
          Security advice
        </h3>
        {report.expertAdvice.length === 0 ? (
          <p className="panel-empty">The Security Expert raised nothing against this decision.</p>
        ) : (
          <ExpertAdviceList advice={report.expertAdvice} />
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
        <a className="button report-pdf" href={`/api/rooms/${report.roomId}/report.pdf`}>
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
                <code>{report.decisionHash}</code>
              </dd>
            </div>
            <div>
              <dt>Finalized</dt>
              <dd>{formatTime(report.finalizedAt)}</dd>
            </div>
            <div>
              <dt>Room version</dt>
              <dd>{room.version}</dd>
            </div>
          </dl>
          <DecisionList
            title="Approvals"
            entries={report.approvals.map(
              (approval) =>
                `${participantName(approval.participantId)} confirmed ${shortDecisionHash(
                  approval.decisionHash,
                )} at ${formatTime(approval.approvedAt)}`,
            )}
            empty="No approval was recorded."
          />
          <DecisionList
            title="Provenance"
            entries={record?.provenance.map((event) =>
              `${event.actorId ? participantName(event.actorId) : "System"} via ${event.origin}: ${formatActionName(event.action)}`,
            ) ?? Object.entries(report.provenanceSummary.byAction).map(
              ([action, count]) => `${formatActionName(action)} × ${count}`,
            )}
            empty="No provenance was recorded."
          />
        </div>
      </details>

      <ActionFeedback result={result && !result.ok ? result : null} />
    </section>
  );
}
