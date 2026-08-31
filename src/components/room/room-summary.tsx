"use client";

import { useShell } from "@/components/shell/shell-provider";
import { deriveCoordinationStatus } from "./coordination";
import { useRoom } from "./room-provider";

/**
 * Level-1 ambient summary, shown only at the Room workspace.
 *
 * A handful of headline facts read straight off the table, plus one way to
 * go deeper. Full detail lives behind the matching workspace tab, per the
 * product's progressive-disclosure rule.
 */
export function RoomSummary() {
  const { room, visualization } = useRoom();
  const { goToWorkspace } = useShell();
  const openConflicts = visualization.conflicts.filter((conflict) => conflict.status === "open");
  const blocking = openConflicts.filter((conflict) => conflict.severity === "blocking").length;
  const coordination = deriveCoordinationStatus(room);

  return (
    <div className="room-summary">
      <span className="room-summary-fact">
        <span className="room-summary-label">Deciding</span>
        <span className="room-summary-value">{room.title}</span>
      </span>
      <span className="room-summary-divider" aria-hidden="true" />
      <span className="room-summary-fact">
        <span className="room-summary-label">
          {coordination.phaseLabel}
          {coordination.progressLabel ? ` · ${coordination.progressLabel}` : ""}
        </span>
        <span
          className={
            coordination.waitingFor.length > 0
              ? "room-summary-value room-summary-value-warn"
              : "room-summary-value"
          }
        >
          {coordination.waitingLine}
        </span>
      </span>
      <span className="room-summary-divider" aria-hidden="true" />
      <span className="room-summary-fact">
        <span className="room-summary-label">On the table</span>
        <span className="room-summary-value">
          {visualization.activeProposal ? visualization.activeProposal.title : "No proposal yet"}
        </span>
      </span>
      <span className="room-summary-divider" aria-hidden="true" />
      <span className="room-summary-fact">
        <span className="room-summary-label">Blocking you</span>
        <span className={blocking > 0 ? "room-summary-value room-summary-value-warn" : "room-summary-value"}>
          {blocking > 0 ? `${blocking} blocking issue${blocking === 1 ? "" : "s"}` : "None open"}
        </span>
      </span>
      {openConflicts.length > 0 ? (
        <button type="button" className="room-summary-cta" onClick={() => goToWorkspace("issues")}>
          Go to the issues board
        </button>
      ) : null}
    </div>
  );
}
