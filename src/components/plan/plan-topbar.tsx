"use client";

import { PHASE_LABEL } from "@/components/room/room-labels";
import type { FloorPlanState } from "@/floorplan/floorplan-view-model";
import { IconActivity, IconAlert, IconMinus, IconPlus } from "./plan-icons";
import { zoneLabel } from "./plan-labels";
import { usePlanSelection, ZOOM_STEPS } from "./plan-selection";

/** Breadcrumb, room-wide indicators, and the plan's own zoom control. */

export function PlanTopbar({ view }: { view: FloorPlanState }) {
  const { selected, ledgerOpen, toggleLedger, select } = usePlanSelection();
  const openIssues = view.common.openConflicts.length;

  return (
    <header className="plan-topbar">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="crumb crumb-quiet" onClick={() => select(null)}>
          {view.title}
        </button>
        <span className="crumb-sep" aria-hidden="true">
          /
        </span>
        <span className="crumb crumb-current" aria-current="page">
          {selected ? zoneLabel(selected) : "Whole floor"}
        </span>
      </nav>

      <div className="topbar-actions">
        <span className={`indicator${openIssues > 0 ? " is-live" : ""}`}>
          <IconAlert />
          {openIssues} open {openIssues === 1 ? "issue" : "issues"}
        </span>

        <span className="chip chip-phase">{PHASE_LABEL[view.phase]}</span>
        <span className="chip">v{view.version}</span>

        <button
          type="button"
          className={`button-ghost${ledgerOpen ? " is-active" : ""}`}
          aria-expanded={ledgerOpen}
          onClick={toggleLedger}
        >
          <IconActivity />
          Activity
        </button>
      </div>
    </header>
  );
}

export function PlanToolbar({ view }: { view: FloorPlanState }) {
  const { zoom, zoomIn, zoomOut, resetZoom } = usePlanSelection();
  const atMin = zoom === ZOOM_STEPS[0];
  const atMax = zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1];

  return (
    <div className="plan-toolbar">
      <ul className="legend" aria-label="Plan legend">
        <li>
          <span className="legend-swatch is-occupied" aria-hidden="true" />
          {view.participants.length} occupied
        </li>
        <li>
          <span className="legend-swatch is-reserved" aria-hidden="true" />
          {10 - view.participants.length} reserved
        </li>
        <li>
          <span className="legend-swatch is-self" aria-hidden="true" />
          You
        </li>
        <li>
          <span className="legend-glyph" aria-hidden="true">
            ▲
          </span>
          Simulated
        </li>
      </ul>

      <div className="zoom">
        <button type="button" onClick={zoomOut} disabled={atMin} aria-label="Zoom out">
          <IconMinus />
        </button>
        <button type="button" className="zoom-value" onClick={resetZoom}>
          {zoom}%
        </button>
        <button type="button" onClick={zoomIn} disabled={atMax} aria-label="Zoom in">
          <IconPlus />
        </button>
      </div>
    </div>
  );
}
