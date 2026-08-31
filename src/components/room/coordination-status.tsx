"use client";

import { deriveCoordinationStatus } from "./coordination";
import { useRoom } from "./room-provider";

/**
 * The coordination story, on screen.
 *
 * B2's requirement is that the visible room and the agent protocol tell the
 * same story: a person glancing at this should be able to answer "who are we
 * waiting for?" without opening another workspace, and get the same answer
 * their agent would get from one read. Both read the same canonical snapshot.
 *
 * `strip` is the one-line version that rides above every workspace card;
 * `full` is the roster, shown wherever there is room for it.
 */
export function CoordinationStatus({ variant = "full" }: { variant?: "full" | "strip" }) {
  const { room } = useRoom();
  const status = deriveCoordinationStatus(room);

  if (variant === "strip") {
    return (
      <div className="coordination-strip" data-testid="coordination-strip">
        <span className="coordination-strip-phase">{status.phaseLabel}</span>
        {status.progressLabel ? (
          <>
            <span className="coordination-strip-divider" aria-hidden="true" />
            <span className="coordination-strip-progress">{status.progressLabel}</span>
          </>
        ) : null}
        <span className="coordination-strip-divider" aria-hidden="true" />
        <span
          className={
            status.waitingFor.length > 0
              ? "coordination-strip-waiting coordination-strip-waiting-open"
              : "coordination-strip-waiting"
          }
        >
          {status.waitingLine}
        </span>
      </div>
    );
  }

  return (
    <section
      className="coordination"
      aria-labelledby="coordination-heading"
      data-testid="coordination-status"
    >
      <div className="coordination-head">
        <h3 className="coordination-phase" id="coordination-heading">
          {status.phaseLabel}
        </h3>
        {status.progressLabel ? (
          <span className="coordination-progress">{status.progressLabel}</span>
        ) : null}
      </div>

      <p className="coordination-goal">{status.goal}</p>

      {status.facts.length > 0 ? (
        <dl className="coordination-facts">
          {status.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className={fact.warn ? "coordination-fact-warn" : undefined}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {status.people.length > 0 ? (
        <>
          {status.peopleLegend ? (
            <p className="coordination-legend">{status.peopleLegend}</p>
          ) : null}
          <ul className="coordination-people">
            {status.people.map((person) => (
              <li
                key={person.id}
                className={person.done ? "coordination-person coordination-person-done" : "coordination-person"}
              >
                {/* The glyph is decoration; the words beside it carry the
                    state, so neither colour nor a tick is the only cue. */}
                <span className="coordination-person-mark" aria-hidden="true">
                  {person.done ? "✓" : "○"}
                </span>
                <span className="coordination-person-name">{person.name}</span>
                <span className="coordination-person-role">{person.role}</span>
                <span className="coordination-person-detail">{person.detail}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p
        className={
          status.waitingFor.length > 0
            ? "coordination-waiting coordination-waiting-open"
            : "coordination-waiting"
        }
        data-testid="coordination-waiting"
      >
        {status.waitingLine}
      </p>

      <p className="panel-note">{status.advanceHint}</p>
    </section>
  );
}
