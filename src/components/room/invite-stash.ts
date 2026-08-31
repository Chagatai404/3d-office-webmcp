"use client";

/**
 * The invite link, remembered for the owner who just made the room.
 *
 * The server cannot help here. `public.room_invites` stores only
 * `hash_invite_token(raw_token)`, so once the create screen has shown the
 * link the raw token is gone for good — that is the point of hashing it, and
 * recovering it later would mean weakening the schema. The link is therefore
 * kept where it was last seen: this browser, this tab.
 *
 * `sessionStorage` on purpose, not `localStorage`. The link is a capability —
 * anyone holding it can ask to join — so it lives as long as the tab the
 * owner created the room in and no longer. It survives a reload, which is the
 * case that matters, and it never reaches another user, another device, or
 * any server.
 *
 * Only the link is kept. The passcode is deliberately *not* stashed: the
 * create screen promises it is shown once, and quietly keeping a copy would
 * make that promise false.
 */

const KEY = "room-invite-url";

type Stash = Record<string, string>;

function read(): Stash {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stash) : {};
  } catch {
    // Private mode, blocked site data, or a value someone else wrote: an
    // unavailable stash is a normal state, not an error to surface.
    return {};
  }
}

export function rememberInviteUrl(roomId: string, inviteUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [roomId]: inviteUrl }));
  } catch {
    // Nothing to do: the drawer explains its absence rather than breaking.
  }
}

export function readInviteUrl(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  const value = read()[roomId];
  return typeof value === "string" && value.length > 0 ? value : null;
}
