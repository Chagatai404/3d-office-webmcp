import type { PlanPoint, PlanRect } from "@/floorplan/floorplan-layout";

/**
 * Line-art furniture, drawn the way a floor plan draws it: thin outlines, no
 * fill beyond the floor colour, and no detail that would not survive being
 * printed at A3.
 *
 * Every primitive takes plain geometry so the canvas stays declarative and the
 * layout module stays the only source of coordinates.
 */

function round(rect: PlanRect, radius = 3) {
  return { ...rect, rx: radius };
}

export function Desk({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect)} />
      {/* Drawer bank, drawn as a divided end of the desk. */}
      <line
        x1={rect.x + rect.width - 30}
        y1={rect.y}
        x2={rect.x + rect.width - 30}
        y2={rect.y + rect.height}
      />
      <line
        x1={rect.x + rect.width - 30}
        y1={rect.y + rect.height / 2}
        x2={rect.x + rect.width}
        y2={rect.y + rect.height / 2}
      />
    </g>
  );
}

export function Monitor({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect, 2)} />
      <line
        x1={rect.x + rect.width / 2}
        y1={rect.y + rect.height}
        x2={rect.x + rect.width / 2}
        y2={rect.y + rect.height + 6}
      />
    </g>
  );
}

/**
 * A task chair from above: a seat pad with a curved back on the far edge.
 *
 * `facing` is the direction the sitter looks, in degrees clockwise from north.
 */
export function Chair({
  at,
  facing = 0,
  size = 26,
}: {
  at: PlanPoint;
  facing?: number;
  size?: number;
}) {
  const half = size / 2;
  return (
    <g className="fx-line" transform={`rotate(${facing} ${at.x} ${at.y})`}>
      <rect
        x={at.x - half}
        y={at.y - half}
        width={size}
        height={size}
        rx={5}
      />
      <path
        d={`M ${at.x - half} ${at.y + half - 3} A ${half} ${half} 0 0 0 ${at.x + half} ${at.y + half - 3}`}
      />
    </g>
  );
}

export function Shelf({ rect }: { rect: PlanRect }) {
  const divisions = 3;
  return (
    <g className="fx-line">
      <rect {...round(rect, 2)} />
      {Array.from({ length: divisions - 1 }, (_unused, index) => {
        const x = rect.x + (rect.width / divisions) * (index + 1);
        return <line key={index} x1={x} y1={rect.y} x2={x} y2={rect.y + rect.height} />;
      })}
    </g>
  );
}

/** The little potted-plant doodle the reference scatters through its plan. */
export function Plant({ at, radius = 13 }: { at: PlanPoint; radius?: number }) {
  const petals = 5;
  return (
    <g className="fx-line">
      <circle cx={at.x} cy={at.y} r={radius * 0.32} />
      {Array.from({ length: petals }, (_unused, index) => {
        const angle = (index / petals) * Math.PI * 2 - Math.PI / 2;
        const cx = at.x + Math.cos(angle) * radius * 0.6;
        const cy = at.y + Math.sin(angle) * radius * 0.6;
        return <ellipse key={index} cx={cx} cy={cy} rx={radius * 0.42} ry={radius * 0.3}
          transform={`rotate(${(angle * 180) / Math.PI} ${cx} ${cy})`} />;
      })}
    </g>
  );
}

export function OvalTable({
  centre,
  radiusX,
  radiusY,
}: {
  centre: PlanPoint;
  radiusX: number;
  radiusY: number;
}) {
  return (
    <g className="fx-table">
      <ellipse cx={centre.x} cy={centre.y} rx={radiusX} ry={radiusY} />
      <ellipse
        cx={centre.x}
        cy={centre.y}
        rx={radiusX - 12}
        ry={radiusY - 12}
        className="fx-table-inner"
      />
    </g>
  );
}

export function Couch({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect, 6)} />
      <line x1={rect.x + 8} y1={rect.y + 10} x2={rect.x + rect.width - 8} y2={rect.y + 10} />
      <line
        x1={rect.x + rect.width / 2}
        y1={rect.y + 10}
        x2={rect.x + rect.width / 2}
        y2={rect.y + rect.height}
      />
    </g>
  );
}

export function CoffeeTable({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect, 10)} />
    </g>
  );
}

/** Kitchenette counter with a sink, straight out of the reference's plan. */
export function Counter({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect, 2)} />
      <circle cx={rect.x + rect.width - 32} cy={rect.y + rect.height / 2} r={9} />
      <line
        x1={rect.x + rect.width - 32}
        y1={rect.y + 4}
        x2={rect.x + rect.width - 32}
        y2={rect.y + rect.height / 2 - 9}
      />
    </g>
  );
}

export function Whiteboard({ rect }: { rect: PlanRect }) {
  return (
    <g className="fx-line">
      <rect {...round(rect, 1)} />
    </g>
  );
}

/** Stair run: treads plus the direction-of-travel arrow. */
export function Stairs({ rect }: { rect: PlanRect }) {
  const treads = 8;
  return (
    <g className="fx-line">
      <rect {...round(rect, 1)} />
      {Array.from({ length: treads - 1 }, (_unused, index) => {
        const x = rect.x + (rect.width / treads) * (index + 1);
        return <line key={index} x1={x} y1={rect.y} x2={x} y2={rect.y + rect.height} />;
      })}
      <path
        d={`M ${rect.x + 10} ${rect.y + rect.height / 2} L ${rect.x + rect.width - 10} ${rect.y + rect.height / 2}`}
        className="fx-arrow"
      />
      <path
        d={`M ${rect.x + rect.width - 18} ${rect.y + rect.height / 2 - 5} L ${rect.x + rect.width - 10} ${rect.y + rect.height / 2} L ${rect.x + rect.width - 18} ${rect.y + rect.height / 2 + 5}`}
        className="fx-arrow"
      />
    </g>
  );
}
