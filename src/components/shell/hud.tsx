"use client";

import { PHASE_LABEL } from "@/components/room/room-labels";
import { useRoom } from "@/components/room/room-provider";
import { zoneLabel } from "@/visualization/scene/scene-focus";
import { useShell } from "./shell-provider";
import { windowDefinition } from "./window-registry";
import { windowForZone } from "./zone-windows";

/**
 * The permanent overlay: what room this is, what phase it is in, and what the
 * pointer is currently over.
 *
 * It never covers the office more than it has to — the panel behind it stays
 * click-through, only the text blocks catch the pointer.
 */
export function Hud() {
  const { room, visualization } = useRoom();
  const {
    hoveredZone,
    selectedZone,
    visitZone,
    openWindow,
  } = useShell();

  const zone = hoveredZone ?? selectedZone;
  const target = zone ? windowForZone(zone) : null;
  const openConflicts = visualization.conflicts.filter(
    (conflict) => conflict.status === "open",
  ).length;
  const self = visualization.participants.find(
    (participant) => participant.isSelf,
  );
  const readyParticipants = visualization.participants.filter(
    (participant) =>
      participant.vote !== null || participant.hasApprovedCurrentDecision,
  ).length;
  const requiredApprovers = visualization.participants.filter(
    (participant) => participant.requiredForApproval,
  );
  const activeProposal = visualization.activeProposal;

  const handlePrimaryAction = () => {
    if (activeProposal) {
      visitZone("meeting-room");
      openWindow("decision");
      return;
    }

    visitZone("constraint-wall");
    openWindow("positions");
  };

  return (
    <div className="hud">
      <div className="hud-primary hud-card">
        <div className="hud-kicker">Decision room</div>
        <h1 className="hud-title">{room.title}</h1>
        <div className="hud-meta">
          <span className="hud-phase">{PHASE_LABEL[room.phase]}</span>
          <span className="hud-version">v{room.version}</span>
          {self ? <span className="hud-self">{self.name} · You</span> : null}
        </div>
        <button
          type="button"
          className="hud-action"
          onClick={handlePrimaryAction}
        >
          {activeProposal ? "Open proposal" : "Add position"}
        </button>
      </div>

      <div className="hud-center">
        <div className="hud-strip hud-card" aria-label="Constraint categories">
          <span className="hud-strip-title">Constraint Wall</span>
          {visualization.constraints.slice(0, 6).map((constraint) => (
            <span
              key={constraint.id}
              className={`hud-constraint hud-constraint-${constraint.priority ?? "normal"}`}
            >
              {constraint.category}
            </span>
          ))}
        </div>

        <div className="hud-metrics hud-card" aria-label="Consensus progress">
          <HudMeter
            label="Votes cast"
            value={visualization.consensus.voteProgress}
          />
          <HudMeter
            label="Required approvals"
            value={visualization.consensus.approvalProgress}
          />
          <div className="hud-issue">
            <span className="hud-meter-label">Open issues</span>
            <strong>{openConflicts}</strong>
          </div>
        </div>
      </div>

      <div className="hud-side">
        <div className="hud-card hud-place" role="status">
          <span className="hud-place-name">
            {zone ? zoneLabel(zone) : "Whole office"}
          </span>
          <span className="hud-place-hint">
            {zone === null
              ? "Drag, zoom, WASD, or click a room"
              : target
                ? `Opens ${windowDefinition(target).title.toLowerCase()}`
                : "Click to look closer"}
          </span>
        </div>

        <div className="hud-card hud-participants">
          <div className="hud-panel-title">
            <span>Participants</span>
            <strong>
              {readyParticipants}/{visualization.participants.length}
            </strong>
          </div>
          <ul className="hud-participant-list">
            {visualization.participants.slice(0, 5).map((participant) => (
              <li
                key={participant.id}
                className={participant.isSelf ? "hud-participant-self" : ""}
              >
                <span className="hud-avatar" aria-hidden="true">
                  {participant.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </span>
                <span className="hud-participant-copy">
                  <strong>
                    {participant.name}
                    {participant.isSelf ? " · You" : ""}
                  </strong>
                  <span>
                    {participant.role}
                    {participant.kind === "simulation" ? " · Simulated" : ""}
                  </span>
                </span>
                <span className="hud-authority">
                  {participant.requiredForApproval ? "Approval" : "Advisor"}
                </span>
              </li>
            ))}
          </ul>
          <p className="hud-approver-note">
            {requiredApprovers.length} required approver
            {requiredApprovers.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>
    </div>
  );
}

function HudMeter({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(1, Math.max(0, value));

  return (
    <div className="hud-meter">
      <span className="hud-meter-label">{label}</span>
      <strong>{Math.round(clamped * 100)}%</strong>
      <span className="hud-meter-track" aria-hidden="true">
        <span style={{ width: `${clamped * 100}%` }} />
      </span>
    </div>
  );
}
