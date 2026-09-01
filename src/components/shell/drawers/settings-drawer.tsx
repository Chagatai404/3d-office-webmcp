"use client";

import { useState } from "react";
import type { ActionResult, DecisionPolicy } from "@/contracts/room";
import { ActionFeedback } from "@/components/room/action-feedback";
import { useRoom } from "@/components/room/room-provider";
import { OwnerPhaseControls } from "@/components/room/room-status";
import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

const DECISION_POLICY_OPTIONS: Array<{
  value: DecisionPolicy;
  label: string;
  hint: string;
}> = [
  {
    value: "owner_decides",
    label: "Responsible owner decides",
    hint: "Best for normal team decisions",
  },
  {
    value: "equal_authority_consensus",
    label: "Equal decision-makers must agree",
    hint: "Use when participants genuinely share authority",
  },
];

/** Settings. Meeting access (lock) and decision authority live here alongside camera preferences. */
export function SettingsDrawer() {
  const { forceReducedMotion, setForceReducedMotion } = useShell();
  const { room, self, actions } = useRoom();
  const isOwner = self?.meetingRole === "owner";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyResult, setPolicyResult] = useState<ActionResult<unknown> | null>(null);

  async function toggleLock() {
    if (busy) return;
    setBusy(true);
    const outcome = room.isLocked ? await actions.unlockMeeting() : await actions.lockMeeting();
    setBusy(false);
    setResult(outcome);
  }

  async function changePolicy(decisionPolicy: DecisionPolicy) {
    if (policyBusy || decisionPolicy === room.decisionPolicy) return;
    setPolicyBusy(true);
    const outcome = await actions.setDecisionPolicy({ decisionPolicy });
    setPolicyBusy(false);
    setPolicyResult(outcome);
  }

  return (
    <DrawerShell label="Settings" title="Settings" dark>
      <div className="drawer-row drawer-toggle-row">
        <span>
          Meeting access
          <span className="drawer-toggle-hint">
            {room.isLocked
              ? "Locked — new join requests are refused."
              : "Open — new join requests are allowed."}
          </span>
        </span>
        {isOwner ? (
          <button type="button" className="button-quiet" disabled={busy} onClick={() => void toggleLock()}>
            {room.isLocked ? "Unlock meeting" : "Lock meeting"}
          </button>
        ) : (
          <span className="tag tag-muted">{room.isLocked ? "Locked" : "Open"}</span>
        )}
      </div>
      {isOwner ? <ActionFeedback result={result} /> : null}

      <div className="drawer-row drawer-toggle-row" data-testid="decision-policy-row">
        <span>
          Decision authority
          <span className="drawer-toggle-hint">How this room reaches its final decision.</span>
        </span>
      </div>
      {DECISION_POLICY_OPTIONS.map((option) => (
        <label key={option.value} className="drawer-row drawer-toggle-row">
          <input
            type="radio"
            name="decision-policy"
            checked={room.decisionPolicy === option.value}
            disabled={!isOwner || policyBusy}
            onChange={() => void changePolicy(option.value)}
          />
          <span>
            {option.label}
            <span className="drawer-toggle-hint">{option.hint}</span>
          </span>
        </label>
      ))}
      {isOwner ? <ActionFeedback result={policyResult} /> : null}

      <OwnerPhaseControls />

      <label className="drawer-row drawer-toggle-row">
        <input
          type="checkbox"
          checked={forceReducedMotion}
          onChange={(event) => setForceReducedMotion(event.target.checked)}
        />
        <span>
          Reduce camera motion
          <span className="drawer-toggle-hint">Cuts between workspaces instead of easing</span>
        </span>
      </label>
      <p className="drawer-note">
        Your operating system&apos;s own reduced-motion preference is honoured automatically. More
        settings — high-contrast panels, text size, confirmation prompts — are planned but not
        wired up yet, so they are not shown here rather than shown and doing nothing.
      </p>
    </DrawerShell>
  );
}
