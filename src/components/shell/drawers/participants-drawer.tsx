"use client";

import { useCallback, useEffect, useState } from "react";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { useRoom } from "@/components/room/room-provider";
import type { JoinRequest } from "@/contracts/room";
import { DrawerShell } from "./drawer-shell";

export function ParticipantsDrawer() {
  return (
    <DrawerShell label="Participants" title="Participants">
      <OwnerWaitingRoom />
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
