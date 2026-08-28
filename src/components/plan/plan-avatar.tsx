import type { PlanParticipant } from "@/floorplan/floorplan-view-model";

/**
 * Participant pucks.
 *
 * The plan has no photographs, so identity is carried by initials on a stable
 * per-office colour. A simulated participant always gets a dashed ring and a
 * triangle glyph as well as its label: it must never read as a real person,
 * and it must not depend on colour alone to say so.
 */

const PUCK_RADIUS = 17;

export function PlanAvatarPuck({ person }: { person: PlanParticipant }) {
  const { x, y } = person.at;
  const simulated = person.kind === "simulation";

  return (
    <g
      className={`plan-puck${person.isSelf ? " is-self" : ""}${simulated ? " is-simulated" : ""}`}
    >
      {simulated ? (
        <circle cx={x} cy={y} r={PUCK_RADIUS + 4} className="plan-puck-sim-ring" />
      ) : null}
      {person.isSelf ? (
        <circle cx={x} cy={y} r={PUCK_RADIUS + 4} className="plan-puck-self-ring" />
      ) : null}
      <circle cx={x} cy={y} r={PUCK_RADIUS} fill={person.color} className="plan-puck-body" />
      <text x={x} y={y} className="plan-puck-initials">
        {person.initials}
      </text>
      {simulated ? (
        <path
          d={`M ${x + 11} ${y - 21} l 6 10 l -12 0 z`}
          className="plan-puck-sim-glyph"
        />
      ) : null}
      {person.hasApprovedCurrentDecision ? (
        <path
          d={`M ${x - 5} ${y + 20} l 4 4 l 7 -8`}
          className="plan-puck-approved"
        />
      ) : null}
    </g>
  );
}

/** The DOM equivalent, used in the sidebar and detail rail. */
export function PlanAvatar({
  person,
  size = 34,
}: {
  person: PlanParticipant;
  size?: number;
}) {
  return (
    <span
      className={`plan-avatar${person.kind === "simulation" ? " is-simulated" : ""}`}
      style={{
        background: person.color,
        width: `${size}px`,
        height: `${size}px`,
        fontSize: `${Math.round(size * 0.38)}px`,
      }}
      aria-hidden="true"
    >
      {person.initials}
    </span>
  );
}
