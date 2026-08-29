"use client";

import { useShell } from "../shell-provider";
import { ActivityDrawer } from "./activity-drawer";
import { AgentsDrawer } from "./agents-drawer";
import { HelpDrawer } from "./help-drawer";
import { InviteDrawer } from "./invite-drawer";
import { LeaveDrawer } from "./leave-drawer";
import { ParticipantsDrawer } from "./participants-drawer";
import { RoleDrawer } from "./role-drawer";
import { SettingsDrawer } from "./settings-drawer";

/** Renders whichever one meeting-controls drawer is currently open, if any. */
export function DrawerHost() {
  const { activeDrawer } = useShell();

  switch (activeDrawer) {
    case "participants":
      return <ParticipantsDrawer />;
    case "role":
      return <RoleDrawer />;
    case "invite":
      return <InviteDrawer />;
    case "activity":
      return <ActivityDrawer />;
    case "agents":
      return <AgentsDrawer />;
    case "settings":
      return <SettingsDrawer />;
    case "leave":
      return <LeaveDrawer />;
    case "help":
      return <HelpDrawer />;
    case null:
      return null;
  }
}
