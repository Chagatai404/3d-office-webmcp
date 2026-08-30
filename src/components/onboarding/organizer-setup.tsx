"use client";

import { useState } from "react";
import Link from "next/link";
import { readCreatedRoomForSetup } from "@/components/onboarding/created-room-handoff";

type OrganizerSetupProps = {
  roomId: string;
};

/**
 * Lobby — the room exists, but the meeting has not started.
 *
 * The organizer sees who is seated, copies one private link per open seat,
 * and steps into the room when ready. Ported from the "Meeting Flow" design's
 * lobby artboard; the 3D room waits behind the panels.
 */
export function OrganizerSetup({ roomId }: OrganizerSetupProps) {
  const [handoff] = useState(() => readCreatedRoomForSetup(roomId));
  const [copiedParticipantId, setCopiedParticipantId] = useState<string | null>(
    null,
  );
  const [copyFailureParticipantId, setCopyFailureParticipantId] = useState<
    string | null
  >(null);
  const [entering, setEntering] = useState(false);

  if (!handoff) {
    return (
      <main className="flow-page">
        <div className="flow-scrim flow-scrim-panel" aria-hidden="true" />

        <div className="flow-content flow-content-centered">
          <section className="flow-recovery" aria-labelledby="setup-recovery-title">
            <p className="flow-eyebrow">Secure invitation handoff ended</p>
            <h1 id="setup-recovery-title">The room is safe. The links are gone.</h1>
            <p>
              Invitation links are available only immediately after room
              creation. They weren’t saved in this browser, so refreshing this
              page clears them and they can’t be recovered here.
            </p>
            <div className="flow-actions">
              <Link className="flow-btn flow-btn-primary" href={`/room/${roomId}`}>
                Enter room
              </Link>
              <Link className="flow-btn flow-btn-ghost" href="/">
                Back to start
              </Link>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const { createdRoom, input } = handoff;
  const organizer = input.participants[0];
  const seatCount = input.participants.length;
  const openSeats = createdRoom.participantInvites.length;

  async function copyInvite(participantId: string, inviteUrl: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyFailureParticipantId(null);
      setCopiedParticipantId(participantId);
    } catch {
      setCopiedParticipantId(null);
      setCopyFailureParticipantId(participantId);
    }
  }

  return (
    <main className="flow-page">
      <div className="flow-scrim flow-scrim-panel" aria-hidden="true" />
      {entering ? (
        <p className="flow-toast" role="status">
          Taking your seat at the table
        </p>
      ) : null}

      <div className="flow-content">
        <div className="flow-topbar">
          <div className="flow-topbar-group">
            <Link className="flow-back" href="/new">
              <span aria-hidden="true">←</span> Back
            </Link>
            <span className="flow-chip">
              <span aria-hidden="true" className="flow-brand-mark" />
              <span className="flow-chip-name">{input.title}</span>
              <span aria-hidden="true" className="flow-chip-divider" />
              <span className="flow-chip-step">Lobby · not started</span>
            </span>
          </div>

          <span className="flow-status">
            <span aria-hidden="true" className="flow-status-dot" />
            1 of {seatCount} seats filled
          </span>
        </div>

        <div className="flow-lobby">
          <aside className="lobby-card" aria-label="Human participants">
            <div className="lobby-card-head">
              <h2>Human participants</h2>
              <span className="lobby-card-head-meta">{seatCount} seats</span>
            </div>
            <p className="lobby-note">
              One person per seat. Only people hold a vote and an approval.
            </p>

            <div className="lobby-seats">
              {organizer ? (
                <div className="flow-seat-row flow-seat-row-self">
                  <span
                    aria-hidden="true"
                    className="flow-seat-avatar flow-seat-avatar-self"
                  >
                    {organizer.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="flow-seat-main">
                    <span className="flow-seat-name">{organizer.name}</span>
                    <span className="flow-seat-sub flow-seat-self-sub">
                      You · Organizer · {organizer.role}
                      {organizer.requiredForApproval ? " · Required approver" : ""}
                    </span>
                  </div>
                  <span className="flow-seat-status">Joined</span>
                </div>
              ) : null}

              {createdRoom.participantInvites.map((invite, index) => {
                const candidate = input.participants[index + 1];
                const displayParticipant =
                  candidate?.role === invite.role ? candidate : null;
                const displayName =
                  displayParticipant?.name ?? `Participant ${index + 2}`;

                return (
                  <div className="flow-seat-row" key={invite.participantId}>
                    <span
                      aria-hidden="true"
                      className="flow-seat-avatar flow-seat-avatar-open"
                    >
                      {displayName.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="flow-seat-main">
                      <span className="flow-seat-name">{displayName}</span>
                      <span className="flow-seat-sub">
                        {invite.role}
                        {displayParticipant?.requiredForApproval
                          ? " · Required approver"
                          : ""}{" "}
                        · Invited · not here yet
                      </span>
                    </div>
                    <span className="flow-seat-status flow-seat-status-muted">
                      Link ready
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>

          <div className="lobby-col">
            <section className="lobby-card" aria-label="Invite">
              <div className="lobby-card-head">
                <h3>Invite</h3>
                <span className="lobby-card-head-meta">
                  {openSeats} {openSeats === 1 ? "seat" : "seats"} open
                </span>
              </div>

              <div className="lobby-code">
                <span className="lobby-code-fact">
                  <span className="lobby-code-label">Room</span>
                  <span className="lobby-code-value">{roomId}</span>
                </span>
                <span className="lobby-code-note">
                  Read it out, or send one seat link below.
                </span>
              </div>

              <div className="lobby-seats">
                {createdRoom.participantInvites.map((invite, index) => {
                  const candidate = input.participants[index + 1];
                  const displayParticipant =
                    candidate?.role === invite.role ? candidate : null;
                  const displayName =
                    displayParticipant?.name ?? `Participant ${index + 2}`;
                  const wasCopied = copiedParticipantId === invite.participantId;
                  const copyFailed =
                    copyFailureParticipantId === invite.participantId;

                  return (
                    <div className="lobby-invite-seat" key={invite.participantId}>
                      <div className="lobby-invite-row">
                        <div className="flow-seat-main">
                          <span className="flow-seat-name">
                            {displayName} · {invite.role}
                          </span>
                          <span className="flow-seat-sub">
                            Private one-time seat link
                          </span>
                        </div>
                        <button
                          type="button"
                          className="lobby-copy-button"
                          onClick={() =>
                            void copyInvite(invite.participantId, invite.inviteUrl)
                          }
                          aria-label={`Copy invite link for ${displayName}, ${invite.role}`}
                        >
                          {wasCopied ? "Copied" : "Copy invite link"}
                        </button>
                      </div>
                      <p className="lobby-copy-status" aria-live="polite">
                        {wasCopied
                          ? `Invitation for ${displayName} copied.`
                          : copyFailed
                            ? "Copy failed. Check browser clipboard permissions and try again."
                            : ""}
                      </p>
                    </div>
                  );
                })}
              </div>

              <p className="lobby-note">
                Whoever opens a link claims that seat. A second claim on the same
                seat is refused, not queued.
              </p>
            </section>
          </div>
        </div>
      </div>

      <div className="lobby-dock">
        <span className="lobby-dock-fact">
          <span className="lobby-dock-label">Deciding</span>
          <strong className="lobby-dock-value">{input.title}</strong>
        </span>
        <span aria-hidden="true" className="lobby-dock-divider" />
        <span className="lobby-dock-fact lobby-dock-fact-brief">
          <span className="lobby-dock-label">Brief</span>
          <span className="lobby-dock-value lobby-dock-value-quiet">{input.brief}</span>
        </span>
        <span aria-hidden="true" className="lobby-dock-divider" />
        <span className="lobby-dock-fact">
          <span className="lobby-dock-label">Waiting on</span>
          <strong className="lobby-dock-value lobby-dock-value-warn">
            {openSeats} {openSeats === 1 ? "seat" : "seats"} unclaimed
          </strong>
        </span>
        <Link
          className="lobby-dock-cta"
          href={`/room/${roomId}`}
          onClick={() => setEntering(true)}
        >
          Enter the meeting room →
        </Link>
      </div>
    </main>
  );
}
