"use client";

import type { ReactNode } from "react";
import { ActivityLedger } from "@/components/room/activity-ledger";
import { DecisionPanel } from "@/components/room/decision-panel";
import { MeetingBrief } from "@/components/room/meeting-brief";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { PositionsPanel } from "@/components/room/positions-panel";
import { RoomStatusPanel } from "@/components/room/room-status";
import type { SceneZoneId } from "@/visualization/scene/scene-focus";
import { NavigationGuide } from "./navigation-guide";
import type { WindowId } from "./window-state";

/**
 * What each window is: its title, its dock button, the panel inside it, and
 * the place in the office it belongs to.
 *
 * The panels themselves are untouched by the shell. A window is chrome around
 * an existing 2D panel, which is why the same components still work outside a
 * window — as the tests mount them.
 */

export interface WindowDefinition {
  id: WindowId;
  title: string;
  /** Shown in the dock beside the title. */
  glyph: string;
  /** One line of what the window is for, used as the dock button's title. */
  hint: string;
  /** Opening this window also flies the camera to this place. */
  zone: SceneZoneId | null;
  render(): ReactNode;
}

export const WINDOW_DEFINITIONS: readonly WindowDefinition[] = [
  {
    id: "brief",
    title: "Decision brief",
    glyph: "◎",
    hint: "What this room is deciding",
    zone: "meeting-room",
    render: () => <MeetingBrief />,
  },
  {
    id: "decision",
    title: "Decision workbench",
    glyph: "◇",
    hint: "Proposals, objections, votes, approval, and record",
    zone: "meeting-room",
    render: () => <DecisionPanel />,
  },
  {
    id: "participants",
    title: "Participants & offices",
    glyph: "◍",
    hint: "Who is in the room and what they hold",
    zone: null,
    render: () => <ParticipantPanel />,
  },
  {
    id: "positions",
    title: "Positions & constraints",
    glyph: "▤",
    hint: "Published positions, and your own",
    zone: "constraint-wall",
    render: () => <PositionsPanel />,
  },
  {
    id: "activity",
    title: "Activity & audit ledger",
    glyph: "⏱",
    hint: "Every action, and where it came from",
    zone: "common-area",
    render: () => <ActivityLedger />,
  },
  {
    id: "status",
    title: "Phase & room status",
    glyph: "⬡",
    hint: "The six phases and where the room sits",
    zone: null,
    render: () => <RoomStatusPanel />,
  },
  {
    id: "guide",
    title: "Getting around",
    glyph: "✳",
    hint: "How to move the camera and the windows",
    zone: null,
    render: () => <NavigationGuide />,
  },
];

const BY_ID = new Map(
  WINDOW_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function windowDefinition(id: WindowId): WindowDefinition {
  const definition = BY_ID.get(id);
  if (!definition) throw new Error(`No window is registered as "${id}".`);
  return definition;
}
