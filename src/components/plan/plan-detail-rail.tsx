"use client";

import { useState } from "react";
import {
  ORIGIN_GLYPH,
  ORIGIN_LABEL,
  PHASE_LABEL,
  VOTE_CHOICE_LABEL,
  formatActionName,
  formatTime,
} from "@/components/room/room-labels";
import type {
  FloorPlanState,
  PlanConstraintCard,
  PlanParticipant,
} from "@/floorplan/floorplan-view-model";
import { officeIndexOf } from "@/floorplan/floorplan-view-model";
import { PlanAvatar } from "./plan-avatar";
import { IconAlert } from "./plan-icons";
import { PHASE_CALL_TO_ACTION, PLACE_LABEL, ZONE_PURPOSE, zoneLabel } from "./plan-labels";
import { usePlanSelection } from "./plan-selection";

/**
 * The detail rail: everything the plan draws, said in words.
 *
 * It follows the selection. Nothing here is authoritative — a disabled control
 * is a convenience, and the server decides what is actually permitted.
 */

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rail-section">
      <h3 className="rail-section-title">
        {title}
        {action}
      </h3>
      {children}
    </section>
  );
}

function Pills({ values }: { values: readonly string[] }) {
  if (values.length === 0) return <p className="rail-empty">Nothing published yet.</p>;
  return (
    <ul className="pill-row">
      {values.map((value) => (
        <li key={value} className="pill">
          {value}
        </li>
      ))}
    </ul>
  );
}

function PersonRow({ person }: { person: PlanParticipant }) {
  const { select } = usePlanSelection();

  return (
    <li className="person-row">
      <button type="button" onClick={() => select(`office-${person.officeSlot}`)}>
        <PlanAvatar person={person} />
        <span className="person-text">
          <span className="person-name">
            {person.name}
            {person.isSelf ? <span className="chip chip-self">You</span> : null}
          </span>
          <span className="person-role">
            {person.role}
            {person.kind === "simulation" ? (
              <span className="chip chip-sim">▲ Simulated participant</span>
            ) : null}
          </span>
        </span>
        <span className="person-state">{PLACE_LABEL[person.place]}</span>
      </button>
    </li>
  );
}

function ConstraintRow({ card }: { card: PlanConstraintCard }) {
  return (
    <li className="resource-row">
      <span className="resource-icon" style={{ background: card.color }} aria-hidden="true">
        {card.ownerInitials}
      </span>
      <span className="resource-text">
        <span className="resource-name">{card.text}</span>
        <span className="resource-meta">
          {card.category}
          {card.priority ? ` · ${card.priority} priority` : ""} · {card.ownerName}
        </span>
      </span>
    </li>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  return (
    <div className="progress">
      <div className="progress-head">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function Brief({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 150;

  return (
    <p className="rail-brief">
      {expanded || !long ? text : `${text.slice(0, 150).trimEnd()}… `}
      {long ? (
        <button type="button" className="link-button" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </p>
  );
}

/** The one live action of this milestone, plus an honest reason when it is not. */
function PrimaryAction({ view }: { view: FloorPlanState }) {
  const { openPositionDialog } = usePlanSelection();
  const available = view.phase === "input" && view.self !== null;

  return (
    <div className="rail-cta">
      <button
        type="button"
        className="button-primary"
        disabled={!available}
        onClick={openPositionDialog}
      >
        {PHASE_CALL_TO_ACTION[view.phase]}
      </button>
      <p className="rail-note">
        {available
          ? "Your agent can prepare this. You publish it."
          : view.self === null
            ? "Claim a seat in this room to act in it."
            : `${PHASE_CALL_TO_ACTION[view.phase]} is not wired up yet in this milestone.`}{" "}
        Disabled controls are a convenience. The server decides what is permitted.
      </p>
    </div>
  );
}

function categoriesOf(cards: readonly PlanConstraintCard[]): string[] {
  return [...new Set(cards.map((card) => card.category))];
}

/* -------------------------------------------------------------------------
 * The views
 * ---------------------------------------------------------------------- */

function OverviewRail({ view }: { view: FloorPlanState }) {
  return (
    <>
      <header className="rail-head">
        <h2>{view.title}</h2>
        <p className="rail-meta">
          {PHASE_LABEL[view.phase]} phase · room version {view.version} ·{" "}
          {view.participants.length} seated
        </p>
        <Brief text={view.brief} />
      </header>

      <Section title="People">
        <ul className="person-list">
          {view.participants.map((person) => (
            <PersonRow key={person.id} person={person} />
          ))}
        </ul>
      </Section>

      <Section title="Topics">
        <Pills values={categoriesOf(view.constraintCards)} />
      </Section>

      <Section title="Constraints">
        {view.constraintCards.length === 0 ? (
          <p className="rail-empty">No constraints published yet.</p>
        ) : (
          <ul className="resource-list">
            {view.constraintCards.map((card) => (
              <ConstraintRow key={card.id} card={card} />
            ))}
          </ul>
        )}
      </Section>

      <PrimaryAction view={view} />
    </>
  );
}

function MeetingRail({ view }: { view: FloorPlanState }) {
  const proposal = view.meeting.activeProposal;

  return (
    <>
      <header className="rail-head">
        <h2>Meeting room</h2>
        <p className="rail-meta">
          {view.meeting.seated.length} of 10 seats taken · {PHASE_LABEL[view.phase]} phase
        </p>
        <p className="rail-brief">{ZONE_PURPOSE["meeting-room"]}</p>
      </header>

      <Section title="On the table">
        {proposal ? (
          <div className="candidate">
            <p className="candidate-title">{proposal.title}</p>
            <p className="candidate-summary">{proposal.summary}</p>
            <span className="chip">{proposal.status}</span>
          </div>
        ) : (
          <p className="rail-empty">
            No candidate proposal yet. The room is still in its {PHASE_LABEL[view.phase]}{" "}
            phase, so the table is deliberately empty.
          </p>
        )}
      </Section>

      <Section title="At the table">
        {view.meeting.seated.length === 0 ? (
          <p className="rail-empty">
            Nobody is at the table. The room convenes from the deliberation phase onwards.
          </p>
        ) : (
          <ul className="person-list">
            {view.meeting.seated.map((person) => (
              <PersonRow key={person.id} person={person} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Topics">
        <Pills values={categoriesOf(view.constraintCards)} />
      </Section>

      <PrimaryAction view={view} />
    </>
  );
}

function OfficeRail({ view, index }: { view: FloorPlanState; index: number }) {
  const office = view.offices[index];
  const person = office?.participant ?? null;

  if (!person) {
    return (
      <>
        <header className="rail-head">
          <h2>Office {index + 1}</h2>
          <p className="rail-meta">Reserved · no participant seated</p>
          <p className="rail-brief">
            The floor is laid out for ten participants. This office stays reserved until
            somebody claims the seat, and the room works with however many are in it.
          </p>
        </header>
      </>
    );
  }

  const owned = view.constraintCards.filter((card) => card.participantId === person.id);

  return (
    <>
      <header className="rail-head">
        <h2>
          {person.name}
          {person.isSelf ? <span className="chip chip-self">You</span> : null}
        </h2>
        <p className="rail-meta">
          {person.role} · Office {index + 1} · {PLACE_LABEL[person.place]}
        </p>
        {person.kind === "simulation" ? (
          <p className="callout callout-sim">
            ▲ Simulated participant. Deterministic, and never a real person.
          </p>
        ) : null}
        <p className="rail-brief">
          {person.requiredForApproval
            ? "A required approver. Their approval is needed before this room can finalize."
            : "Not a required approver for this decision."}
        </p>
      </header>

      <Section title="Standing">
        <ul className="state-grid">
          <li>
            <span className="state-label">Positions</span>
            <span className="state-value">{person.positionCount}</span>
          </li>
          <li>
            <span className="state-label">Constraints</span>
            <span className="state-value">{person.constraintCount}</span>
          </li>
          <li>
            <span className="state-label">Vote</span>
            <span className="state-value">
              {person.vote ? VOTE_CHOICE_LABEL[person.vote] : "Not cast"}
            </span>
          </li>
          <li>
            <span className="state-label">Approval</span>
            <span className="state-value">
              {person.hasApprovedCurrentDecision ? "Recorded" : "Not given"}
            </span>
          </li>
        </ul>
        <p className="rail-note">
          Voting evaluates a candidate. Approval authorizes an exact final plan. They are
          separate, and neither implies the other.
        </p>
      </Section>

      <Section title="Constraints">
        {owned.length === 0 ? (
          <p className="rail-empty">
            {person.isSelf
              ? "You have not published a position yet."
              : `${person.name} has not published constraints yet.`}
          </p>
        ) : (
          <ul className="resource-list">
            {owned.map((card) => (
              <ConstraintRow key={card.id} card={card} />
            ))}
          </ul>
        )}
      </Section>

      {person.isSelf ? <PrimaryAction view={view} /> : null}
    </>
  );
}

function ConstraintWallRail({ view }: { view: FloorPlanState }) {
  const byOwner = new Map<string, PlanConstraintCard[]>();
  for (const card of view.constraintCards) {
    byOwner.set(card.participantId, [...(byOwner.get(card.participantId) ?? []), card]);
  }

  return (
    <>
      <header className="rail-head">
        <h2>Constraint wall</h2>
        <p className="rail-meta">
          {view.constraintCards.length} published
          {view.constraintOverflow > 0 ? ` · ${view.constraintOverflow} beyond the board` : ""}
        </p>
        <p className="rail-brief">{ZONE_PURPOSE["constraint-wall"]}</p>
      </header>

      <Section title="Topics">
        <Pills values={categoriesOf(view.constraintCards)} />
      </Section>

      {[...byOwner.entries()].map(([participantId, cards]) => {
        const owner = view.participants.find((person) => person.id === participantId);
        return (
          <Section key={participantId} title={owner?.name ?? "Unknown participant"}>
            <ul className="resource-list">
              {cards.map((card) => (
                <ConstraintRow key={card.id} card={card} />
              ))}
            </ul>
          </Section>
        );
      })}

      {view.constraintCards.length === 0 ? (
        <p className="rail-empty">Nothing on the wall yet.</p>
      ) : null}

      <PrimaryAction view={view} />
    </>
  );
}

function CommonAreaRail({ view }: { view: FloorPlanState }) {
  return (
    <>
      <header className="rail-head">
        <h2>Common area</h2>
        <p className="rail-meta">
          {view.common.publishedCount} of {view.common.seatedCount} participants have
          published
        </p>
        <p className="rail-brief">{ZONE_PURPOSE["common-area"]}</p>
      </header>

      <Section title="Open issues">
        {view.common.openConflicts.length === 0 ? (
          <p className="rail-empty">No objections are open.</p>
        ) : (
          <ul className="issue-list">
            {view.common.openConflicts.map((conflict) => (
              <li key={conflict.id} className={`issue is-${conflict.severity}`}>
                <span className="issue-icon">
                  <IconAlert />
                </span>
                <span>
                  <span className="issue-severity">
                    {conflict.severity === "blocking" ? "Blocking" : "Warning"}
                  </span>
                  <span className="issue-reason">{conflict.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Room-wide progress">
        <Progress label="Votes cast" value={view.consensus.voteProgress} />
        <Progress label="Required approvals" value={view.consensus.approvalProgress} />
      </Section>

      <Section title="Recent activity">
        <ul className="mini-ledger">
          {view.common.recentActivity
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.id}>
                <span className="origin-glyph">{ORIGIN_GLYPH[event.origin]}</span>
                <span className="mini-ledger-text">
                  <span>{formatActionName(event.action)}</span>
                  <span className="mini-ledger-meta">
                    {event.actorName} · {ORIGIN_LABEL[event.origin]} ·{" "}
                    {formatTime(event.createdAt)}
                  </span>
                </span>
              </li>
            ))}
        </ul>
      </Section>
    </>
  );
}

export function PlanDetailRail({ view }: { view: FloorPlanState }) {
  const { selected } = usePlanSelection();
  const officeIndex = selected ? officeIndexOf(selected) : null;

  return (
    <aside
      className="plan-rail"
      aria-label={selected ? `${zoneLabel(selected)} detail` : "Room detail"}
    >
      {selected === null ? <OverviewRail view={view} /> : null}
      {selected === "meeting-room" ? <MeetingRail view={view} /> : null}
      {selected === "constraint-wall" ? <ConstraintWallRail view={view} /> : null}
      {selected === "common-area" ? <CommonAreaRail view={view} /> : null}
      {officeIndex !== null ? <OfficeRail view={view} index={officeIndex} /> : null}
    </aside>
  );
}
