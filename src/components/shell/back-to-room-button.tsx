"use client";

import { useShell } from "./shell-provider";

/**
 * The one way back once the toolbar and dock are hidden.
 *
 * Hiding the chrome takes the dock's "Room" tab with it, so a board left
 * open with nothing else on screen would otherwise have no way out short of
 * showing the chrome again. Shown only where that gap exists: chrome
 * hidden, and not already at the room.
 */
export function BackToRoomButton() {
  const { chromeHidden, activeWorkspace, goToWorkspace } = useShell();

  if (!chromeHidden || activeWorkspace === "room") return null;

  return (
    <button type="button" className="back-to-room" onClick={() => goToWorkspace("room")}>
      <span aria-hidden="true">←</span> Back to room
    </button>
  );
}
