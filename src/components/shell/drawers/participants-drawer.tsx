"use client";

import { ParticipantPanel } from "@/components/room/participant-panel";
import { DrawerShell } from "./drawer-shell";

export function ParticipantsDrawer() {
  return (
    <DrawerShell label="Participants" title="Participants">
      <ParticipantPanel />
    </DrawerShell>
  );
}
