"use client";

import { useRef, useState } from "react";
import { agentPromptGroups } from "./agent-prompts";
import { useRoom } from "./room-provider";

/**
 * Examples of what to ask your agent, for the phase the room is actually in.
 *
 * Deliberately not a checklist and deliberately not numbered: a judge should
 * feel free to ask their own question. Pressing one copies it, so trying an
 * example is cheap, but typing something else is the expected case.
 */
export function AgentPromptExamples({ compact = false }: { compact?: boolean }) {
  const { room } = useRoom();
  const groups = agentPromptGroups(room.phase);
  const [copied, setCopied] = useState<string | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(prompt);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setCopied(null), 2400);
    } catch {
      // Copying is a convenience. The text is on screen either way.
    }
  }

  const shown = compact ? groups.slice(0, 1) : groups;

  return (
    <div className="agent-examples" data-testid="agent-prompt-examples">
      <p className="agent-examples-lede">
        Ask your agent anything about this meeting. These are examples, not commands — no exact
        wording is required, and no particular order.
      </p>

      {shown.map((group) => (
        <div key={group.title} className="agent-examples-group">
          <span className="agent-examples-title">{group.title}</span>
          <ul className="agent-examples-list">
            {group.prompts.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  className="agent-example"
                  aria-label={`Copy example prompt: ${prompt}`}
                  onClick={() => void copy(prompt)}
                >
                  <span className="agent-example-text">“{prompt}”</span>
                  <span className="agent-example-copy" aria-hidden="true">
                    {copied === prompt ? "Copied" : "Copy"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="agent-examples-status" aria-live="polite">
        {copied ? "Example prompt copied to clipboard." : ""}
      </p>
    </div>
  );
}
