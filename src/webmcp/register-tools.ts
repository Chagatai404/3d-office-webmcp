"use client";

import { useEffect, useRef } from "react";
import type { RoomState } from "@/contracts/room";
import { RoomWebMcpContext } from "./tool-context";
import { getRoomWebMcpToolsForPhase } from "./tool-definitions";

export function useRoomWebMcpTools(roomId: string, room: RoomState | null) {
  const roomRef = useRef(room);
  const phase = room?.phase;

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext || !phase) return;

    const controller = new AbortController();
    const context = new RoomWebMcpContext(roomId, () => roomRef.current);
    const tools = getRoomWebMcpToolsForPhase(context, phase);

    void Promise.all(
      tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("WebMCP tool registration failed", error);
      }
    });

    return () => controller.abort();
  }, [roomId, phase]);
}
