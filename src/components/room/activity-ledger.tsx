"use client";

import type { ActionOrigin } from "@/contracts/room";
import { useRoom } from "./room-provider";
import {
  ACTOR_TYPE_LABEL,
  formatActionName,
  formatTime,
  ORIGIN_DESCRIPTION,
  ORIGIN_GLYPH,
  ORIGIN_LABEL,
} from "./room-labels";

/**
 * The activity ledger is a product feature, not developer logging.
 *
 * Origin is shown with a glyph and a word, never colour alone, and it never
 * implies authority: a browser agent acting through WebMCP is still the same
 * participant with the same authority as when they act manually.
 */

const LEGEND_ORIGINS: readonly ActionOrigin[] = [
  "manual_ui",
  "webmcp",
  "simulation",
  "expert_service",
  "system",
];

export function ActivityLedger() {
  const { room, visualization } = useRoom();
  const entries = [...visualization.recentActivity].reverse();
  const latestWebMcpActivity = room.participants.map((participant) => {
    const event = room.activity
      .filter(
        (candidate) =>
          candidate.origin === "webmcp" && candidate.actorId === participant.id,
      )
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

    return { participant, event };
  });

  return (
    <section className="panel-block" aria-labelledby="activity-heading">
      <h2 className="panel-heading" id="activity-heading">
        Activity &amp; audit ledger
      </h2>

      <ul className="origin-legend">
        {LEGEND_ORIGINS.map((origin) => (
          <li key={origin} className={`origin-chip origin-${origin}`}>
            <span aria-hidden="true">{ORIGIN_GLYPH[origin]}</span>
            <span>{ORIGIN_LABEL[origin]}</span>
            <span className="visually-hidden">
              {" — "}
              {ORIGIN_DESCRIPTION[origin]}
            </span>
          </li>
        ))}
      </ul>

      <section
        className="latest-agent-actions"
        aria-labelledby="latest-agent-actions-heading"
      >
        <h3 className="panel-subheading" id="latest-agent-actions-heading">
          Latest browser-agent actions
        </h3>
        <ul className="latest-agent-list">
          {latestWebMcpActivity.map(({ participant, event }) => (
            <li key={participant.id} className="latest-agent-row">
              <span className="latest-agent-participant">
                {participant.role}
                <span>{participant.name}</span>
              </span>
              {event ? (
                <span className="latest-agent-event">
                  <span className="activity-origin origin-webmcp">
                    <span aria-hidden="true">{ORIGIN_GLYPH.webmcp}</span>
                    via browser agent
                  </span>
                  <span>
                    {formatActionName(event.action)} · {formatTime(event.createdAt)}
                  </span>
                </span>
              ) : (
                <span className="latest-agent-empty">
                  No browser-agent action recorded
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <ol className="activity-list">
        {entries.map((event) => {
          const participant =
            event.actorId && event.actorType === "participant"
              ? room.participants.find(
                  (candidate) => candidate.id === event.actorId,
                )
              : null;
          const actorLabel =
            participant?.role ??
            (event.actorType === "system" ? "System" : event.actorName);

          return (
            <li key={event.id} className={`activity-item origin-${event.origin}`}>
              <span className="activity-origin">
                <span aria-hidden="true">{ORIGIN_GLYPH[event.origin]}</span>
                {ORIGIN_LABEL[event.origin]}
              </span>
              <span className="activity-body">
                <strong>
                  {actorLabel}
                  {participant ? (
                    <span className="activity-actor-name">
                      {participant.name}
                    </span>
                  ) : null}
                </strong>
                <span>
                  via {ORIGIN_LABEL[event.origin].toLowerCase()} ·{" "}
                  {formatActionName(event.action)}
                </span>
                <span className="activity-meta">
                  {ACTOR_TYPE_LABEL[event.actorType]} · {formatTime(event.createdAt)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <p className="panel-note">
        Showing the {entries.length} most recent of {room.activity.length}{" "}
        recorded events.
      </p>
    </section>
  );
}
