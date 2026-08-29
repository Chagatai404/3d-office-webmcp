"use client";

import { DrawerShell } from "./drawer-shell";

/** How this room works — the same three layers described in one place. */
export function HelpDrawer() {
  return (
    <DrawerShell label="How this room works" title="How this room works">
      <p className="drawer-note">
        You are in one meeting, about one decision. Each part of the decision lives on its own
        surface in this room.
      </p>
      <ol className="drawer-help-list">
        <li>
          <strong>The bottom row of tabs</strong> moves the camera to a surface. Only one is ever
          in focus.
        </li>
        <li>
          <strong>The row beneath it</strong> is meeting admin: who is here, your role, invites,
          activity, agents, and settings.
        </li>
        <li>
          <strong>Agents</strong> read, draft, and negotiate through WebMCP. Votes and approvals
          need your own confirmation, every time.
        </li>
      </ol>
    </DrawerShell>
  );
}
