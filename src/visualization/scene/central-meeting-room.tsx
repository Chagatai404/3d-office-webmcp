"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";
import type { RoomVisualizationState } from "@/visualization/room-view-model";
import { WORKSPACE_LABEL, type WorkspaceId } from "./camera-poses";
import { Board } from "./board";
import {
  BOARDS,
  type BoardPlacement,
  CREDENZA,
  credenzaModules,
  DECISION_PEDESTAL_POSITION,
  FLOOR_TOP,
  meetingSeats,
  ROOM,
  RUG_BASE,
  RUG_TOP,
  SURFACE,
  tableRadius,
  VOTE_PLINTH_POSITION,
} from "./meeting-room-layout";
import { ParticipantAvatar } from "./participant-avatar";
import {
  Bookshelf,
  BookStack,
  CardboardBoxes,
  FileCabinet,
  Mug,
  Notebook,
  OfficeChair,
  Pens,
  Phone,
  Plant,
  Printer,
  RugRound,
  SodaCan,
} from "./room-props";
import { SelectableZone } from "./scene-interaction";
import { useFloorTexture, useWallTexture, useWoodTexture } from "./textures";

/**
 * The collective decision space — one bright room, open along its front.
 *
 * Transcribed from the imported design (`meeting-stage.js`): a rug and table
 * at the centre, a wall board per decision workspace, a vote plinth and a
 * decision pedestal further back. The three enclosed sides were glazed in the
 * original and are solid here, so the boards read as hung rather than
 * floating; the front is still open glass. Nothing in this subtree
 * decides anything — it renders the projection it is handed, and the boards
 * it counts cards from are real room state, not the mockup's fixed numbers.
 */
export function CentralMeetingRoom({
  view,
  activeWorkspace,
  reducedMotion,
  footing = "ground",
}: {
  view: RoomVisualizationState;
  activeWorkspace: WorkspaceId;
  reducedMotion: boolean;
  /**
   * How the room meets what it stands on. `ground` is its own open ground,
   * filling the frame. `surface` gives it no ground of its own: only the
   * shadow it casts lands on whatever it is being presented on, so the
   * welcome shot reads as a model resting on the page.
   */
  footing?: "ground" | "surface";
}) {
  const { width: W, depth: D, wallHeight: H } = ROOM;
  const seats = meetingSeats(Math.max(view.participants.length, 1));
  const table = tableRadius(view.participants.length);
  /* The nameplate belongs on the table, and the seat ring and the table grow
     at different rates (0.12 and 0.08 a head), so past four seats a plate
     placed at a fixed distance from its chair drifts off the edge and hangs
     in mid-air. Measuring from both radii keeps it a hand inside the rim at
     any seat count. */
  const seatRing = Math.hypot(seats[0]?.position[0] ?? 0, seats[0]?.position[2] ?? 0);
  const plateReach = seatRing - table + 0.22;
  const openConflicts = view.conflicts.filter((conflict) => conflict.status === "open");
  const hasBlockingConflict = openConflicts.some((conflict) => conflict.severity === "blocking");

  const activeProposalIndex = view.proposals.findIndex((proposal) => proposal.isActive);

  // The activity halo sits at whichever seat a browser agent most recently
  // acted from, so the pulse only ever claims real, recent agent activity.
  const haloSeatIndex = useMemo(() => {
    for (let i = view.recentActivity.length - 1; i >= 0; i -= 1) {
      const event = view.recentActivity[i];
      if (event && event.origin === "webmcp" && event.actorId) {
        const index = view.participants.findIndex(
          (participant) => participant.id === event.actorId,
        );
        if (index !== -1) return index;
      }
    }
    return null;
  }, [view.recentActivity, view.participants]);

  return (
    <group>
      <Floor width={W} depth={D} footing={footing} />
      <GlassShell width={W} depth={D} height={H} />

      <MeetingTable radius={tableRadius(view.participants.length)} />

      {seats.map((seat) => {
        const participant = view.participants[seat.index];
        if (!participant) return null;
        return (
          <group
            key={participant.id}
            position={seat.position}
            rotation={[0, seat.rotationY, 0]}
          >
            <Seat accent={participant.isSelf} plateReach={plateReach} />
            <ParticipantAvatar participant={participant} color={SURFACE.accent} />
          </group>
        );
      })}

      {haloSeatIndex !== null ? (
        <ActivityHalo position={seats[haloSeatIndex]?.position} reducedMotion={reducedMotion} />
      ) : null}

      <SelectableZone zone="brief" highlight={boardHighlight(BOARDS.brief)}>
        <group position={BOARDS.brief.position} rotation={[0, BOARDS.brief.rotationY, 0]}>
          <Board
            width={BOARDS.brief.width}
            height={BOARDS.brief.height}
            label={WORKSPACE_LABEL.brief}
            face={SURFACE.boardDark}
            cardCount={3}
            columns={3}
            cardColor="#413c36"
            accentIndex={0}
            active={activeWorkspace === "brief"}
          />
        </group>
      </SelectableZone>

      <SelectableZone zone="constraints" highlight={boardHighlight(BOARDS.constraints)}>
        <group position={BOARDS.constraints.position} rotation={[0, BOARDS.constraints.rotationY, 0]}>
          <Board
            width={BOARDS.constraints.width}
            height={BOARDS.constraints.height}
            label={WORKSPACE_LABEL.constraints}
            cardCount={view.constraints.length}
            columns={4}
            active={activeWorkspace === "constraints"}
          />
        </group>
      </SelectableZone>

      <SelectableZone zone="proposals" highlight={boardHighlight(BOARDS.proposals)}>
        <group position={BOARDS.proposals.position} rotation={[0, BOARDS.proposals.rotationY, 0]}>
          <Board
            width={BOARDS.proposals.width}
            height={BOARDS.proposals.height}
            label={WORKSPACE_LABEL.proposals}
            cardCount={view.proposals.length}
            columns={2}
            accentIndex={activeProposalIndex}
            active={activeWorkspace === "proposals"}
          />
        </group>
      </SelectableZone>

      <SelectableZone zone="issues" highlight={boardHighlight(BOARDS.issues)}>
        <group position={BOARDS.issues.position} rotation={[0, BOARDS.issues.rotationY, 0]}>
          <Board
            width={BOARDS.issues.width}
            height={BOARDS.issues.height}
            label={WORKSPACE_LABEL.issues}
            cardCount={openConflicts.length}
            columns={1}
            cardColor={hasBlockingConflict ? SURFACE.attention : SURFACE.quiet}
            active={activeWorkspace === "issues"}
          />
        </group>
      </SelectableZone>

      <SelectableZone zone="whiteboard" highlight={boardHighlight(BOARDS.whiteboard)}>
        <group position={BOARDS.whiteboard.position} rotation={[0, BOARDS.whiteboard.rotationY, 0]}>
          <Board
            width={BOARDS.whiteboard.width}
            height={BOARDS.whiteboard.height}
            label={WORKSPACE_LABEL.whiteboard}
            cardCount={4}
            columns={2}
            cardColor="#dedad0"
            active={activeWorkspace === "whiteboard"}
          />
        </group>
      </SelectableZone>

      {Object.entries(BOARDS).map(([id, board]) => (
        <CredenzaRun key={id} board={board} />
      ))}

      {/* The two front corners, past where the credenza runs stop. Both are
          storage rather than decoration: a room with somewhere to put things
          reads as one that gets used. Everything here stands flush to a wall
          and turns to face in, so nothing crowds the seats or the boards. */}
      <Bookshelf position={LEFT_BOOKSHELF.position} rotation={LEFT_BOOKSHELF.rotation} />
      <ShelvedBooks />
      <CardboardBoxes position={[-7.45, FLOOR_TOP, 5.15]} rotation={[0, 0.4, 0]} />
      <CardboardBoxes position={[-7.62, FLOOR_TOP, 3.95]} rotation={[0, -0.75, 0]} />

      <FileCabinet position={[8.09, FLOOR_TOP, 3.9]} rotation={[0, -Math.PI / 2, 0]} />
      <Printer position={[8.09, FLOOR_TOP + 1.25, 3.9]} rotation={[0, -Math.PI / 2, 0]} />
      <Plant position={[7.4, FLOOR_TOP, 5.2]} rotation={[0, -1.1, 0]} />

      <SelectableZone
        zone="vote"
        highlight={{ size: [2.7, 1.5], position: [VOTE_PLINTH_POSITION[0], 0.05, VOTE_PLINTH_POSITION[2]] }}
      >
        <VotePlinth view={view} />
      </SelectableZone>

      <SelectableZone
        zone="decision"
        highlight={{ size: [2.1, 1.5], position: [DECISION_PEDESTAL_POSITION[0], 0.05, DECISION_PEDESTAL_POSITION[2]] }}
      >
        <DecisionPedestal reducedMotion={reducedMotion} />
      </SelectableZone>
    </group>
  );
}

/**
 * The low cabinet run beneath a board.
 *
 * Every board in the room hung on a blank wall down to the floor, which is
 * what read as unfinished more than any missing prop did. This gives each one
 * a base, in the same rotated frame the board itself uses: the group is turned
 * to the board's own angle, so a module only has to be laid out along local X
 * and pushed forward off the wall along local Z. Furniture only — it carries
 * no state and is not selectable, so it can never be mistaken for a workspace.
 */
function CredenzaRun({ board }: { board: BoardPlacement }) {
  // One grain per door rather than one across the whole run, so the seams
  // between modules read as separate cabinets.
  const wood = useWoodTexture(SURFACE.wood);
  const body = CREDENZA.height - CREDENZA.toe;

  return (
    <group
      position={[board.position[0], FLOOR_TOP, board.position[2]]}
      rotation={[0, board.rotationY, 0]}
    >
      {credenzaModules(board.width).map((x) => (
        <group key={x} position={[x, 0, CREDENZA.depth / 2]}>
          <mesh position={[0, CREDENZA.toe + body / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[CREDENZA.module, body, CREDENZA.depth]} />
            <meshStandardMaterial color={SURFACE.wood} map={wood} roughness={0.68} />
          </mesh>
          {/* Inset, so the run reads as standing on a recess rather than
              sitting flat on the floor like the plinths do. */}
          <mesh position={[0, CREDENZA.toe / 2, 0]} castShadow>
            <boxGeometry args={[CREDENZA.module - 0.12, CREDENZA.toe, CREDENZA.depth - 0.1]} />
            <meshStandardMaterial color={SURFACE.frame} roughness={0.7} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/**
 * The left-corner bookshelf, and the books on it.
 *
 * `LEFT_BOOKSHELF` is shared so the books can be laid out in the shelf's own
 * frame: the group is turned to the same angle, so a stack only needs its
 * position across the shelf (local x), the height of the shelf it sits on
 * (local y — the model's origin is on the floor) and how far it stands off the
 * back (local z, front is +z). The three open compartments carry books; the
 * bottom shelf and the odd slot are left bare, so the run reads as one
 * somebody takes books off rather than a full set bought by the metre.
 */
const LEFT_BOOKSHELF = {
  position: [-8.22, FLOOR_TOP, 4.7] as [number, number, number],
  rotation: [0, Math.PI / 2, 0] as [number, number, number],
};

/** Which slots hold a stack: [x across the shelf, y of the shelf surface]. */
const SHELVED_BOOKS: Array<[number, number]> = [
  [-0.82, 0.58],
  [-0.34, 0.58],
  [0.82, 0.58],
  [-0.34, 1.08],
  [0.34, 1.08],
  [-0.82, 1.58],
  [0.34, 1.58],
  [0.82, 1.58],
];

function ShelvedBooks() {
  return (
    <group position={LEFT_BOOKSHELF.position} rotation={LEFT_BOOKSHELF.rotation}>
      {SHELVED_BOOKS.map(([x, y], index) => (
        <BookStack
          key={`${x}-${y}`}
          position={[x, y, 0.05]}
          rotation={[0, (index % 2 ? Math.PI : 0) + (index - 3) * 0.05, 0]}
        />
      ))}
    </group>
  );
}

/** A translucent quad matching the board's own face, for hover/select feedback. */
function boardHighlight(board: (typeof BOARDS)[keyof typeof BOARDS]) {
  return {
    size: [board.width, board.height] as [number, number],
    position: board.position,
    rotation: [0, board.rotationY, 0] as [number, number, number],
  };
}

function Floor({
  width,
  depth,
  footing,
}: {
  width: number;
  depth: number;
  footing: "ground" | "surface";
}) {
  const floor = useFloorTexture(SURFACE.floor);

  return (
    <group>
      {/* Reaches well past the camera's pull-back and fades into fog, so no
          ground edge can swing into frame from the pre-meeting poses. Sits
          low enough to clear the recessed dark rim below. Presented on a
          surface it does not own, the same plane carries only the shadow, so
          the room is grounded without painting a ground. */}
      <mesh position={[0, -0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        {footing === "ground" ? (
          <meshStandardMaterial color={SURFACE.ground} roughness={0.98} />
        ) : (
          <shadowMaterial transparent opacity={0.13} color={SURFACE.frame} />
        )}
      </mesh>
      {/* The one surface the eye spends most of its time on, so it is the one
          that most needed to stop being a single flat value. */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.16, depth]} />
        <meshStandardMaterial
          color={SURFACE.floor}
          map={floor}
          roughnessMap={floor}
          roughness={0.95}
        />
      </mesh>
      {/* Was a zero-thickness inlay disc held off the slab by a polygon
          offset. The rug is a real 30mm slab at the same 4.6m radius, so it
          clears the floor by standing on it and the offset hack is gone. */}
      <RugRound position={[0, RUG_BASE, 0]} />
    </group>
  );
}

/** A slim dark frame around three enclosed glass sides; the front stays open. */
function GlassShell({ width: W, depth: D, height: H }: { width: number; depth: number; height: number }) {
  const plaster = useWallTexture(SURFACE.wall);
  const beam = (w: number, h: number, d: number, x: number, y: number, z: number, key: string) => (
    <mesh key={key} position={[x, y, z]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={SURFACE.frame} roughness={0.6} />
    </mesh>
  );

  /* Glazing bars, so they now run only where there is glazing. On the solid
     walls they read as bars across a plastered surface, and they cut through
     the boards hung on it. */
  const frontMullions = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map((i) =>
    beam(0.09, 0.9, 0.09, (i * W) / 9.2, 0.61, D / 2, `front-${i}`),
  );
  const corners = [-W / 2, W / 2].flatMap((x) =>
    [-D / 2, D / 2].map((z) => beam(0.16, H + 0.4, 0.16, x, (H + 0.4) / 2, z, `corner-${x}-${z}`)),
  );

  return (
    <group>
      {/* The three enclosed sides are solid. They were glass, and a board hung
          on glass has nothing behind it: every board read as a panel floating
          in front of white daylight rather than as something on a wall. The
          front stays glazed — it is the side the camera looks through.

          Solid both ways, deliberately. Turning these into single-sided planes
          would cull the near wall and open the room up from any angle, but the
          welcome camera stands outside the right-hand wall, so culling it just
          exposes the back of the Proposals board hanging over the room's edge.
          A wall is the better thing to show there. */}
      <mesh position={[0, H / 2 + 0.16, -D / 2]} receiveShadow>
        <boxGeometry args={[W, H, 0.05]} />
        <meshStandardMaterial color={SURFACE.wall} map={plaster} roughness={0.94} />
      </mesh>
      <mesh position={[-W / 2, H / 2 + 0.16, 0]} receiveShadow>
        <boxGeometry args={[0.05, H, D]} />
        <meshStandardMaterial color={SURFACE.wall} map={plaster} roughness={0.94} />
      </mesh>
      <mesh position={[W / 2, H / 2 + 0.16, 0]} receiveShadow>
        <boxGeometry args={[0.05, H, D]} />
        <meshStandardMaterial color={SURFACE.wall} map={plaster} roughness={0.94} />
      </mesh>

      {/* A waist-high glazed partition, divided like one. */}
      <mesh position={[0, 0.61, D / 2]}>
        <boxGeometry args={[W, 0.9, 0.05]} />
        <meshPhysicalMaterial
          color={SURFACE.glass}
          roughness={0.06}
          transparent
          opacity={0.16}
          transmission={0.72}
          thickness={0.3}
        />
      </mesh>
      {frontMullions}

      {/* A recessed rim, not a slab flush with the floor: coplanar tops
          z-fought and flashed the floor white when the camera pulled back. */}
      {beam(W + 0.3, 0.2, D + 0.3, 0, 0.04, 0, "base")}
      {/* The cap runs on three sides only. The front edge is the one the
          camera looks through from every pose, and a rail across it read as
          the lid of a box rather than the open side of a room. The two front
          corner posts still rise past where it would have been, so the
          opening is framed without being closed. */}
      {beam(W + 0.3, 0.16, 0.2, 0, H + 0.24, -D / 2 - 0.05, "cap-back")}
      {beam(0.2, 0.16, D + 0.3, -W / 2 - 0.05, H + 0.24, 0, "cap-left")}
      {beam(0.2, 0.16, D + 0.3, W / 2 + 0.05, H + 0.24, 0, "cap-right")}
      {corners}
    </group>
  );
}

/** The table top, in the table group's own space: what sits on it stands here. */
const TABLE_TOP = 0.83;

/** The same surface in room space, for things placed outside the table group. */
const TABLE_SURFACE = FLOOR_TOP + TABLE_TOP + 0.005;

function MeetingTable({ radius }: { radius: number }) {
  const wood = useWoodTexture(SURFACE.wood);

  return (
    <group position={[0, FLOOR_TOP, 0]}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.1, 56]} />
        <meshStandardMaterial
          color={SURFACE.wood}
          map={wood}
          roughnessMap={wood}
          roughness={0.62}
        />
      </mesh>
      <mesh position={[0, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.42, 0.72, 24]} />
        <meshStandardMaterial color={SURFACE.tableBase} roughness={0.75} />
      </mesh>

      {/* What people leave on a table, in two clusters rather than spread
          evenly. Scattered singly across four and a half metres each object
          was marooned and the table still read as empty; grouped, they read
          as two places somebody is sitting at. Everything is placed off the
          table's own radius so it stays on the table as that grows with the
          seat count. */}
      <Notebook
        position={[radius * 0.5, TABLE_TOP, radius * 0.5]}
        rotation={[0, -Math.PI / 4, 0]}
      />
      <Pens position={[radius * 0.42, TABLE_TOP, radius * 0.62]} rotation={[0, -0.6, 0]} />
      <Mug position={[radius * 0.64, TABLE_TOP, radius * 0.4]} rotation={[0, Math.PI / 4, 0]} />

      <Phone position={[-radius * 0.3, TABLE_TOP, radius * 0.66]} rotation={[0, 0.25, 0]} />
      <SodaCan position={[-radius * 0.46, TABLE_TOP, radius * 0.55]} />
    </group>
  );
}

/**
 * A chair, and a nameplate lit for the seat that is you.
 *
 * The chair used to be a box on a box on a cylinder. It is the one object the
 * room repeats up to eight times, so its silhouette set the tone for the whole
 * scene, and a real one is the single biggest thing separating this room from
 * a placeholder. Only the nameplate is still procedural: it carries state —
 * which seat is yours — and state stays in geometry this file controls.
 */
function Seat({ accent, plateReach }: { accent: boolean; plateReach: number }) {
  const plateColor = accent ? SURFACE.accent : SURFACE.card;

  return (
    <group>
      <OfficeChair position={[0, RUG_TOP, 0]} />
      {/* Lying on the table top rather than tilted below it: at 0.7 it sat
          under the table, and past four seats outside it as well. */}
      <mesh position={[0, TABLE_SURFACE, plateReach]} castShadow receiveShadow>
        <boxGeometry args={[0.66, 0.012, 0.2]} />
        <meshStandardMaterial color={plateColor} roughness={0.85} />
      </mesh>
    </group>
  );
}

function ActivityHalo({
  position,
  reducedMotion,
}: {
  position: [number, number, number] | undefined;
  reducedMotion: boolean;
}) {
  const ring = useRef<Mesh>(null);
  const material = useRef<MeshBasicMaterial>(null);

  useFrame((state) => {
    if (reducedMotion || !ring.current || !material.current) return;
    const progress = (state.clock.elapsedTime * 0.5) % 1;
    ring.current.scale.setScalar(0.7 + progress * 1.3);
    material.current.opacity = 0.45 * (1 - progress);
  });

  if (!position) return null;

  return (
    <mesh
      ref={ring}
      position={[position[0], 0.19, position[2]]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[0.55, 0.68, 40]} />
      <meshBasicMaterial
        ref={material}
        color={SURFACE.accent}
        transparent
        opacity={0.4}
        side={DoubleSide}
      />
    </mesh>
  );
}

/** One bar per vote choice, height and colour reading the real tally. */
function VotePlinth({ view }: { view: RoomVisualizationState }) {
  const tallies = useMemo(() => {
    const counts = { support: 0, oppose: 0, abstain: 0, request_changes: 0 };
    for (const participant of view.participants) {
      if (participant.vote) counts[participant.vote] += 1;
    }
    return counts;
  }, [view.participants]);

  const max = Math.max(1, ...Object.values(tallies));
  const bars: Array<{ key: keyof typeof tallies; color: string }> = [
    { key: "support", color: SURFACE.accent },
    { key: "oppose", color: SURFACE.attention },
    { key: "abstain", color: SURFACE.quiet },
    { key: "request_changes", color: SURFACE.seatDark },
  ];

  return (
    <group position={VOTE_PLINTH_POSITION}>
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.5, 0.5, 1.3]} />
        <meshStandardMaterial color={SURFACE.boardLight} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.04, 0]} castShadow>
        <boxGeometry args={[2.62, 0.08, 1.42]} />
        <meshStandardMaterial color={SURFACE.frame} roughness={0.6} />
      </mesh>
      {bars.map((bar, index) => {
        const height = 0.1 + 0.62 * (tallies[bar.key] / max);
        return (
          <mesh
            key={bar.key}
            position={[-0.84 + index * 0.56, 0.5 + height / 2, 0]}
            castShadow
          >
            <boxGeometry args={[0.36, height, 0.36]} />
            <meshStandardMaterial color={bar.color} roughness={0.85} />
          </mesh>
        );
      })}
    </group>
  );
}

function DecisionPedestal({ reducedMotion }: { reducedMotion: boolean }) {
  const beacon = useRef<Mesh>(null);

  useFrame((state) => {
    const material = beacon.current?.material as MeshStandardMaterial | undefined;
    if (!material) return;
    material.emissiveIntensity = reducedMotion
      ? 0.5
      : 0.4 + Math.sin(state.clock.elapsedTime * 2.4) * 0.25;
  });

  return (
    <group position={DECISION_PEDESTAL_POSITION}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.9, 1.3]} />
        <meshStandardMaterial color={SURFACE.boardDark} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.04, 0]} castShadow>
        <boxGeometry args={[2.02, 0.08, 1.42]} />
        <meshStandardMaterial color={SURFACE.frame} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.94, 0]} rotation={[-0.22, 0, 0]} castShadow>
        <boxGeometry args={[1.3, 0.06, 0.9]} />
        <meshStandardMaterial color={SURFACE.boardLight} roughness={0.85} />
      </mesh>
      <mesh ref={beacon} position={[0, 1.24, -0.42]}>
        <sphereGeometry args={[0.11, 20, 14]} />
        <meshStandardMaterial
          color={SURFACE.accent}
          emissive={SURFACE.accent}
          emissiveIntensity={0.5}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
