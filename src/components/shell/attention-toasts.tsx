"use client";

import type { AttentionItem } from "@/contracts/room";
import { targetFor } from "./attention-routes";
import { useShell } from "./shell-provider";
import { useAttentionToasts } from "./use-attention-toasts";

/**
 * The moment something needs a person right now: a bar at the top of the
 * room that names it and clears itself. See `useAttentionToasts` for why
 * this exists beside the persistent "Needs you" badge rather than
 * replacing it, and `targetFor` for where "Review" leads for each kind.
 */
export function AttentionToasts() {
  const { toasts, dismiss } = useAttentionToasts();
  const { openDrawer, goToWorkspace } = useShell();

  if (toasts.length === 0) return null;

  function review(item: AttentionItem) {
    const target = targetFor(item, item.phase);
    if (target.drawer) openDrawer(target.drawer);
    else if (target.workspace) goToWorkspace(target.workspace);
    dismiss(item.id);
  }

  return (
    <div className="join-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <article key={toast.id} className="join-toast">
          <span className="join-toast-summary">{toast.title}</span>
          <button
            type="button"
            className="join-toast-review"
            onClick={() => review(toast)}
          >
            Review
          </button>
          <button
            type="button"
            className="join-toast-dismiss"
            aria-label={`Dismiss: ${toast.title}`}
            onClick={() => dismiss(toast.id)}
          >
            ✕
          </button>
        </article>
      ))}
    </div>
  );
}
