"use client";

import { useState } from "react";
import Link from "next/link";
import { PHASE_FOCUS, PHASE_LABEL, PHASE_ORDER } from "@/components/room/room-labels";
import type { FloorPlanState, PlanZoneId } from "@/floorplan/floorplan-view-model";
import { PlanAvatar } from "./plan-avatar";
import {
  IconActivity,
  IconChevron,
  IconExternal,
  IconLounge,
  IconMark,
  IconOffice,
  IconPlan,
  IconTable,
  IconWall,
} from "./plan-icons";
import { usePlanSelection } from "./plan-selection";

/**
 * The room's navigation rail.
 *
 * Every place the pointer can reach on the plan is reachable from here as an
 * ordinary button, so the SVG is never the only route to anything.
 */

function NavItem({
  zone,
  icon,
  label,
  meta,
  avatar,
}: {
  zone: PlanZoneId | null;
  icon: React.ReactNode;
  label: string;
  meta?: string | undefined;
  avatar?: React.ReactNode | undefined;
}) {
  const { selected, select, setHovered } = usePlanSelection();
  const active = selected === zone;

  return (
    <li>
      <button
        type="button"
        className={`nav-item${active ? " is-active" : ""}`}
        aria-current={active ? "true" : undefined}
        onClick={() => select(zone)}
        onPointerEnter={() => setHovered(zone)}
        onPointerLeave={() => setHovered(null)}
      >
        <span className="nav-item-icon">{avatar ?? icon}</span>
        <span className="nav-item-label">{label}</span>
        {meta ? <span className="nav-item-meta">{meta}</span> : null}
      </button>
    </li>
  );
}

export function PlanSidebar({ view }: { view: FloorPlanState }) {
  const { select, ledgerOpen, toggleLedger } = usePlanSelection();
  const [showReserved, setShowReserved] = useState(false);

  const occupied = view.offices.filter((office) => office.participant !== null);
  const reserved = view.offices.filter((office) => office.participant === null);

  return (
    <aside className="plan-sidebar" aria-label="Room navigation">
      <div className="brand">
        <span className="brand-mark">
          <IconMark />
        </span>
        <span className="brand-name">WebMCP Office</span>
        <span className="brand-view">Plan</span>
      </div>

      <nav className="nav-scroll">
        <p className="nav-group-title">Floor</p>
        <ul className="nav-list">
          <NavItem zone={null} icon={<IconPlan />} label="Whole floor" />
          <NavItem
            zone="meeting-room"
            icon={<IconTable />}
            label="Meeting room"
            meta={`${view.meeting.seated.length}/10`}
          />
          <NavItem
            zone="constraint-wall"
            icon={<IconWall />}
            label="Constraint wall"
            meta={String(view.constraintCards.length)}
          />
          <NavItem
            zone="common-area"
            icon={<IconLounge />}
            label="Common area"
            meta={
              view.common.openConflicts.length > 0
                ? String(view.common.openConflicts.length)
                : undefined
            }
          />
        </ul>

        <p className="nav-group-title">Offices</p>
        <ul className="nav-list">
          {occupied.map((office) => (
            <NavItem
              key={office.index}
              zone={office.zoneId}
              icon={<IconOffice />}
              avatar={
                office.participant ? <PlanAvatar person={office.participant} size={22} /> : null
              }
              label={office.participant?.name ?? ""}
              meta={office.participant?.isSelf ? "You" : undefined}
            />
          ))}

          <li>
            <button
              type="button"
              className={`nav-item nav-item-quiet${showReserved ? " is-open" : ""}`}
              aria-expanded={showReserved}
              onClick={() => setShowReserved((current) => !current)}
            >
              <span className="nav-item-icon nav-chevron">
                <IconChevron />
              </span>
              <span className="nav-item-label">{reserved.length} reserved offices</span>
            </button>
          </li>

          {showReserved
            ? reserved.map((office) => (
                <NavItem
                  key={office.index}
                  zone={office.zoneId}
                  icon={<IconOffice />}
                  label={`Office ${office.index + 1}`}
                  meta="Reserved"
                />
              ))
            : null}
        </ul>

        <p className="nav-group-title">Room</p>
        <ul className="nav-list">
          <li>
            <button
              type="button"
              className={`nav-item${ledgerOpen ? " is-active" : ""}`}
              aria-expanded={ledgerOpen}
              onClick={toggleLedger}
            >
              <span className="nav-item-icon">
                <IconActivity />
              </span>
              <span className="nav-item-label">Activity ledger</span>
              <span className="nav-item-meta">{view.activity.length}</span>
            </button>
          </li>
        </ul>
      </nav>

      <div className="phase-card">
        <p className="phase-card-title">{PHASE_LABEL[view.phase]} phase</p>
        <p className="phase-card-focus">{PHASE_FOCUS[view.phase]}</p>
        <ol className="plan-phase-rail" aria-label="Room phase progress">
          {PHASE_ORDER.map((phase) => {
            const index = PHASE_ORDER.indexOf(phase);
            const current = PHASE_ORDER.indexOf(view.phase);
            const state = index < current ? "done" : index === current ? "current" : "ahead";
            return (
              <li key={phase} className={`plan-phase-step is-${state}`}>
                <span className="visually-hidden">
                  {PHASE_LABEL[phase]} — {state === "current" ? "current phase" : state}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="sidebar-footer">
        {view.self ? (
          <button
            type="button"
            className="self-card"
            onClick={() => select(`office-${view.self?.officeSlot ?? 0}` as PlanZoneId)}
          >
            <PlanAvatar person={view.self} size={30} />
            <span>
              <span className="self-name">{view.self.name}</span>
              <span className="self-role">You · {view.self.role}</span>
            </span>
          </button>
        ) : (
          <p className="self-card is-empty">You are not seated in this room.</p>
        )}

        <Link className="sidebar-link" href={`/room/${view.roomId}`}>
          <IconExternal />
          Open the 3D office
        </Link>
      </div>
    </aside>
  );
}
