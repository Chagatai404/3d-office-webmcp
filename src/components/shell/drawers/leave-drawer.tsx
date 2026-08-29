"use client";

import { useRouter } from "next/navigation";
import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

/** Leave the room. Your seat, constraints, and votes stay exactly as they are. */
export function LeaveDrawer() {
  const router = useRouter();
  const { closeDrawer } = useShell();

  return (
    <DrawerShell label="Leave the room" title="Leave the room?">
      <p className="drawer-note">
        Your constraints, objections, and votes stay exactly as they are. Your seat stays yours —
        you can walk back in from the same link.
      </p>
      <div className="drawer-actions">
        <button type="button" className="button-quiet" onClick={closeDrawer}>
          Stay
        </button>
        <button type="button" className="button" onClick={() => router.push("/")}>
          Leave
        </button>
      </div>
    </DrawerShell>
  );
}
