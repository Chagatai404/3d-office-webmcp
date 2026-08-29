"use client";

import { DecisionWorkspace } from "@/components/room/decision-workspace";
import { IssuesWorkspace } from "@/components/room/issues-workspace";
import { MeetingBrief } from "@/components/room/meeting-brief";
import { PositionsPanel } from "@/components/room/positions-panel";
import { ProposalsWorkspace } from "@/components/room/proposals-workspace";
import { VoteWorkspace } from "@/components/room/vote-workspace";
import { WhiteboardWorkspace } from "@/components/room/whiteboard-workspace";
import { useShell } from "./shell-provider";

/**
 * Layer 3's floating card: whichever one workspace is currently in focus.
 *
 * Never more than one at a time, per the product's "one cognitive context"
 * rule. Room has no card here — its content is the ambient summary strip
 * instead, since the room itself is the home state, not a workspace to open.
 */
export function WorkspacePanel() {
  const { activeWorkspace } = useShell();

  const content = (() => {
    switch (activeWorkspace) {
      case "room":
        return null;
      case "brief":
        return <MeetingBrief />;
      case "constraints":
        return <PositionsPanel />;
      case "proposals":
        return <ProposalsWorkspace />;
      case "issues":
        return <IssuesWorkspace />;
      case "whiteboard":
        return <WhiteboardWorkspace />;
      case "vote":
        return <VoteWorkspace />;
      case "decision":
        return <DecisionWorkspace />;
    }
  })();

  if (!content) return null;

  return (
    <div className="workspace-panel" key={activeWorkspace}>
      {content}
    </div>
  );
}
