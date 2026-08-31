"use client";

import { useState } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "@/components/room/action-feedback";
import { useRoom } from "@/components/room/room-provider";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ensureAnonymousAccessToken } from "@/lib/supabase/session";
import { DrawerShell } from "./drawer-shell";

/** How this room works — the same three layers described in one place. */
export function HelpDrawer() {
  const { room } = useRoom();
  const isDemo = room.demoMode !== null;

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
          <strong>Agents</strong> read, draft, and negotiate through WebMCP. Alignment and final
          decisions need your own confirmation, every time.
        </li>
      </ol>

      {isDemo ? <DemoGuidance /> : null}
    </DrawerShell>
  );
}

/**
 * Judge-facing guidance for `/room/demo`. Natural-language prompts first,
 * per brief §37 -- this deliberately does not expose raw WebMCP tool names
 * as the primary instruction, even though each step below is backed by one.
 */
function DemoGuidance() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  async function resetDemo() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const accessToken = await ensureAnonymousAccessToken(createBrowserSupabaseClient());
      const response = await fetch("/api/demo/reset", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const outcome = (await response.json()) as ActionResult<unknown>;
      setResult(outcome);
      if (outcome.ok) window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="decision-section" data-testid="demo-guidance">
      <h3 className="panel-subheading">Demo room</h3>
      <p className="drawer-note">
        Your teammates here are deterministic simulations for the product walkthrough. The
        Security Expert is a distinct advisory actor, never a human teammate. Your own actions and
        your browser agent&apos;s tool calls are real.
      </p>
      <ol className="drawer-help-list">
        <li>Ask your agent what the team thinks.</li>
        <li>Move the discussion forward.</li>
        <li>Ask it to address the open concerns.</li>
        <li>Ask for team alignment.</li>
        <li>Review the decision.</li>
        <li>Finalize when the room asks for you.</li>
      </ol>
      <button type="button" className="button-quiet" disabled={busy} onClick={() => void resetDemo()}>
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      <ActionFeedback result={result} />
    </div>
  );
}
