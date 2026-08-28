"use client";

import { useRoom } from "./room-provider";
import { PHASE_FOCUS, PHASE_LABEL, PHASE_ORDER } from "./room-labels";

/**
 * Where the room is in its six phases, and who you are inside it.
 *
 * The HUD carries the short version permanently; this is the full rail, for
 * when someone wants to see the whole sequence rather than the current step.
 */
export function RoomStatusPanel() {
  const { room, self } = useRoom();

  return (
    <section className="panel-block" aria-labelledby="status-heading">
      <h2 className="panel-heading" id="status-heading">
        Phase &amp; room status
      </h2>

      <dl className="room-facts">
        <div>
          <dt>You are</dt>
          <dd>
            {self ? (
              <>
                {self.name}
                <span className="room-facts-sub">{self.role}</span>
              </>
            ) : (
              <>
                Observing
                <span className="room-facts-sub">No seat claimed</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Room version</dt>
          <dd>
            {room.version}
            <span className="room-facts-sub">Server authoritative</span>
          </dd>
        </div>
      </dl>

      <ol className="phase-rail" aria-label="Room phase">
        {PHASE_ORDER.map((phase) => {
          const isCurrent = phase === room.phase;
          return (
            <li
              key={phase}
              className={isCurrent ? "phase-step phase-step-current" : "phase-step"}
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="phase-step-name">{PHASE_LABEL[phase]}</span>
              {isCurrent ? (
                <span className="visually-hidden"> (current phase)</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="phase-focus">{PHASE_FOCUS[room.phase]}</p>
    </section>
  );
}
