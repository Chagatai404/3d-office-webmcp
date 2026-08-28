"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BUILDING_OUTLINE,
  COMMON_AREA,
  COMMON_FIXTURES,
  CONSTRAINT_BOARD,
  CONSTRAINT_WALL,
  CORRIDORS,
  MEETING_FIXTURES,
  MEETING_ROOM,
  MEETING_TABLE,
  PLAN_VIEWBOX,
  STAIRS,
  constraintCardRect,
  inset,
  meetingSeats,
  officeFurniture,
  officePlacements,
  planDoors,
  rectCentre,
  type PlanRect,
} from "@/floorplan/floorplan-layout";
import type {
  FloorPlanState,
  PlanConstraintCard,
  PlanOffice,
  PlanZoneId,
} from "@/floorplan/floorplan-view-model";
import { PlanAvatarPuck } from "./plan-avatar";
import { zoneLabel } from "./plan-labels";
import { usePlanSelection } from "./plan-selection";
import {
  Chair,
  CoffeeTable,
  Counter,
  Couch,
  Desk,
  Monitor,
  OvalTable,
  Plant,
  Shelf,
  Stairs,
  Whiteboard,
} from "./plan-furniture";

/**
 * The floor plan.
 *
 * Draws `FloorPlanState` and nothing else: it reads no room state, calls no
 * client, and decides nothing. Every place is a real button, so the plan is
 * navigable by keyboard rather than being a picture with a text fallback
 * bolted on beside it.
 */

const PLACEMENTS = officePlacements();
const SEATS = meetingSeats();
const DOORS = planDoors();

/* -------------------------------------------------------------------------
 * Fitting the plan to its pane
 * ---------------------------------------------------------------------- */

/** Scale at which the whole building is visible: the view's own 100%. */
function useFitScale(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState(0.6);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setFit(
        Math.min(
          (width - 48) / PLAN_VIEWBOX.width,
          (height - 48) / PLAN_VIEWBOX.height,
        ),
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, fit];
}

/** Drag anywhere on the plan to pan it, the way a map behaves. */
function useDragPan(ref: React.RefObject<HTMLDivElement | null>) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const element = ref.current;
      // Only a plain drag on empty floor pans; clicks on rooms still select.
      if (!element || event.button !== 0) return;
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
      };
    },
    [ref],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const element = ref.current;
      const start = drag.current;
      if (!element || !start) return;
      element.scrollLeft = start.left - (event.clientX - start.x);
      element.scrollTop = start.top - (event.clientY - start.y);
    };
    const onUp = () => {
      drag.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [ref]);

  return onPointerDown;
}

/* -------------------------------------------------------------------------
 * Structure
 * ---------------------------------------------------------------------- */

/** Selection and hover live on the room group, so the whole room reacts. */
function useZoneClass(zone: PlanZoneId): string {
  const { selected, hovered } = usePlanSelection();
  return [
    selected === zone ? "is-selected" : "",
    hovered === zone ? "is-hovered" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function Walls() {
  return (
    <g className="plan-walls">
      <rect {...BUILDING_OUTLINE} className="wall wall-outer" />
      <rect {...MEETING_ROOM} className="wall" />
      <rect {...CONSTRAINT_WALL} className="wall" />
      <rect {...COMMON_AREA} className="wall" />
      {PLACEMENTS.map((placement) => (
        <rect key={placement.index} {...placement.rect} className="wall" />
      ))}
    </g>
  );
}

function Doors() {
  return (
    <g className="plan-doors">
      {DOORS.map((door, index) => (
        <rect key={`gap-${index}`} {...door.gap} className="door-gap" />
      ))}
      {DOORS.map((door, index) =>
        door.swing ? (
          <path key={`swing-${index}`} d={door.swing} className="door-swing" />
        ) : null,
      )}
    </g>
  );
}

/* -------------------------------------------------------------------------
 * Rooms
 * ---------------------------------------------------------------------- */

function OfficeRoom({ office }: { office: PlanOffice }) {
  const zoneClass = useZoneClass(office.zoneId);
  const placement = PLACEMENTS[office.index];
  if (!placement) return null;

  const furniture = officeFurniture(placement);
  const centre = rectCentre(placement.rect);
  const occupied = office.status === "occupied";

  return (
    <g
      className={`plan-room room-office ${occupied ? "is-occupied" : "is-reserved"} ${zoneClass}`}
    >
      <rect {...placement.rect} className="floor" />
      {occupied ? (
        <rect
          x={placement.rect.x + (placement.side === "left" ? 0 : placement.rect.width - 7)}
          y={placement.rect.y}
          width={7}
          height={placement.rect.height}
          fill={office.color}
          className="office-spine"
        />
      ) : null}

      <Desk rect={furniture.desk} />
      {occupied ? <Monitor rect={furniture.monitor} /> : null}
      <Chair at={furniture.chair} facing={180} />
      <Shelf rect={furniture.shelf} />
      {occupied ? <Plant at={furniture.plant} /> : null}

      <text
        x={centre.x}
        y={placement.rect.y + placement.rect.height - 16}
        className="room-label"
      >
        {occupied ? office.participant?.role : `Office ${office.index + 1} · reserved`}
      </text>
    </g>
  );
}

function MeetingRoom({ view }: { view: FloorPlanState }) {
  const proposal = view.meeting.activeProposal;
  const { centre } = MEETING_TABLE;
  const zoneClass = useZoneClass("meeting-room");

  return (
    <g className={`plan-room room-meeting ${zoneClass}`}>
      <rect {...MEETING_ROOM} className="floor" />

      <Whiteboard rect={MEETING_FIXTURES.whiteboard} />
      <Whiteboard rect={MEETING_FIXTURES.credenza} />
      <Plant at={MEETING_FIXTURES.plant} radius={16} />

      <OvalTable
        centre={centre}
        radiusX={MEETING_TABLE.radiusX}
        radiusY={MEETING_TABLE.radiusY}
      />

      {SEATS.map((seat) => (
        <Chair
          key={seat.index}
          at={seat.position}
          size={30}
          facing={
            seat.edge === "west" ? 90 : seat.edge === "east" ? -90 : seat.edge === "north" ? 180 : 0
          }
        />
      ))}

      {/* The candidate on the table. Nothing is drawn until one exists. */}
      {proposal ? (
        <g className="table-document">
          <rect x={centre.x - 46} y={centre.y - 32} width={92} height={64} rx={4} />
          <line x1={centre.x - 30} y1={centre.y - 12} x2={centre.x + 30} y2={centre.y - 12} />
          <line x1={centre.x - 30} y1={centre.y} x2={centre.x + 30} y2={centre.y} />
          <line x1={centre.x - 30} y1={centre.y + 12} x2={centre.x + 12} y2={centre.y + 12} />
        </g>
      ) : (
        <text x={centre.x} y={centre.y} className="table-empty">
          No candidate yet
        </text>
      )}

      <text x={centre.x} y={MEETING_ROOM.y + 42} className="room-label room-label-major">
        Meeting room
      </text>
    </g>
  );
}

function ConstraintCardShape({ card }: { card: PlanConstraintCard }) {
  if (card.slot === null) return null;
  const rect = constraintCardRect(card.slot);

  return (
    <g className="constraint-card">
      <rect {...rect} rx={4} className="card-body" />
      <rect x={rect.x} y={rect.y} width={rect.width} height={6} rx={3} fill={card.color} />
      <text x={rect.x + 10} y={rect.y + 26} className="card-category">
        {card.category}
      </text>
      <text x={rect.x + 10} y={rect.y + 46} className="card-owner">
        {card.ownerInitials}
      </text>
    </g>
  );
}

function ConstraintWallRoom({ view }: { view: FloorPlanState }) {
  const centre = rectCentre(CONSTRAINT_WALL);
  const zoneClass = useZoneClass("constraint-wall");

  return (
    <g className={`plan-room room-constraints ${zoneClass}`}>
      <rect {...CONSTRAINT_WALL} className="floor" />
      <rect {...CONSTRAINT_BOARD.band} className="hatch-band" />

      {view.constraintCards.map((card) => (
        <ConstraintCardShape key={card.id} card={card} />
      ))}

      {view.constraintCards.length === 0 ? (
        <text x={centre.x} y={centre.y} className="table-empty">
          No constraints published yet
        </text>
      ) : null}

      <text
        x={CONSTRAINT_WALL.x + 24}
        y={CONSTRAINT_WALL.y + 30}
        className="room-label room-label-start"
      >
        Constraint wall
        {view.constraintOverflow > 0 ? ` · +${view.constraintOverflow} more` : ""}
      </text>
    </g>
  );
}

function CommonAreaRoom({ view }: { view: FloorPlanState }) {
  const board = COMMON_FIXTURES.noticeBoard;
  const { blockingCount, warningCount } = view.common;

  const signals: Array<{ label: string; value: string; tone: string }> = [
    {
      label: "Open issues",
      value: String(blockingCount + warningCount),
      tone: blockingCount > 0 ? "risk" : warningCount > 0 ? "warn" : "calm",
    },
    {
      label: "Published",
      value: `${view.common.publishedCount}/${view.common.seatedCount}`,
      tone: "calm",
    },
    {
      label: "Approved",
      value: `${Math.round(view.consensus.approvalProgress * 100)}%`,
      tone: "calm",
    },
  ];

  return (
    <g className={`plan-room room-common ${useZoneClass("common-area")}`}>
      <rect {...COMMON_AREA} className="floor" />

      <g className="notice-board">
        <rect {...board} rx={4} className="board-body" />
        {signals.map((signal, index) => {
          const width = board.width / signals.length;
          const x = board.x + width * index;
          return (
            <g key={signal.label} className={`signal tone-${signal.tone}`}>
              {index > 0 ? (
                <line x1={x} y1={board.y + 12} x2={x} y2={board.y + board.height - 12} />
              ) : null}
              <text x={x + width / 2} y={board.y + 32} className="signal-value">
                {signal.value}
              </text>
              <text x={x + width / 2} y={board.y + 54} className="signal-label">
                {signal.label}
              </text>
            </g>
          );
        })}
      </g>

      <Couch rect={COMMON_FIXTURES.couchNorth} />
      <Couch rect={COMMON_FIXTURES.couchSouth} />
      <CoffeeTable rect={COMMON_FIXTURES.coffeeTable} />
      <Counter rect={COMMON_FIXTURES.counter} />
      <Plant at={COMMON_FIXTURES.plant} radius={15} />

      <text
        x={COMMON_AREA.x + 24}
        y={COMMON_AREA.y + COMMON_AREA.height - 20}
        className="room-label room-label-start"
      >
        Common area
      </text>
    </g>
  );
}

/* -------------------------------------------------------------------------
 * Conflicts
 * ---------------------------------------------------------------------- */

/**
 * A conflict is a link between a constraint and the candidate on the table.
 *
 * Severity is carried by line style and an end marker as well as by colour:
 * blocking is a solid heavy line ending in a bar, a warning is a light dashed
 * line ending in a dot.
 */
function ConflictLinks({ view }: { view: FloorPlanState }) {
  const table = MEETING_TABLE.centre;
  const slotById = new Map(view.constraintCards.map((card) => [card.id, card.slot]));

  return (
    <g className="plan-conflicts">
      {view.common.openConflicts.map((conflict) => {
        const slot = conflict.constraintId ? slotById.get(conflict.constraintId) : null;
        if (slot === null || slot === undefined) return null;
        const from = rectCentre(constraintCardRect(slot));

        return (
          <g key={conflict.id} className={`conflict is-${conflict.severity}`}>
            <path d={`M ${from.x} ${from.y} L ${table.x} ${table.y}`} />
            <circle cx={from.x} cy={from.y} r={conflict.severity === "blocking" ? 7 : 5} />
          </g>
        );
      })}
    </g>
  );
}

/* -------------------------------------------------------------------------
 * Selection
 * ---------------------------------------------------------------------- */

function ZoneHit({
  zone,
  rect,
  label,
}: {
  zone: PlanZoneId;
  rect: PlanRect;
  label: string;
}) {
  const { selected, select, setHovered } = usePlanSelection();
  const isSelected = selected === zone;

  return (
    <g
      className={`plan-hit-zone${isSelected ? " is-selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={label}
      onClick={() => select(zone)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select(zone);
        }
      }}
      onPointerEnter={() => setHovered(zone)}
      onPointerLeave={() => setHovered(null)}
    >
      <rect {...inset(rect, 4)} className="plan-hit" />
    </g>
  );
}

/* -------------------------------------------------------------------------
 * Canvas
 * ---------------------------------------------------------------------- */

export function PlanCanvas({ view }: { view: FloorPlanState }) {
  const { zoom, selected, hovered } = usePlanSelection();
  const [paneRef, fit] = useFitScale();
  const onPointerDown = useDragPan(paneRef);

  const scale = fit * (zoom / 100);

  return (
    <div className="plan-pane" ref={paneRef} onPointerDown={onPointerDown}>
      <svg
        className="plan-svg"
        viewBox={`0 0 ${PLAN_VIEWBOX.width} ${PLAN_VIEWBOX.height}`}
        width={PLAN_VIEWBOX.width * scale}
        height={PLAN_VIEWBOX.height * scale}
        data-selected={selected ?? "none"}
        data-hovered={hovered ?? "none"}
        aria-label={`Floor plan of ${view.title}. Every room is also listed in the room navigation.`}
        role="group"
      >
        <rect {...BUILDING_OUTLINE} className="plan-slab" />
        {CORRIDORS.map((corridor, index) => (
          <rect key={index} {...corridor} className="plan-corridor" />
        ))}
        <Stairs rect={STAIRS} />

        {view.offices.map((office) => (
          <OfficeRoom key={office.index} office={office} />
        ))}
        <MeetingRoom view={view} />
        <ConstraintWallRoom view={view} />
        <CommonAreaRoom view={view} />

        <Walls />
        <Doors />
        <ConflictLinks view={view} />

        <g className="plan-people">
          {view.participants.map((person) => (
            <PlanAvatarPuck key={person.id} person={person} />
          ))}
        </g>

        <g className="plan-hits">
          {view.offices.map((office) => {
            const placement = PLACEMENTS[office.index];
            if (!placement) return null;
            return (
              <ZoneHit
                key={office.index}
                zone={office.zoneId}
                rect={placement.rect}
                label={
                  office.participant
                    ? `Office ${office.index + 1}, ${office.participant.name}, ${office.participant.role}`
                    : `Office ${office.index + 1}, reserved`
                }
              />
            );
          })}
          <ZoneHit zone="meeting-room" rect={MEETING_ROOM} label={zoneLabel("meeting-room")} />
          <ZoneHit
            zone="constraint-wall"
            rect={CONSTRAINT_WALL}
            label={`${zoneLabel("constraint-wall")}, ${view.constraintCards.length} published`}
          />
          <ZoneHit zone="common-area" rect={COMMON_AREA} label={zoneLabel("common-area")} />
        </g>
      </svg>
    </div>
  );
}
