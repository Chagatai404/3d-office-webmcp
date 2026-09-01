"use client";

import { useEffect, useRef, useState } from "react";
import { AlignmentWorkspace } from "@/components/room/alignment-workspace";
import { CoordinationStatus } from "@/components/room/coordination-status";
import { DecisionWorkspace } from "@/components/room/decision-workspace";
import { IssuesWorkspace } from "@/components/room/issues-workspace";
import { PositionsPanel } from "@/components/room/positions-panel";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { useRoom } from "@/components/room/room-provider";
import { WhiteboardWorkspace } from "@/components/room/whiteboard-workspace";
import { WORKSPACE_LABEL, type WorkspaceId } from "@/visualization/scene/camera-poses";
import { useShell } from "./shell-provider";
import type { RoomState } from "@/contracts/room";

/**
 * The six board workspaces that used to share the centred `workspace-stage`
 * modal, now on a side rail instead: the room and its board stay visible
 * (camera framing for these six is tuned in `camera-poses.ts` to leave the
 * opposite half of the frame clear), and each gets one tab per seated
 * participant -- so what any one person put on the table is a single click
 * away, instead of scrolling a long shared list -- plus a highlighted tab
 * for the viewer's own input. Brief and Room get no panel at all: the brief
 * board already carries its full text, so pressing it is only a camera move
 * to read it up close.
 */
type SidePanelWorkspaceId = "constraints" | "proposals" | "issues" | "whiteboard" | "alignment" | "decision";

const SIDE_PANEL_WORKSPACES = new Set<WorkspaceId>([
  "constraints",
  "proposals",
  "issues",
  "whiteboard",
  "alignment",
  "decision",
]);

function isSidePanelWorkspace(workspace: WorkspaceId): workspace is SidePanelWorkspaceId {
  return SIDE_PANEL_WORKSPACES.has(workspace);
}

/** Constraints/whiteboard/alignment sit on the room's left wall or corner; proposals/issues/decision sit on the right. The panel takes the opposite side, so it never covers the board it is about. */
const PANEL_SIDE: Record<SidePanelWorkspaceId, "left" | "right"> = {
  constraints: "right",
  whiteboard: "right",
  alignment: "right",
  proposals: "left",
  issues: "left",
  decision: "left",
};

export interface TabDef {
  id: string;
  label: string;
  highlighted?: boolean;
}

const INPUT_LABEL: Record<SidePanelWorkspaceId, string> = {
  constraints: "Your input",
  proposals: "Your input",
  issues: "Your input",
  whiteboard: "Add a source",
  alignment: "Your input",
  decision: "Your input",
};

function tabsFor(workspace: SidePanelWorkspaceId, room: RoomState): TabDef[] {
  // Once the room is finalized there is one shared artifact and nothing left
  // to switch between, so Decision's tab strip goes away with it.
  if (workspace === "decision" && room.phase === "finalized") return [];

  const participantTabs = room.participants
    .filter((participant) => participant.status === "active")
    .map((participant) => ({ id: participant.id, label: participant.name }));

  return [...participantTabs, { id: "input", label: INPUT_LABEL[workspace], highlighted: true }];
}

/** Which participant a pressed board item belongs to, so the panel can open straight on their tab. */
function ownerOfItem(workspace: SidePanelWorkspaceId, room: RoomState, itemId: string): string | null {
  switch (workspace) {
    case "constraints":
      return room.constraints.find((candidate) => candidate.id === itemId)?.participantId ?? null;
    case "proposals":
      return room.proposals.find((candidate) => candidate.id === itemId)?.participantId ?? null;
    case "issues":
      return room.conflicts.find((candidate) => candidate.id === itemId)?.raisedByActorId ?? null;
    case "whiteboard":
      return room.sources.find((candidate) => candidate.id === itemId)?.uploadedByParticipantId ?? null;
    case "alignment":
    case "decision":
      return null;
  }
}

export function BoardSidePanel() {
  const { room } = useRoom();
  const { openPanel, closeWorkspacePanel, reducedMotion } = useShell();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [resolvedForNonce, setResolvedForNonce] = useState<number | null>(null);

  function slideTabs(direction: -1 | 1) {
    tabsRef.current?.scrollBy({ left: direction * 160, behavior: reducedMotion ? "auto" : "smooth" });
  }

  const workspace = openPanel?.workspace ?? null;
  const itemId = openPanel?.itemId ?? null;
  const nonce = openPanel?.nonce ?? null;
  const inScope = workspace !== null && isSidePanelWorkspace(workspace);

  const tabs = inScope ? tabsFor(workspace as SidePanelWorkspaceId, room) : [];

  // A fresh opening starts on the first participant's tab, unless a board
  // press named an item with a known owner -- then it opens straight on
  // their tab, so the row a person pressed on the wall is not one extra
  // click away. Resolved during render (React's documented way to adjust
  // state when an identity like `nonce` changes) rather than in an effect,
  // so there is no extra frame at the wrong tab before it settles.
  if (inScope && nonce !== null && nonce !== resolvedForNonce) {
    let initial = tabs[0]?.id ?? null;
    if (itemId) {
      const owner = ownerOfItem(workspace as SidePanelWorkspaceId, room, itemId);
      if (owner && tabs.some((candidate) => candidate.id === owner)) initial = owner;
    }
    setResolvedForNonce(nonce);
    setActiveTab(initial);
  }

  const resolvedTab = activeTab && tabs.some((tab) => tab.id === activeTab) ? activeTab : (tabs[0]?.id ?? "input");

  // Same board-item marking `WorkspacePanel` does: find the pressed row inside
  // whichever tab is now showing, and scroll to it. Re-runs after a tab
  // switch, since the row only exists in the DOM once its tab is active.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || nonce === null) return;

    const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-board-item]"));
    for (const row of rows) delete row.dataset.boardFocus;
    if (!itemId) return;

    const match = rows.find((row) => row.dataset.boardItem === itemId);
    if (!match) return;

    match.dataset.boardFocus = "on";
    match.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });

    return () => {
      delete match.dataset.boardFocus;
    };
  }, [nonce, itemId, resolvedTab, reducedMotion]);

  if (!inScope || !workspace) return null;

  const content = (() => {
    switch (workspace) {
      case "constraints":
        return <PositionsPanel tab={resolvedTab} />;
      case "proposals":
        return <ProposalsWorkspace tab={resolvedTab} />;
      case "issues":
        return <IssuesWorkspace tab={resolvedTab} />;
      case "whiteboard":
        return <WhiteboardWorkspace tab={resolvedTab} />;
      case "alignment":
        return <AlignmentWorkspace tab={resolvedTab} />;
      case "decision":
        return <DecisionWorkspace tab={resolvedTab} />;
      default:
        return null;
    }
  })();

  const side = PANEL_SIDE[workspace as SidePanelWorkspaceId];

  return (
    <aside
      className={side === "left" ? "board-panel board-panel-left" : "board-panel board-panel-right"}
      role="dialog"
      aria-label={WORKSPACE_LABEL[workspace]}
      key={workspace}
    >
      <div className="board-panel-head">
        <h2 className="board-panel-title">{WORKSPACE_LABEL[workspace]}</h2>
        <button
          type="button"
          className="board-panel-close"
          aria-label={`Close ${WORKSPACE_LABEL[workspace]}`}
          onClick={closeWorkspacePanel}
        >
          ✕
        </button>
      </div>

      <CoordinationStatus variant="strip" />

      {tabs.length > 1 ? (
        <div className="board-panel-tabs-row">
          <button
            type="button"
            className="board-panel-tabs-slide"
            aria-label="Show earlier tabs"
            onClick={() => slideTabs(-1)}
          >
            ‹
          </button>
          <div
            className="board-panel-tabs"
            role="tablist"
            ref={tabsRef}
            aria-label={`${WORKSPACE_LABEL[workspace]} sections`}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={resolvedTab === tab.id}
                className={tab.highlighted ? "board-panel-tab board-panel-tab-input" : "board-panel-tab"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="board-panel-tabs-slide"
            aria-label="Show later tabs"
            onClick={() => slideTabs(1)}
          >
            ›
          </button>
        </div>
      ) : null}

      <div className="board-panel-body" ref={bodyRef}>
        {content}
      </div>
    </aside>
  );
}
