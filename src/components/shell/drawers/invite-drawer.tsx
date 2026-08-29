"use client";

import { useRoom } from "@/components/room/room-provider";
import { DrawerShell } from "./drawer-shell";

/**
 * Invite: which seats are still open.
 *
 * Invite links are shown once, to the organizer, immediately after the room
 * is created (`/room/[roomId]/setup`) and are not stored anywhere the server
 * can hand back out — so this drawer reports real open-seat state rather
 * than inventing a recoverable link that does not exist.
 */
export function InviteDrawer() {
  const { room } = useRoom();
  const openSeats = room.participants.filter(
    (participant) => participant.kind === "human" && !participant.isClaimed,
  );

  return (
    <DrawerShell label="Invite" title={`Invite · ${openSeats.length} seat${openSeats.length === 1 ? "" : "s"} open`}>
      {openSeats.length === 0 ? (
        <p className="panel-empty">Every human seat in this room is claimed.</p>
      ) : (
        <ul className="participant-list">
          {openSeats.map((seat) => (
            <li key={seat.id} className="participant-row">
              <div className="participant-identity">
                <span className="participant-name">{seat.name}</span>
                <span className="participant-role">{seat.role} · open seat</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="drawer-note">
        Invite links are shown once, to the organizer, right after the room is created, and are not
        recoverable from inside the room afterward — one person per seat, and a second claim is
        refused rather than queued.
      </p>
    </DrawerShell>
  );
}
