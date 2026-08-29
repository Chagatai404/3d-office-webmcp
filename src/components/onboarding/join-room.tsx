"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { RoomInvitePreview } from "@/contracts/room";
import styles from "@/components/onboarding/onboarding.module.css";

type JoinRoomProps = {
  roomId: string;
  inviteToken: string | null;
  client?: RoomOnboardingClient;
};

type PreviewState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "failure" }
  | { kind: "route-mismatch" }
  | { kind: "valid"; preview: Extract<RoomInvitePreview, { inviteValid: true }> };

type ClaimState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "race-lost"; recovery?: string }
  | { kind: "failure"; recovery?: string }
  | { kind: "success" };

export function JoinRoom({ roomId, inviteToken, client: suppliedClient }: JoinRoomProps) {
  const router = useRouter();
  const [client] = useState<RoomOnboardingClient>(
    () => suppliedClient ?? new ApiRoomOnboardingClient(),
  );
  const [previewState, setPreviewState] = useState<PreviewState>({
    kind: "loading",
  });
  const [claimState, setClaimState] = useState<ClaimState>({ kind: "idle" });
  const previewRequest = useRef(0);
  const claimInFlight = useRef(false);

  const loadPreview = useCallback(async () => {
    const requestId = ++previewRequest.current;
    setClaimState({ kind: "idle" });

    if (!inviteToken) {
      setPreviewState({ kind: "unavailable" });
      return;
    }

    setPreviewState({ kind: "loading" });
    try {
      const preview = await client.previewInvitation(inviteToken);
      if (requestId !== previewRequest.current) return;

      if (!preview.inviteValid) {
        setPreviewState({ kind: "unavailable" });
      } else if (preview.roomId !== roomId) {
        setPreviewState({ kind: "route-mismatch" });
      } else {
        setPreviewState({ kind: "valid", preview });
      }
    } catch {
      if (requestId === previewRequest.current) {
        setPreviewState({ kind: "failure" });
      }
    }
  }, [client, inviteToken, roomId]);

  useEffect(() => {
    void loadPreview();
    return () => {
      previewRequest.current += 1;
    };
  }, [loadPreview]);

  async function claimInvitation() {
    if (
      !inviteToken ||
      previewState.kind !== "valid" ||
      previewState.preview.alreadyClaimed ||
      claimInFlight.current
    ) {
      return;
    }

    claimInFlight.current = true;
    setClaimState({ kind: "pending" });

    try {
      const result = await client.claimInvitation({ inviteToken });
      if (!result.ok) {
        claimInFlight.current = false;
        const kind =
          result.error.code === "NOT_AUTHORIZED" ? "race-lost" : "failure";
        setClaimState(
          result.error.recovery
            ? { kind, recovery: result.error.recovery }
            : { kind },
        );
        return;
      }

      const preview = previewState.preview;
      if (
        result.data.roomId !== roomId ||
        result.data.roomId !== preview.roomId ||
        result.data.participantId !== preview.participant.id
      ) {
        claimInFlight.current = false;
        setClaimState({ kind: "failure" });
        return;
      }

      setClaimState({ kind: "success" });
      router.push(`/room/${encodeURIComponent(result.data.roomId)}`);
    } catch {
      claimInFlight.current = false;
      setClaimState({ kind: "failure" });
    }
  }

  return (
    <main className={styles.joinPage}>
      <header className={styles.joinHeader}>
        <Link className={styles.brand} href="/">
          <span aria-hidden="true" className={styles.brandMark}>
            3D
          </span>
          Decision Office
        </Link>
        <span className={styles.secureLabel}>Secure invitation</span>
      </header>

      <section className={styles.joinStage} aria-live="polite">
        {previewState.kind === "loading" ? (
          <div className={styles.joinStateCard} role="status">
            <span className={styles.loadingMark} aria-hidden="true" />
            <p className={styles.eyebrow}>Checking invitation</p>
            <h1>Preparing your safe preview…</h1>
            <p>We’re confirming the invitation before showing room details.</p>
          </div>
        ) : null}

        {previewState.kind === "unavailable" ? (
          <UnavailableInvitation />
        ) : null}

        {previewState.kind === "route-mismatch" ? (
          <div className={styles.joinStateCard} role="alert">
            <p className={styles.eyebrow}>Invitation route mismatch</p>
            <h1>This invitation can’t be used at this address.</h1>
            <p>
              Open the original invitation link again, or contact the organizer
              for the correct link. No room access was attempted.
            </p>
            <Link className={styles.secondaryAction} href="/">
              Back home
            </Link>
          </div>
        ) : null}

        {previewState.kind === "failure" ? (
          <div className={styles.joinStateCard} role="alert">
            <p className={styles.eyebrow}>Preview unavailable</p>
            <h1>We couldn’t check this invitation.</h1>
            <p>Check your connection and try once more. Nothing has been claimed.</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void loadPreview()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {previewState.kind === "valid" ? (
          <ValidInvitation
            preview={previewState.preview}
            claimState={claimState}
            onClaim={() => void claimInvitation()}
            onRecheck={() => void loadPreview()}
          />
        ) : null}
      </section>

      <footer className={styles.joinFooter}>
        Opening an invitation never joins automatically. You choose when to claim
        the role shown above.
      </footer>
    </main>
  );
}

function UnavailableInvitation() {
  return (
    <div className={styles.joinStateCard} role="alert">
      <p className={styles.eyebrow}>Invitation unavailable</p>
      <h1>This invitation can’t be used.</h1>
      <p>
        It may be invalid, expired, revoked, or already claimed by another
        participant. Contact the organizer for a new invitation.
      </p>
      <Link className={styles.secondaryAction} href="/">
        Back home
      </Link>
    </div>
  );
}

type ValidInvitationProps = {
  preview: Extract<RoomInvitePreview, { inviteValid: true }>;
  claimState: ClaimState;
  onClaim: () => void;
  onRecheck: () => void;
};

function ValidInvitation({
  preview,
  claimState,
  onClaim,
  onRecheck,
}: ValidInvitationProps) {
  const isClaiming = claimState.kind === "pending" || claimState.kind === "success";

  if (preview.alreadyClaimed) {
    return (
      <div className={styles.joinStateCard}>
        <p className={styles.eyebrow}>Already a participant</p>
        <h1>You’ve already joined this room.</h1>
        <p>
          This invitation belongs to your current session. Continue to the room
          as {preview.participant.role}.
        </p>
        <Link className={styles.primaryAction} href={`/room/${preview.roomId}`}>
          Open room <span aria-hidden="true">→</span>
        </Link>
      </div>
    );
  }

  return (
    <article className={styles.joinCard} aria-labelledby="invitation-title">
      <div className={styles.joinCardIntro}>
        <p className={styles.eyebrow}>You’ve been invited</p>
        <h1 id="invitation-title">{preview.title}</h1>
        <p>{preview.brief}</p>
      </div>

      <div className={styles.roleReveal}>
        <span className={styles.inviteInitials} aria-hidden="true">
          {preview.participant.name.slice(0, 2).toUpperCase()}
        </span>
        <div>
          <span>Your intended seat</span>
          <strong>{preview.participant.name}</strong>
          <p>{preview.participant.role}</p>
        </div>
      </div>

      <div className={styles.joinConfirmation}>
        <div>
          <strong>Join consciously</strong>
          <p>
            This action binds your authenticated browser session to the role
            above. The invitation—not this page—determines the seat.
          </p>
        </div>
        <button
          type="button"
          className={styles.submitButton}
          onClick={onClaim}
          disabled={isClaiming}
        >
          {claimState.kind === "pending"
            ? "Joining…"
            : claimState.kind === "success"
              ? "Opening room…"
              : `Join as ${preview.participant.role}`}
          {!isClaiming ? <span aria-hidden="true">→</span> : null}
        </button>
      </div>

      {claimState.kind === "race-lost" ? (
        <div className={styles.claimFeedback} role="alert">
          <strong>This invitation was claimed before your join completed.</strong>
          <span>
            {claimState.recovery ??
              "Ask the organizer for a new link if this seat should be yours."}
          </span>
          <button type="button" className={styles.inlineButton} onClick={onRecheck}>
            Check invitation again
          </button>
        </div>
      ) : null}

      {claimState.kind === "failure" ? (
        <div className={styles.claimFeedback} role="alert">
          <strong>We couldn’t complete your join.</strong>
          <span>
            {claimState.recovery ??
              "Your invitation was not accepted. Check your connection and try again."}
          </span>
          <button type="button" className={styles.inlineButton} onClick={onClaim}>
            Try joining again
          </button>
        </div>
      ) : null}
    </article>
  );
}
