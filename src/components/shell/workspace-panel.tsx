"use client";

import { useEffect, useRef } from "react";
import { AlignmentWorkspace } from "@/components/room/alignment-workspace";
import { DecisionWorkspace } from "@/components/room/decision-workspace";
import { IssuesWorkspace } from "@/components/room/issues-workspace";
import { MeetingBrief } from "@/components/room/meeting-brief";
import { PositionsPanel } from "@/components/room/positions-panel";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { WhiteboardWorkspace } from "@/components/room/whiteboard-workspace";
import { WORKSPACE_LABEL } from "@/visualization/scene/camera-poses";
import { useShell } from "./shell-provider";

/**
 * Layer 3's workspace surface: whichever one workspace is currently open.
 *
 * It used to be a rail down the right-hand edge, which is what made every
 * workspace read as cramped — a decision brief, a constraints board and a
 * proposal form are not 25rem-wide things. It is now a wide card centred over
 * the scene, opened by pressing a board (or its dock tab) and dismissed by
 * Escape, the close button, or the scrim. The room stays visible behind it
 * rather than being replaced by a page: the toolbar above and the dock below
 * are never covered, so you can always see where you are and step somewhere
 * else in one press.
 *
 * Never more than one at a time, per the product's "one cognitive context"
 * rule. Room has no card here — its content is the ambient summary strip
 * instead, since the room itself is the home state, not a workspace to open.
 */
export function WorkspacePanel() {
  const { openPanel, closeWorkspacePanel, reducedMotion } = useShell();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const workspace = openPanel?.workspace ?? null;
  const itemId = openPanel?.itemId ?? null;
  const nonce = openPanel?.nonce ?? null;

  // Opening moves keyboard focus into the card, so the panel a board press
  // just put over the room is also where the next Tab goes.
  useEffect(() => {
    if (nonce === null) return;
    cardRef.current?.focus({ preventScroll: true });
  }, [nonce]);

  /*
   * Pressing one constraint on the wall should land on *that* constraint, not
   * at the top of a long workspace. The panels tag their rows with the room
   * id they render (`data-board-item`); this finds the tagged row and marks
   * it, and the rows are read rather than matched with a selector so an id
   * containing selector syntax can never break the lookup.
   *
   * Where a panel does not render the pressed item at all — a superseded
   * proposal, say, which the Proposals workspace does not list — nothing is
   * found and the workspace simply opens at the top, which is the honest
   * outcome rather than a broken one.
   */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || nonce === null) return;

    const rows = Array.from(
      body.querySelectorAll<HTMLElement>("[data-board-item]"),
    );
    for (const row of rows) delete row.dataset.boardFocus;
    if (!itemId) return;

    const match = rows.find((row) => row.dataset.boardItem === itemId);
    if (!match) return;

    match.dataset.boardFocus = "on";
    match.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "center",
    });

    return () => {
      delete match.dataset.boardFocus;
    };
  }, [nonce, itemId, reducedMotion]);

  if (!workspace) return null;

  const content = (() => {
    switch (workspace) {
      case "room":
        return null;
      case "brief":
        return <MeetingBrief />;
      case "constraints":
        return <PositionsPanel />;
      case "proposals":
        return <ProposalsWorkspace />;
      case "issues":
        return <IssuesWorkspace />;
      case "whiteboard":
        return <WhiteboardWorkspace />;
      case "alignment":
        return <AlignmentWorkspace />;
      case "decision":
        return <DecisionWorkspace />;
    }
  })();

  if (!content) return null;

  return (
    <div className="workspace-stage">
      {/* A button rather than a bare div so dismissing by clicking away is a
          real control: it is reachable, it is named, and it is not the only
          way out — Escape and the close button do the same thing. */}
      <button
        type="button"
        className="workspace-stage-scrim"
        aria-label={`Close ${WORKSPACE_LABEL[workspace]} and return to the room`}
        onClick={closeWorkspacePanel}
      />

      <div
        className="workspace-stage-card"
        role="dialog"
        aria-label={WORKSPACE_LABEL[workspace]}
        tabIndex={-1}
        ref={cardRef}
        key={workspace}
      >
        <button
          type="button"
          className="workspace-stage-close"
          aria-label="Close"
          onClick={closeWorkspacePanel}
        >
          ✕
        </button>
        <div className="workspace-stage-body" ref={bodyRef}>
          {content}
        </div>
      </div>
    </div>
  );
}
