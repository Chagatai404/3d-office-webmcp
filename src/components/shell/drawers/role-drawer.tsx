"use client";

import { useRoom } from "@/components/room/room-provider";
import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

/** My role: your own seat, and exactly what it does and does not let you do. */
export function RoleDrawer() {
  const { self } = useRoom();
  const { openDrawer } = useShell();

  return (
    <DrawerShell label="My role" title="My role">
      {self ? (
        <div className="drawer-role-seat">
          <span className="drawer-role-seat-label">Your seat</span>
          <p className="drawer-role-seat-value">
            {self.role}
            {` · ${self.meetingRole.replace("_", " ")} · ${self.decisionRole.replace("_", " ")}`}
          </p>
        </div>
      ) : (
        <p className="panel-empty">Claim a seat to see what your role can do here.</p>
      )}

      <span className="drawer-section-label">What your seat can do</span>
      <ul className="drawer-checklist">
        <li>✓ Publish and delete your own constraints</li>
        <li>✓ Raise objections and propose trade-offs</li>
        <li>✓ Share one alignment, changeable until the phase closes</li>
        <li>
          {self?.decisionRole === "decision_maker"
            ? "✓ Holds explicit decision authority"
            : "○ Contributes without final decision authority"}
        </li>
        <li>✕ Nothing on anyone else&apos;s behalf, ever</li>
      </ul>

      <div className="drawer-actions">
        <button type="button" className="button-quiet" onClick={() => openDrawer("agents")}>
          What my agent may do →
        </button>
      </div>
    </DrawerShell>
  );
}
