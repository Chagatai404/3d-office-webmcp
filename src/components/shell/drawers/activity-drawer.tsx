"use client";

import { ActivityLedger } from "@/components/room/activity-ledger";
import { DrawerShell } from "./drawer-shell";

export function ActivityDrawer() {
  return (
    <DrawerShell label="Activity" title="Activity" subtitle="Every action, with its origin" dark>
      <ActivityLedger />
    </DrawerShell>
  );
}
