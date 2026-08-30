"use client";

import { useMemo } from "react";
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
  const { room } = useRoom();
  const { activeWorkspace, moving, openDrawer } = useShell();
  const attentionItems = useAttentionItems();

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
      </span>

      <span className="toolbar-side">
        <button
          type="button"
          className={attentionItems.length > 0 ? "toolbar-attention toolbar-attention-active" : "toolbar-attention"}
          onClick={() => openDrawer("attention")}
        >
          {attentionItems.length > 0 ? `Needs you · ${attentionItems.length}` : "All caught up"}
        </button>
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
