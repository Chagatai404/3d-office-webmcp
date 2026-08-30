"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomState } from "@/contracts/room";
import { createAttentionWebMcpTool } from "./attention";
import {
  deriveOnboardingCapabilityContext,
  deriveRoomCapabilityContext,
  getAvailableWebMcpToolNames,
} from "./capability-context";
import { JOIN_REQUEST_CHANGED_EVENT, readPendingJoinRequest } from "./join-request-store";
import { createOnboardingWebMcpTools, OnboardingWebMcpContext } from "./onboarding-tools";
import { createRoomWebMcpTools } from "./room-tools";
import { RoomWebMcpContext } from "./tool-context";

/**
 * Registers the in-room WebMCP catalog and keeps it live.
 *
 * Availability is recomputed from `getAvailableWebMcpToolNames` (the single
 * capability table in `capability-context.ts`) every time the *derived
 * capability signature* changes -- phase, meeting role, decision role,
 * decision policy, lock state, whether a candidate is frozen, whether self
 * is a required approver, and whether a seat is claimed at all. That
 * signature, not the whole `RoomState` object identity, is the effect's
 * dependency, so a re-registration pass only happens when something that
 * could actually change the tool set changes: phase advance, admission,
 * removal, ownership transfer, decision-role change, policy change,
 * finalization, or a lock toggle. `AbortController` guarantees no stale
 * registrations accumulate across passes.
 */
export function useRoomWebMcpTools(roomId: string, room: RoomState | null) {
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  const capabilitySignature = useMemo(
    () => (room ? JSON.stringify(deriveRoomCapabilityContext(room)) : null),
    [room],
  );

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext || !room || !capabilitySignature) return;

    const controller = new AbortController();
    const context = new RoomWebMcpContext(roomId, () => roomRef.current);
    const allTools: Record<string, WebMcpToolDefinition> = {
      ...createRoomWebMcpTools(context),
      ...createAttentionWebMcpTool(context),
    };
    const availableNames = getAvailableWebMcpToolNames(deriveRoomCapabilityContext(room));
    const tools = availableNames.map((name) => allTools[name]).filter((tool): tool is WebMcpToolDefinition => tool !== undefined);

    void Promise.all(
      tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("WebMCP tool registration failed", error);
      }
    });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capabilitySignature is the intentional, minimal dependency; room/roomId changes are covered by it alongside roomId itself.
  }, [roomId, capabilitySignature]);
}

/**
 * Registers the pre-room WebMCP catalog (`create_meeting`, `join_meeting`,
 * `get_my_join_status`) for the landing, create, and join routes. Mounted
 * inside the existing client components for those flows, not the page
 * files, so it shares their client boundary.
 */
export function useOnboardingWebMcpTools(route: "landing" | "create" | "join") {
  const [hasPendingJoinRequest, setHasPendingJoinRequest] = useState(false);

  useEffect(() => {
    function refresh() {
      setHasPendingJoinRequest(readPendingJoinRequest() !== null);
    }
    refresh();
    window.addEventListener(JOIN_REQUEST_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(JOIN_REQUEST_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const modelContext = document.modelContext;
    if (!modelContext) return;

    const controller = new AbortController();
    const context = new OnboardingWebMcpContext();
    const allTools = createOnboardingWebMcpTools(context);
    const capabilityContext = deriveOnboardingCapabilityContext({ route, hasPendingJoinRequest });
    const availableNames = getAvailableWebMcpToolNames(capabilityContext);
    const tools = availableNames.map((name) => allTools[name]).filter((tool): tool is WebMcpToolDefinition => tool !== undefined);

    void Promise.all(
      tools.map((tool) => modelContext.registerTool(tool, { signal: controller.signal })),
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        console.error("WebMCP onboarding tool registration failed", error);
      }
    });

    return () => controller.abort();
  }, [route, hasPendingJoinRequest]);
}
