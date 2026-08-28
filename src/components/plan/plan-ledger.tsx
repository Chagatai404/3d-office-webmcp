"use client";

import {
  ACTOR_TYPE_LABEL,
  ORIGIN_DESCRIPTION,
  ORIGIN_GLYPH,
  ORIGIN_LABEL,
  formatActionName,
  formatTime,
} from "@/components/room/room-labels";
import type { FloorPlanState } from "@/floorplan/floorplan-view-model";
import { IconClose } from "./plan-icons";
import { usePlanSelection } from "./plan-selection";

/**
 * The activity ledger.
 *
 * A product feature, not developer logging: every entry names the actor, the
 * origin, and what changed. Origin is always a glyph plus a word, so the five
 * origins never depend on colour alone — and a browser agent or a simulated
 * participant never reads as holding authority a human did not grant.
 */
export function PlanLedger({ view }: { view: FloorPlanState }) {
  const { ledgerOpen, toggleLedger } = usePlanSelection();
  if (!ledgerOpen) return null;

  return (
    <section className="plan-ledger" aria-label="Activity ledger">
      <header className="ledger-head">
        <h2>Activity ledger</h2>
        <p className="ledger-meta">
          {view.activity.length} events · newest first · room version {view.version}
        </p>
        <button
          type="button"
          className="icon-button"
          onClick={toggleLedger}
          aria-label="Close the activity ledger"
        >
          <IconClose />
        </button>
      </header>

      {view.activity.length === 0 ? (
        <p className="rail-empty">Nothing has happened in this room yet.</p>
      ) : (
        <ol className="ledger-list">
          {view.activity
            .slice()
            .reverse()
            .map((event) => (
              <li key={event.id} className={`ledger-row plan-origin-${event.origin}`}>
                <span className="ledger-time">{formatTime(event.createdAt)}</span>
                <span className="ledger-origin" title={ORIGIN_DESCRIPTION[event.origin]}>
                  <span className="origin-glyph" aria-hidden="true">
                    {ORIGIN_GLYPH[event.origin]}
                  </span>
                  {ORIGIN_LABEL[event.origin]}
                </span>
                <span className="ledger-action">{formatActionName(event.action)}</span>
                <span className="ledger-actor">
                  {event.actorName}
                  <span className="ledger-actor-type">
                    {ACTOR_TYPE_LABEL[event.actorType]}
                  </span>
                </span>
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
