import type { JoinRequest } from "@/contracts/room";
import { computeAttentionItems } from "@/domain/rooms/attention";
import type { RoomWebMcpContext } from "./tool-context";
import { executeToolSafely, readToolSuccess } from "./tool-result";

/**
 * `get_my_attention_items` is the flagship read tool this slice adds: it
 * answers "what needs me?" / "do I need to do anything?" / "can my agent
 * keep going without me?" directly from canonical room state, without the
 * agent having to inspect every workspace itself. All derivation logic
 * lives in `src/domain/rooms/attention.ts` (`computeAttentionItems`) so the
 * WebMCP layer stays a thin adapter, not a second business-logic surface.
 */
export function createAttentionWebMcpTool(context: RoomWebMcpContext): Record<string, WebMcpToolDefinition> {
  return {
    get_my_attention_items: {
      name: "get_my_attention_items",
      description:
        "List only what needs the authenticated participant's own attention right now -- a missing input, a waiting admission request (owner only), a blocking concern they raised, missing alignment, or a required decision approval. Returns an empty list when nothing needs them, meaning their agent can keep going without interrupting them. Never includes another participant's tasks.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () =>
        executeToolSafely(async () => {
          const room = await context.getRoom();
          const self = room.participants.find((participant) => participant.id === room.selfParticipantId);
          if (!self) {
            return readToolSuccess({ items: [], count: 0 }, room.version, "No attention items: this session has not claimed a seat.");
          }
          const isOwner = self.id === room.ownerParticipantId && self.meetingRole === "owner";
          let pendingJoinRequests: JoinRequest[] = [];
          if (isOwner && room.phase !== "finalized") {
            const requestsResult = await context.listJoinRequests();
            if (requestsResult.ok) pendingJoinRequests = requestsResult.data;
          }
          const items = computeAttentionItems({ room, self, pendingJoinRequests });
          return readToolSuccess({ items, count: items.length }, room.version, "Attention items loaded.");
        }, () => context.getObservedRoomVersion()),
    },
  };
}
