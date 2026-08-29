"use client";

import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

/** Settings. Only one control ships wired-up so far: everything here is real. */
export function SettingsDrawer() {
  const { forceReducedMotion, setForceReducedMotion } = useShell();

  return (
    <DrawerShell label="Settings" title="Settings">
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
