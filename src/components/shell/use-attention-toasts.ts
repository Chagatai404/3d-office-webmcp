"use client";

import { useEffect, useRef, useState } from "react";
import type { AttentionItem } from "@/contracts/room";
import { useAttentionItems } from "./use-attention-items";

const TOAST_LIFETIME_MS = 6000;

/**
 * Worth a pop-up, not just the persistent alert: an arrival someone would
 * otherwise have no reason to notice right now. Everything else in
 * `computeAttentionItems` describes ongoing work (share your input, review
 * this conflict) that the persistent "Needs you" list already carries --
 * repeating those as toasts would just be noise on every poll they're
 * still true.
 */
function isToastWorthy(item: AttentionItem): boolean {
  if (item.type === "admission_request") return true;
  // Alignment -> Decision review is the one phase transition still manual
  // (see `useAutoAdvancePhase`; the other three now fire themselves), so
  // this is the only remaining "the room just became ready for you" moment
  // left to announce.
  if (item.type === "owner_progress_required" && item.phase === "voting") return true;
  return false;
}

/**
 * A brief, self-clearing announcement the moment something needs a person
 * right now -- on top of, not instead of, the persistent "Needs you" badge
 * and alert card: those stay up because a count that quietly resets is how
 * these went missed before (see `AttentionAlerts`). This is only the "look
 * now" nudge; the durable record is unaffected by it disappearing.
 */
export function useAttentionToasts(): { toasts: AttentionItem[]; dismiss: (id: string) => void } {
  const items = useAttentionItems();
  const seenIds = useRef<Set<string>>(new Set());
  // Each toast's own timer, keyed by item id -- set once, when the toast
  // first appears, and never touched by unrelated re-renders. A shared
  // effect-cleanup keyed on the whole item list would otherwise clear and
  // never reschedule a still-pending toast's timer on the next 4s poll.
  const timers = useRef<Map<string, number>>(new Map());
  const [toasts, setToasts] = useState<AttentionItem[]>([]);

  useEffect(() => {
    const fresh = items.filter((item) => isToastWorthy(item) && !seenIds.current.has(item.id));
    if (fresh.length === 0) return;

    for (const item of fresh) {
      seenIds.current.add(item.id);
      const timerId = window.setTimeout(() => {
        setToasts((current) => current.filter((candidate) => candidate.id !== item.id));
        timers.current.delete(item.id);
      }, TOAST_LIFETIME_MS);
      timers.current.set(item.id, timerId);
    }
    setToasts((current) => [...current, ...fresh]);
  }, [items]);

  useEffect(() => {
    const outstanding = timers.current;
    return () => {
      for (const timerId of outstanding.values()) window.clearTimeout(timerId);
    };
  }, []);

  function dismiss(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timerId = timers.current.get(id);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      timers.current.delete(id);
    }
  }

  return { toasts, dismiss };
}
