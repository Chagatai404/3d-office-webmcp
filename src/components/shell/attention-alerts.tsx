"use client";

import type { AttentionItem } from "@/contracts/room";
import { targetFor } from "./attention-routes";
import { useAttentionAlerts } from "./use-attention-alerts";
import { useShell } from "./shell-provider";

/**
 * What the room says out loud when something arrives that needs a person.
 *
 * Someone knocking at the lobby door was previously only a number ticking up
 * in the toolbar — nothing moved, nothing spoke, and the owner had no reason
 * to look. These are the arrivals, stated plainly under the toolbar with the
 * one action that resolves them.
 *
 * They persist rather than fading: an alert is a person waiting, and a toast
 * that times out after four seconds is exactly how the old count was missed.
 * Each one leaves when its item is dealt with, when it is reviewed, or when
 * it is dismissed. `role="status"` rather than `alert` — this is worth
 * announcing at the next pause, not worth cutting a screen reader off for.
 */
export function AttentionAlerts() {
  const { alerts, dismiss } = useAttentionAlerts();
  const { openDrawer, goToWorkspace } = useShell();

  if (alerts.length === 0) return null;

  // Three is enough to say "several things arrived" without becoming a wall
  // of cards over the room; the drawer holds the full list either way.
  const shown = alerts.slice(0, 3);
  const overflow = alerts.length - shown.length;

  function review(item: AttentionItem) {
    const target = targetFor(item, item.phase);
    if (target.drawer) openDrawer(target.drawer);
    else if (target.workspace) goToWorkspace(target.workspace);
    dismiss(item.id);
  }

  return (
    <div className="attention-alerts" role="status" aria-live="polite">
      {shown.map((item) => (
        <article
          key={item.id}
          className={
            item.priority === "critical"
              ? "attention-alert attention-alert-critical"
              : "attention-alert"
          }
        >
          <span className="attention-alert-dot" aria-hidden="true" />
          <div className="attention-alert-body">
            <strong className="attention-alert-title">{item.title}</strong>
            <span className="attention-alert-summary">{item.summary}</span>
          </div>
          <div className="attention-alert-actions">
            <button type="button" className="attention-alert-review" onClick={() => review(item)}>
              Review
            </button>
            <button
              type="button"
              className="attention-alert-dismiss"
              aria-label={`Dismiss: ${item.title}`}
              onClick={() => dismiss(item.id)}
            >
              ✕
            </button>
          </div>
        </article>
      ))}

      {overflow > 0 ? (
        <button
          type="button"
          className="attention-alert-more"
          onClick={() => openDrawer("attention")}
        >
          {overflow} more {overflow === 1 ? "item needs" : "items need"} you
        </button>
      ) : null}
    </div>
  );
}
