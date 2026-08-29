"use client";

import { useState } from "react";
import Link from "next/link";
import { readCreatedRoomForSetup } from "@/components/onboarding/created-room-handoff";
import styles from "@/components/onboarding/onboarding.module.css";

type OrganizerSetupProps = {
  roomId: string;
};

export function OrganizerSetup({ roomId }: OrganizerSetupProps) {
  const [handoff] = useState(() => readCreatedRoomForSetup(roomId));
  const [copiedParticipantId, setCopiedParticipantId] = useState<string | null>(
    null,
  );
  const [copyFailureParticipantId, setCopyFailureParticipantId] = useState<
    string | null
  >(null);

  if (!handoff) {
    return (
      <main className={styles.setupShell}>
        <section className={styles.setupRecovery} aria-labelledby="setup-recovery-title">
          <p className={styles.eyebrow}>Secure invitation handoff ended</p>
          <h1 id="setup-recovery-title">The room is safe. The links are gone.</h1>
          <p>
            Invitation links are available only immediately after room creation.
            They weren’t saved in this browser, so refreshing this page clears
            them and they can’t be recovered here.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryAction} href={`/room/${roomId}`}>
              Enter room <span aria-hidden="true">→</span>
            </Link>
            <Link className={styles.secondaryAction} href="/">
              Back home
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const { createdRoom, input } = handoff;
  const organizer = input.participants[0];

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
    <main className={styles.setupPage}>
      <header className={styles.setupHeader}>
        <Link className={styles.backLink} href="/">
          <span aria-hidden="true">←</span> Decision Office
        </Link>
        <span className={styles.secureLabel}>Private organizer setup</span>
      </header>

      <div className={styles.setupLayout}>
        <section className={styles.setupIntro} aria-labelledby="setup-title">
          <p className={styles.eyebrow}>Room created</p>
          <h1 id="setup-title">Invite the perspectives this decision needs.</h1>
          <p>{input.title}</p>
          <p className={styles.setupBrief}>{input.brief}</p>
          <div className={styles.securityNote}>
            <strong>Copy these links now.</strong>
            <span>
              Each link claims one predetermined seat. For security, links exist
              only in this browser tab and disappear on refresh.
            </span>
          </div>
          <Link className={styles.enterRoomLink} href={`/room/${roomId}`}>
            Enter decision room <span aria-hidden="true">→</span>
          </Link>
        </section>

        <section className={styles.setupSeats} aria-labelledby="seat-heading">
          <div className={styles.setupSeatsHeading}>
            <div>
              <p className={styles.eyebrow}>Participant seats</p>
              <h2 id="seat-heading">Share one private link with each person.</h2>
            </div>
            <span>{input.participants.length} seats</span>
          </div>

          {organizer ? (
            <article className={`${styles.inviteCard} ${styles.organizerCard}`}>
              <div className={styles.inviteIdentity}>
                <span className={styles.inviteInitials} aria-hidden="true">
                  {organizer.name.slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <strong>{organizer.name}</strong>
                  <span>{organizer.role}</span>
                </div>
              </div>
              <div className={styles.seatBadges}>
                <span>You · Organizer</span>
                <span>Joined</span>
                {organizer.requiredForApproval ? <span>Required approver</span> : null}
              </div>
              <p className={styles.organizerSeatNote}>
                Your authenticated session claimed the first seat at creation.
                No self-invitation is needed.
              </p>
            </article>
          ) : null}

          <div className={styles.inviteList}>
            {createdRoom.participantInvites.map((invite, index) => {
              const candidate = input.participants[index + 1];
              const displayParticipant =
                candidate?.role === invite.role ? candidate : null;
              const displayName = displayParticipant?.name ?? `Participant ${index + 2}`;
              const wasCopied = copiedParticipantId === invite.participantId;
              const copyFailed = copyFailureParticipantId === invite.participantId;

              return (
                <article className={styles.inviteCard} key={invite.participantId}>
                  <div className={styles.inviteCardTopline}>
                    <div className={styles.inviteIdentity}>
                      <span className={styles.inviteInitials} aria-hidden="true">
                        {displayName.slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <strong>{displayName}</strong>
                        <span>{invite.role}</span>
                      </div>
                    </div>
                    <span className={styles.invitedBadge}>Ready to invite</span>
                  </div>

                  <div className={styles.seatBadges}>
                    {displayParticipant?.requiredForApproval ? (
                      <span>Required approver</span>
                    ) : (
                      <span>Participant</span>
                    )}
                    <span>One-time seat link</span>
                  </div>

                  <div className={styles.copyRow}>
                    <div>
                      <strong>Private invitation link</strong>
                      <span>Opaque, role-specific capability</span>
                    </div>
                    <button
                      type="button"
                      className={styles.copyButton}
                      onClick={() =>
                        void copyInvite(invite.participantId, invite.inviteUrl)
                      }
                      aria-label={`Copy invite link for ${displayName}, ${invite.role}`}
                    >
                      {wasCopied ? "Copied" : "Copy invite link"}
                    </button>
                  </div>
                  <p className={styles.copyStatus} aria-live="polite">
                    {wasCopied
                      ? `Invitation for ${displayName} copied.`
                      : copyFailed
                        ? "Copy failed. Check browser clipboard permissions and try again."
                        : ""}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
