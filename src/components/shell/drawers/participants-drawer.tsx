"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ParticipantPanel } from "@/components/room/participant-panel";
import { readInviteUrl } from "@/components/room/invite-stash";
import { useRoom } from "@/components/room/room-provider";
import {
  DECISION_ROLE_LABEL,
  DECISION_ROLE_NOTE,
} from "@/components/room/room-labels";
import type { AssignableDecisionRole, JoinRequest } from "@/contracts/room";
import { DrawerShell } from "./drawer-shell";

export function ParticipantsDrawer() {
  return (
    <DrawerShell label="Participants" title="Participants" dark>
      <OwnerWaitingRoom />
      <InviteLink />
      <ParticipantPanel />
    </DrawerShell>
  );
}

/**
 * An authority assignment the owner made at the door, waiting for the person
 * it applies to.
 *
 * Admission and decision authority are two canonical operations today, and
 * the second one needs a participant id that does not exist until the first
 * one has been through the server and come back on the room subscription.
 * `knownParticipantIds` is the roster as it stood the moment Admit was
 * pressed, so the new arrival is identified by *being new*, never by name
 * alone -- two people called Deniz can never cause the wrong one to be
 * promoted.
 *
 * A6 replaces the whole of this with one owner configuration call that
 * carries the role and the decision role through admission itself; when it
 * lands, `applyPendingAuthority` below is the only thing that has to go.
 */
interface PendingAuthority {
  joinRequestId: string;
  displayName: string;
  decisionRole: AssignableDecisionRole;
  knownParticipantIds: string[];
}

function OwnerWaitingRoom() {
  const { room, self, actions } = useRoom();
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingAuthority, setPendingAuthority] = useState<PendingAuthority[]>([]);
  const applyingRef = useRef<Set<string>>(new Set());
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

  // Grants the authority the owner chose at the door, once the admitted
  // person actually exists in the canonical snapshot. The server re-checks
  // owner authority on the call; this only decides when to make it.
  useEffect(() => {
    if (pendingAuthority.length === 0) return;

    for (const entry of pendingAuthority) {
      if (applyingRef.current.has(entry.joinRequestId)) continue;

      const known = new Set(entry.knownParticipantIds);
      const arrival = room.participants.find(
        (participant) =>
          !known.has(participant.id) &&
          participant.kind === "human" &&
          participant.status === "active" &&
          participant.name === entry.displayName,
      );
      if (!arrival) continue;

      const settle = () =>
        setPendingAuthority((current) =>
          current.filter((candidate) => candidate.joinRequestId !== entry.joinRequestId),
        );

      if (arrival.decisionRole === entry.decisionRole) {
        settle();
        continue;
      }

      applyingRef.current.add(entry.joinRequestId);
      void actions
        .setParticipantDecisionRole({
          participantId: arrival.id,
          decisionRole: entry.decisionRole,
        })
        .finally(() => {
          applyingRef.current.delete(entry.joinRequestId);
          settle();
        });
    }
  }, [actions, pendingAuthority, room.participants]);

  if (!isOwner) return null;

  async function admit(request: JoinRequest, decisionRole: AssignableDecisionRole) {
    if (busyId) return;
    setBusyId(request.id);
    const knownParticipantIds = room.participants.map((participant) => participant.id);
    const result = await actions.admitJoinRequest({ joinRequestId: request.id });
    setBusyId(null);
    if (!result.ok) return;

    if (decisionRole === "decision_maker") {
      setPendingAuthority((current) => [
        ...current,
        {
          joinRequestId: request.id,
          displayName: request.displayName,
          decisionRole,
          knownParticipantIds,
        },
      ]);
    }
    await refresh();
  }

  async function reject(request: JoinRequest) {
    if (busyId) return;
    setBusyId(request.id);
    const result = await actions.rejectJoinRequest({ joinRequestId: request.id });
    setBusyId(null);
    if (result.ok) await refresh();
  }

  return (
    <section className="panel-block" aria-labelledby="waiting-room-heading">
      <h2 className="panel-heading" id="waiting-room-heading">
        Waiting room {requests.length ? `(${requests.length})` : ""}
      </h2>
      {requests.length === 0 ? (
        <p className="panel-note">No one is waiting.</p>
      ) : (
        <ul className="admission-list">
          {requests.map((request) => (
            <AdmissionCard
              key={request.id}
              request={request}
              busy={busyId === request.id}
              onAdmit={admit}
              onReject={reject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One person at the door, and the two things the owner decides about them.
 *
 * The role they typed is shown as what it is -- a request. It is not
 * authority: the room's own answer to "who is the CTO here" is the owner's,
 * not the joiner's. Decision authority starts at Contributor every time,
 * because the safe default for someone who has just arrived is the one that
 * grants nothing.
 */
function AdmissionCard({
  request,
  busy,
  onAdmit,
  onReject,
}: {
  request: JoinRequest;
  busy: boolean;
  onAdmit(request: JoinRequest, decisionRole: AssignableDecisionRole): void;
  onReject(request: JoinRequest): void;
}) {
  const [decisionRole, setDecisionRole] = useState<AssignableDecisionRole>("contributor");
  const groupName = `admission-authority-${request.id}`;

  return (
    <li className="admission-card" data-testid="admission-card">
      <h3 className="admission-title">{request.displayName} wants to join</h3>

      <dl className="admission-requested">
        <div>
          <dt>Requested role</dt>
          <dd>{request.role}</dd>
        </div>
      </dl>

      <div className="admission-field">
        <label htmlFor={`${groupName}-role`}>Assign role</label>
        {/* Scaffolding, and honest about it: the canonical admission
            operation carries no owner-assigned role yet, so this shows what
            will be assigned rather than pretending to change it. A6's owner
            configuration input is what turns this on. */}
        <input id={`${groupName}-role`} value={request.role} readOnly disabled />
        <p className="panel-note">
          They join with the role they asked for. Assigning a different one arrives with the
          owner admission-configuration action.
        </p>
      </div>

      <fieldset className="admission-field admission-authority">
        <legend>Decision authority</legend>
        {(["contributor", "decision_maker"] as const).map((option) => (
          <label key={option} className="admission-choice">
            <input
              type="radio"
              name={groupName}
              value={option}
              checked={decisionRole === option}
              disabled={busy}
              onChange={() => setDecisionRole(option)}
            />
            <span className="admission-choice-label">{DECISION_ROLE_LABEL[option]}</span>
            <span className="admission-choice-note">{DECISION_ROLE_NOTE[option]}</span>
          </label>
        ))}
        <p className="panel-note">
          Separate from running the meeting. Admitting someone never hands them the room.
        </p>
      </fieldset>

      <div className="drawer-actions">
        <button
          type="button"
          className="button-quiet"
          disabled={busy}
          onClick={() => onReject(request)}
        >
          Reject
        </button>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onAdmit(request, decisionRole)}
        >
          {busy ? "Admitting…" : "Admit participant"}
        </button>
      </div>
    </li>
  );
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
