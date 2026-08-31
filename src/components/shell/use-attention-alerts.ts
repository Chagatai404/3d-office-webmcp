"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttentionItem } from "@/contracts/room";
import { useAttentionItems } from "./use-attention-items";

/**
 * The items that have *arrived* since the viewer got here.
 *
 * `useAttentionItems` answers "what needs you", which the toolbar chip has
 * always shown — but a count that slides from 0 to 1 announces nothing, which
 * is how a person waiting in the lobby went unnoticed. This answers the
 * narrower question "what is new", so the room can say so out loud.
 *
 * Two rules keep it from becoming noise:
 *
 * - whatever is already waiting when you walk in is not news, so the first
 *   read only records what it sees;
 * - an item that gets dealt with stops alerting on its own, so admitting
 *   someone from the drawer clears their alert without a second gesture.
 *
 * Nothing here is room state: alerts are per-viewer, per-visit, and never
 * travel anywhere.
 */
export interface AttentionAlerts {
  /** Newly-arrived items, oldest first. */
  alerts: AttentionItem[];
  dismiss(id: string): void;
  dismissAll(): void;
}

export function useAttentionAlerts(): AttentionAlerts {
  const items = useAttentionItems();
  /** `null` until the first read; everything in it has already been announced. */
  const announced = useRef<Set<string> | null>(null);
  const [alertIds, setAlertIds] = useState<string[]>([]);

  useEffect(() => {
    const ids = items.map((item) => item.id);

    if (announced.current === null) {
      announced.current = new Set(ids);
      return;
    }

    const fresh = ids.filter((id) => !announced.current?.has(id));
    for (const id of ids) announced.current.add(id);

    setAlertIds((current) => {
      // Drop alerts whose item is gone (handled elsewhere), then add arrivals.
      const live = current.filter((id) => ids.includes(id));
      const added = fresh.filter((id) => !live.includes(id));
      if (added.length === 0 && live.length === current.length) return current;
      return [...live, ...added];
    });
  }, [items]);

  const dismiss = useCallback((id: string) => {
    setAlertIds((current) => current.filter((entry) => entry !== id));
  }, []);

  const dismissAll = useCallback(() => setAlertIds([]), []);

  const alerts = useMemo(
    () =>
      alertIds
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is AttentionItem => item !== undefined),
    [alertIds, items],
  );

  return { alerts, dismiss, dismissAll };
}
