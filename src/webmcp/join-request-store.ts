"use client";

/**
 * Bridges `join_meeting` (a WebMCP tool, which runs outside the React tree)
 * to `join-room.tsx`'s existing waiting-room polling UI, and backs
 * `get_my_join_status`. Session-scoped and best-effort: if `sessionStorage`
 * is unavailable, the join request itself already succeeded server-side --
 * only this convenience read-back is lost, so every read fails soft to
 * `null` rather than throwing.
 */

const STORAGE_KEY = "webmcp:pendingJoinRequest";
export const JOIN_REQUEST_CREATED_EVENT = "webmcp:join-request-created";
export const JOIN_REQUEST_CHANGED_EVENT = "webmcp:join-request-changed";

export interface PendingJoinRequest {
  joinRequestId: string;
  roomId: string;
}

export function savePendingJoinRequest(value: PendingJoinRequest, notify = true): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // best-effort convenience only, see module comment
  }
  window.dispatchEvent(new Event(JOIN_REQUEST_CHANGED_EVENT));
  if (notify) {
    window.dispatchEvent(new CustomEvent<PendingJoinRequest>(JOIN_REQUEST_CREATED_EVENT, { detail: value }));
  }
}

export function readPendingJoinRequest(): PendingJoinRequest | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingJoinRequest>;
    if (typeof parsed.joinRequestId === "string" && typeof parsed.roomId === "string") {
      return { joinRequestId: parsed.joinRequestId, roomId: parsed.roomId };
    }
    return null;
  } catch {
    return null;
  }
}

export function clearPendingJoinRequest(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // best-effort convenience only, see module comment
  }
  window.dispatchEvent(new Event(JOIN_REQUEST_CHANGED_EVENT));
}
