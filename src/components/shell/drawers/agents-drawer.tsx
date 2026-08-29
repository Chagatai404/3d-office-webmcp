"use client";

import { useRoom } from "@/components/room/room-provider";
import {
  getRoomWebMcpToolNames,
  PARTICIPANT_MUTATION_TOOL_NAMES,
} from "@/webmcp/tool-definitions";
import { DrawerShell } from "./drawer-shell";

/** Agents & tools: exactly which WebMCP tools are registered right now, and why. */
export function AgentsDrawer() {
  const { room, self } = useRoom();
  const registered = getRoomWebMcpToolNames(room.phase, { hasClaimedSeat: self !== null });
  const readOnly = registered.filter((name) => !PARTICIPANT_MUTATION_TOOL_NAMES.has(name));
  const mutating = registered.filter((name) => PARTICIPANT_MUTATION_TOOL_NAMES.has(name));

  return (
    <DrawerShell label="Agents and tools" title="Agents & tools" dark>
      <span className="drawer-section-label">Registered in this phase</span>
      <div className="drawer-tool-list">
        {registered.map((name) => (
          <span key={name} className="drawer-tool-chip">
            {name}
          </span>
        ))}
      </div>

      {!self ? (
        <p className="drawer-note">
          {mutating.length === 0 && readOnly.length > 0
            ? "Only read-only tools are registered until you claim a seat. No agent can act for a seat it does not hold."
            : null}
        </p>
      ) : null}

      <p className="drawer-note">
        Read-only tools ({readOnly.length}) let an agent explain the room. Tools that write (
        {mutating.length}) act only for the participant identity whose browser session registered
        them — never on anyone else&apos;s behalf.
      </p>
    </DrawerShell>
  );
}
