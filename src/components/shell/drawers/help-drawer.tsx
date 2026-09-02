"use client";

import { useState } from "react";
import type { ActionResult } from "@/contracts/room";
import { ActionFeedback } from "@/components/room/action-feedback";
import { AgentPromptExamples } from "@/components/room/agent-prompt-examples";
import { useRoom } from "@/components/room/room-provider";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { ensureAnonymousAccessToken } from "@/lib/supabase/session";
import { DrawerShell } from "./drawer-shell";

/** How this room works — the same three layers described in one place. */
export function HelpDrawer() {
  const { room } = useRoom();
  const isDemo = room.demoMode !== null;

  return (
    <DrawerShell label="How this room works" title="How this room works" dark>
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

      <div className="decision-section">
        <h3 className="panel-subheading">Working with your agent</h3>
        <AgentPromptExamples />
      </div>

      {isDemo ? <DemoGuidance /> : null}

      <div className="decision-section">
        <h3 className="panel-subheading">3D asset credits</h3>
        <p className="drawer-note">
          Participant avatars: &ldquo;Ultimate Modular Women Pack&rdquo; and &ldquo;Ultimate
          Modular Men Pack&rdquo; by Quaternius. Meeting-room props: &ldquo;The Office
          Pack&rdquo; by dook. Both licensed{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC-BY
          </a>{" "}
          via{" "}
          <a href="https://poly.pizza" target="_blank" rel="noreferrer">
            Poly Pizza
          </a>
          .
        </p>
      </div>
    </DrawerShell>
  );
}

/**
 * What is real and what is simulated in `/room/demo`, plus the reset.
 *
 * It used to carry six numbered steps, which read as the sequence the room
 * required -- and a judge who departed from it had no way to tell whether
 * they had broken the demo or simply asked something else. The room
 * understands the protocol rather than a script, so the phase-aware examples
 * above are the guidance now, and this section says only what a judge cannot
 * work out for themselves: which teammates are people.
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
      <p className="drawer-note">
        Lead the meeting however you like. Introduce your own option, push back on the team, ask
        the room where it stands — the examples above are a starting point, not a sequence, and
        the room has no memorized script to break.
      </p>
      <button type="button" className="button-quiet" disabled={busy} onClick={() => void resetDemo()}>
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      <ActionFeedback result={result} />
    </div>
  );
}
