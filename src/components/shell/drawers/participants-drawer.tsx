"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { readInviteUrl } from "@/components/room/invite-stash";
import { useRoom } from "@/components/room/room-provider";
import type { JoinRequest } from "@/contracts/room";
import { DrawerShell } from "./drawer-shell";

export function ParticipantsDrawer() {
  return (
    <DrawerShell label="Participants" title="Participants">
      <OwnerWaitingRoom />
      <InviteLink />
      <ParticipantPanel />
    </DrawerShell>
  );
}

function OwnerWaitingRoom() {
  const { room, self, actions } = useRoom();
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isOwner = self?.id === room.ownerParticipantId && self.meetingRole === "owner";

  const refresh = useCallback(async () => {
    if (!isOwner) return;
    const result = await actions.listJoinRequests();
    if (result.ok) setRequests(result.data);
  }, [actions, isOwner]);

  useEffect(() => {
    if (!isOwner) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [isOwner, refresh]);

  if (!isOwner) return null;

  async function resolve(request: JoinRequest, decision: "admit" | "reject") {
    if (busyId) return;
    setBusyId(request.id);
    const result = decision === "admit"
      ? await actions.admitJoinRequest({ joinRequestId: request.id })
      : await actions.rejectJoinRequest({ joinRequestId: request.id });
    setBusyId(null);
    if (result.ok) await refresh();
  }

  return <section className="panel-block" aria-labelledby="waiting-room-heading">
    <h2 className="panel-heading" id="waiting-room-heading">Waiting room {requests.length ? `(${requests.length})` : ""}</h2>
    {requests.length === 0 ? <p className="panel-note">No one is waiting.</p> : <ul className="participant-list">
      {requests.map((request) => <li className="participant-row" key={request.id}>
        <div className="participant-identity"><strong>{request.displayName}</strong><span className="participant-role">{request.role}</span></div>
        <div className="participant-tags">
          <button type="button" disabled={busyId === request.id} onClick={() => void resolve(request, "admit")}>Admit</button>
          <button type="button" disabled={busyId === request.id} onClick={() => void resolve(request, "reject")}>Reject</button>
        </div>
      </li>)}
    </ul>}
  </section>;
}

/** The stash is written once, before this drawer can exist. */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * The invite link, still reachable once the meeting is under way.
 *
 * It used to exist only on the create screen, which meant the owner had one
 * chance to copy it and no way back — so inviting a latecomer meant starting
 * a new room. It is shown to the owner alone: the link is a capability, and a
 * participant handing it on is an admission decision the owner never made.
 *
 * When it cannot be found (a different tab, a different device, or a room
 * someone else created) this says so plainly instead of showing an empty box,
 * because the honest answer is that the server cannot reissue it — see
 * `invite-stash` for why.
 */
function InviteLink() {
  const { room, self } = useRoom();
  const isOwner = self?.id === room.ownerParticipantId && self.meetingRole === "owner";
  // `sessionStorage` does not exist while rendering on the server, so the
  // link is read through the same external-store seam the rest of the app
  // uses for browser-only facts. The stash never changes under an open
  // drawer, so there is nothing to subscribe to.
  const inviteUrl = useSyncExternalStore(
    subscribeToNothing,
    () => readInviteUrl(room.id),
    () => null,
  );
  const [copied, setCopied] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  if (!isOwner) return null;

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => setCopied(false), 2400);
    } catch {
      // The field is selectable and readable either way.
    }
  }

  return (
    <section className="panel-block" aria-labelledby="invite-link-heading">
      <h2 className="panel-heading" id="invite-link-heading">
        Invite link
      </h2>

      {inviteUrl === null ? (
        <p className="panel-note">
          This browser tab does not have the link for this room. The server
          stores only a hash of it, so it cannot be shown again here — reopen
          the tab you created the room in, or create a fresh room to get a new
          link.
        </p>
      ) : (
        <>
          <p className="panel-note">
            Anyone with this link can ask to join. They still wait in the
            lobby until you admit them.
          </p>
          <div className="flow-share-field">
            <input
              aria-label="Invite link"
              readOnly
              value={inviteUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="flow-copy-btn" onClick={() => void copy(inviteUrl)}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="flow-copy-status" aria-live="polite">
            {copied ? "Invite link copied to clipboard." : ""}
          </p>
        </>
      )}
    </section>
  );
}
