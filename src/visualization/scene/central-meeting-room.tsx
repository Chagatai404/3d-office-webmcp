"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { DoubleSide, type Mesh, type MeshBasicMaterial, type MeshStandardMaterial } from "three";
import type { RoomVisualizationState } from "@/visualization/room-view-model";
import type { WorkspaceId } from "./camera-poses";
import { Board } from "./board";
import {
  BOARDS,
  DECISION_PEDESTAL_POSITION,
  meetingSeats,
  ROOM,
  SURFACE,
  tableRadius,
  VOTE_PLINTH_POSITION,
} from "./meeting-room-layout";
import { ParticipantAvatar } from "./participant-avatar";
import { SelectableZone } from "./scene-interaction";

/**
 * The collective decision space — one bright, glass-walled room.
 *
 * Transcribed from the imported design (`meeting-stage.js`): a floor inlay
 * and table at the centre, a wall board per decision workspace, an alignment
 * plinth and a decision pedestal further back. Nothing in this subtree
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
            <SeatCushion accent={participant.isSelf} />
            <ParticipantAvatar participant={participant} color={SURFACE.seatDark} pose="sitting" />
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
            cardCount={4}
            columns={2}
            cardColor="#dedad0"
            active={activeWorkspace === "whiteboard"}
          />
        </group>
      </SelectableZone>

      <SelectableZone
        zone="alignment"
        highlight={{ size: [2.7, 1.5], position: [VOTE_PLINTH_POSITION[0], 0.05, VOTE_PLINTH_POSITION[2]] }}
      >
        <AlignmentPlinth view={view} />
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
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.16, depth]} />
        <meshStandardMaterial color={SURFACE.floor} roughness={0.95} />
      </mesh>
      {/* Lifted clear of the floor slab with a polygon offset — coplanar, the
          two faces z-fought and flashed white as the camera moved. */}
      <mesh position={[0, 0.195, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[4.6, 48]} />
        <meshStandardMaterial
          color={SURFACE.inlay}
          roughness={0.98}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  );
}

/** A slim dark frame around three enclosed glass sides; the front stays open. */
function GlassShell({ width: W, depth: D, height: H }: { width: number; depth: number; height: number }) {
  const beam = (w: number, h: number, d: number, x: number, y: number, z: number, key: string) => (
    <mesh key={key} position={[x, y, z]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={SURFACE.frame} roughness={0.6} />
    </mesh>
  );

  const sideMullions = [-W / 2, W / 2].flatMap((x) =>
    [-2, -1, 0, 1, 2].map((i) => beam(0.1, H, 0.1, x, H / 2 + 0.16, (i * D) / 5.4, `side-${x}-${i}`)),
  );
  const backMullions = [-3, -2, -1, 0, 1, 2, 3].map((i) =>
    beam(0.1, H, 0.1, (i * W) / 7.4, H / 2 + 0.16, -D / 2, `back-${i}`),
  );
  const corners = [-W / 2, W / 2].flatMap((x) =>
    [-D / 2, D / 2].map((z) => beam(0.16, H + 0.4, 0.16, x, (H + 0.4) / 2, z, `corner-${x}-${z}`)),
  );

  return (
    <group>
      <mesh position={[0, H / 2 + 0.16, -D / 2]}>
        <boxGeometry args={[W, H, 0.05]} />
        <meshPhysicalMaterial
          color={SURFACE.glass}
          roughness={0.06}
          transparent
          opacity={0.16}
          transmission={0.72}
          thickness={0.3}
        />
      </mesh>
      <mesh position={[-W / 2, H / 2 + 0.16, 0]}>
        <boxGeometry args={[0.05, H, D]} />
        <meshPhysicalMaterial
          color={SURFACE.glass}
          roughness={0.06}
          transparent
          opacity={0.16}
          transmission={0.72}
          thickness={0.3}
        />
      </mesh>
      <mesh position={[W / 2, H / 2 + 0.16, 0]}>
        <boxGeometry args={[0.05, H, D]} />
        <meshPhysicalMaterial
          color={SURFACE.glass}
          roughness={0.06}
          transparent
          opacity={0.16}
          transmission={0.72}
          thickness={0.3}
        />
      </mesh>
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

      {/* A recessed rim, not a slab flush with the floor: coplanar tops
          z-fought and flashed the floor white when the camera pulled back. */}
      {beam(W + 0.3, 0.2, D + 0.3, 0, 0.04, 0, "base")}
      {beam(W + 0.3, 0.16, 0.2, 0, H + 0.24, -D / 2 - 0.05, "cap-back")}
      {beam(W + 0.3, 0.16, 0.2, 0, H + 0.24, D / 2 + 0.05, "cap-front")}
      {beam(0.2, 0.16, D + 0.3, -W / 2 - 0.05, H + 0.24, 0, "cap-left")}
      {beam(0.2, 0.16, D + 0.3, W / 2 + 0.05, H + 0.24, 0, "cap-right")}
      {corners}
      {sideMullions}
      {backMullions}
    </group>
  );
}

function MeetingTable({ radius }: { radius: number }) {
  return (
    <group position={[0, 0.16, 0]}>
      <mesh position={[0, 0.78, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[radius, radius, 0.1, 56]} />
        <meshStandardMaterial color={SURFACE.tableTop} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.38, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.42, 0.72, 24]} />
        <meshStandardMaterial color={SURFACE.tableBase} roughness={0.75} />
      </mesh>
    </group>
  );
}

/** Cushion, backrest, stem, and a nameplate lit for the seat that is you. */
function SeatCushion({ accent }: { accent: boolean }) {
  const plateColor = accent ? SURFACE.accent : SURFACE.card;

  return (
    <group>
      <mesh position={[0, 0.44, 0]} castShadow>
        <boxGeometry args={[0.72, 0.12, 0.72]} />
        <meshStandardMaterial color={SURFACE.seat} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.75, -0.31]} castShadow>
        <boxGeometry args={[0.72, 0.62, 0.1]} />
        <meshStandardMaterial color={SURFACE.seat} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.14, 0.44, 16]} />
        <meshStandardMaterial color={SURFACE.seatDark} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.7, 1.05]} rotation={[-0.35, 0, 0]} castShadow>
        <boxGeometry args={[0.66, 0.02, 0.2]} />
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

/**
 * Compact, informative alignment tallies — never a vote count. Bar heights
 * are read-only awareness cues (who leans which way), not a decision
 * mechanism: nothing in the product treats "more support bars" as an outcome.
 */
function AlignmentPlinth({ view }: { view: RoomVisualizationState }) {
  const tallies = useMemo(() => {
    const counts = { support: 0, concern: 0, strong_objection: 0, needs_clarification: 0 };
    for (const participant of view.participants) {
      if (participant.alignment) counts[participant.alignment] += 1;
    }
    return counts;
  }, [view.participants]);

  const max = Math.max(1, ...Object.values(tallies));
  const bars: Array<{ key: keyof typeof tallies; color: string }> = [
    { key: "support", color: SURFACE.accent },
    { key: "concern", color: SURFACE.attention },
    { key: "strong_objection", color: SURFACE.seatDark },
    { key: "needs_clarification", color: SURFACE.quiet },
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
