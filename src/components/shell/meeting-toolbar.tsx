"use client";

import { useMemo, useState } from "react";
import { useRoom } from "@/components/room/room-provider";
import { PHASE_LABEL } from "@/components/room/room-labels";
import { MOVING_LABEL } from "@/visualization/scene/camera-poses";
import { useShell } from "./shell-provider";
import { useAttentionItems } from "./use-attention-items";

/**
 * Layer 1: persistent meeting chrome.
 *
 * Meeting name and phase on the left, agent status and help on the right —
 * minimal and always available, the way Zoom or Meet's own chrome is. Every
 * fact here is read from canonical room state; the agent count is real
 * (distinct participants with at least one recorded browser-agent action),
 * not a fixed decorative number.
 */
export function MeetingToolbar() {
  const { room, self, demoSeatClaimBlocked } = useRoom();
  const { activeWorkspace, moving, openDrawer, goToWorkspace } = useShell();
  const attentionItems = useAttentionItems();
  const [spectatorNoticeDismissed, setSpectatorNoticeDismissed] = useState(false);
  const showSpectatorNotice =
    demoSeatClaimBlocked && self === null && !spectatorNoticeDismissed;

  const sourceCount = useMemo(
    () => room.sources.filter((source) => source.status !== "removed").length,
    [room.sources],
  );
  const failedSourceCount = useMemo(
    () => room.sources.filter((source) => source.status === "failed").length,
    [room.sources],
  );

  const agentsUsed = useMemo(() => {
    const actorIds = new Set(
      room.activity
        .filter((event) => event.origin === "webmcp" && event.actorId)
        .map((event) => event.actorId as string),
    );
    return actorIds.size;
  }, [room.activity]);

  return (
    <div className="meeting-toolbar">
      <span className="toolbar-chip">
        <span className="toolbar-chip-dot" aria-hidden="true" />
        <span>{room.title}</span>
        <span className="toolbar-chip-divider" aria-hidden="true" />
        <span className="toolbar-chip-phase">{PHASE_LABEL[room.phase]}</span>
        {room.demoMode !== null ? (
          <>
            <span className="toolbar-chip-divider" aria-hidden="true" />
            <span
              className="tag tag-expert"
              title="Your teammates here are deterministic simulations for the product walkthrough. Your actions and browser-agent tools are real."
            >
              Demo room
            </span>
          </>
        ) : null}
      </span>

      {showSpectatorNotice ? (
        <span className="toolbar-spectator-notice" role="status">
          Another session already has the wheel here.{" "}
          <button type="button" className="toolbar-link" onClick={() => openDrawer("help")}>
            Open Help to reset the demo
          </button>{" "}
          and start your own clean run.
          <button
            type="button"
            className="toolbar-spectator-dismiss"
            aria-label="Dismiss"
            onClick={() => setSpectatorNoticeDismissed(true)}
          >
            ×
          </button>
        </span>
      ) : null}

      <span className="toolbar-side">
        <button
          type="button"
          className={attentionItems.length > 0 ? "toolbar-attention toolbar-attention-active" : "toolbar-attention"}
          onClick={() => openDrawer("attention")}
        >
          {attentionItems.length > 0 ? `Needs you · ${attentionItems.length}` : "All caught up"}
        </button>
        {sourceCount > 0 ? (
          <button
            type="button"
            className="toolbar-sources"
            onClick={() => goToWorkspace("whiteboard")}
            title="Open the meeting sources workspace"
          >
            {`${sourceCount} source${sourceCount === 1 ? "" : "s"}`}
            {failedSourceCount > 0 ? (
              <span className="toolbar-sources-failed">{`${failedSourceCount} failed`}</span>
            ) : null}
          </button>
        ) : null}
        <span className="toolbar-agents">
          <span className="toolbar-agents-dot" aria-hidden="true" />
          {agentsUsed === 0
            ? "No browser agents used yet"
            : `${agentsUsed} agent${agentsUsed === 1 ? "" : "s"} used this session`}
        </span>
        <button
          type="button"
          className="toolbar-help"
          aria-label="How this room works"
          onClick={() => openDrawer("help")}
        >
          ?
        </button>
      </span>

      {moving ? (
        <span className="moving-toast" role="status">
          {MOVING_LABEL[activeWorkspace]}
        </span>
      ) : null}
    </div>
  );
}
