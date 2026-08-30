"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoom } from "@/components/room/room-provider";
import type { AttentionItem, JoinRequest } from "@/contracts/room";
import { computeAttentionItems } from "@/domain/rooms/attention";

/**
 * The same derived list `get_my_attention_items` returns, for the compact
 * "Needs you" toolbar badge and drawer. Owner-only join requests are polled
 * on a light cadence, independent of `ParticipantsDrawer`'s own poll for the
 * admit/reject controls -- this one only needs a count and short summaries.
 */
export function useAttentionItems(): AttentionItem[] {
  const { room, self, actions } = useRoom();
  const isOwner = self?.id === room.ownerParticipantId && self?.meetingRole === "owner";
  const [pendingJoinRequests, setPendingJoinRequests] = useState<JoinRequest[]>([]);

  const refresh = useCallback(async () => {
    if (!isOwner || room.phase === "finalized") return;
    const result = await actions.listJoinRequests();
    if (result.ok) setPendingJoinRequests(result.data);
  }, [actions, isOwner, room.phase]);

  useEffect(() => {
    if (!isOwner || room.phase === "finalized") return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 4000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [isOwner, room.phase, refresh]);

  return useMemo(() => {
    if (!self) return [];
    return computeAttentionItems({
      room,
      self,
      pendingJoinRequests: isOwner && room.phase !== "finalized" ? pendingJoinRequests : [],
    });
  }, [isOwner, room, self, pendingJoinRequests]);
}
