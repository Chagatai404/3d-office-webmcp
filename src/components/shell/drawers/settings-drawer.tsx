"use client";

import { useState } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "@/components/room/action-feedback";
import { useRoom } from "@/components/room/room-provider";
import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

/** Settings. Meeting access (lock) lives here alongside camera preferences. */
export function SettingsDrawer() {
  const { forceReducedMotion, setForceReducedMotion } = useShell();
  const { room, self, actions } = useRoom();
  const isOwner = self?.meetingRole === "owner";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  async function toggleLock() {
    if (busy) return;
    setBusy(true);
    const outcome = room.isLocked ? await actions.unlockMeeting() : await actions.lockMeeting();
    setBusy(false);
    setResult(outcome);
  }

  return (
    <DrawerShell label="Settings" title="Settings">
      <div className="drawer-row drawer-toggle-row">
        <span>
          Meeting access
          <span className="drawer-toggle-hint">
            {room.isLocked
              ? "Locked — new join requests are refused."
              : "Open — new join requests are allowed."}
          </span>
        </span>
        {isOwner ? (
          <button type="button" className="button-quiet" disabled={busy} onClick={() => void toggleLock()}>
            {room.isLocked ? "Unlock meeting" : "Lock meeting"}
          </button>
        ) : (
          <span className="tag tag-muted">{room.isLocked ? "Locked" : "Open"}</span>
        )}
      </div>
      {isOwner ? <ActionFeedback result={result} /> : null}

      <label className="drawer-row drawer-toggle-row">
        <input
          type="checkbox"
          checked={forceReducedMotion}
          onChange={(event) => setForceReducedMotion(event.target.checked)}
        />
        <span>
          Reduce camera motion
          <span className="drawer-toggle-hint">Cuts between workspaces instead of easing</span>
        </span>
      </label>
      <p className="drawer-note">
        Your operating system&apos;s own reduced-motion preference is honoured automatically. More
        settings — high-contrast panels, text size, confirmation prompts — are planned but not
        wired up yet, so they are not shown here rather than shown and doing nothing.
      </p>
    </DrawerShell>
  );
}
