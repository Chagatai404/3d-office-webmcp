"use client";

import { useShell } from "./shell-provider";

/**
 * The one control that survives hiding the toolbar and dock.
 *
 * Everything else in Layer 1/3 can disappear to give the room the full
 * frame, but the way back has to stay on screen — so this renders
 * independently of `chromeHidden` rather than living inside either bar.
 */
export function ChromeToggle() {
  const { chromeHidden, toggleChrome } = useShell();

  return (
    <button
      type="button"
      className="chrome-toggle"
      aria-pressed={chromeHidden}
      aria-label={chromeHidden ? "Show interface" : "Hide interface"}
      title={chromeHidden ? "Show interface" : "Hide interface"}
      onClick={toggleChrome}
    >
      <span aria-hidden="true">{chromeHidden ? "⤢" : "⤡"}</span>
    </button>
  );
}
