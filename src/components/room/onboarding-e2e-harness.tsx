"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { CreatedRoom, RoomInvitePreview } from "@/contracts/room";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

/**
 * Minimal browser-integration surface for the pre-membership onboarding lane,
 * and the counterpart to `RoomE2EHarness`.
 *
 * It is never rendered in the normal product UI. It drives the real
 * `ApiRoomOnboardingClient`, so the created-room E2E exercises anonymous auth,
 * `POST /api/rooms`, `POST /api/invitations/preview`, `POST
 * /api/invitations/claim` and the post-claim redirect without coupling that
 * proof to the product's own `/new` and `/room/[roomId]/join` presentation.
 */
export function OnboardingE2EHarness({
  initialInviteToken,
}: {
  initialInviteToken: string;
}) {
  const router = useRouter();
  const client = useMemo(() => new ApiRoomOnboardingClient(), []);

  const [status, setStatus] = useState("Ready");
  const [createRoomInput, setCreateRoomInput] = useState("");
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [inviteToken, setInviteToken] = useState(initialInviteToken);
  const [preview, setPreview] = useState<RoomInvitePreview | null>(null);
  const [claimError, setClaimError] = useState("");

  /**
   * An invite link carries its capability in `?invite=`, so opening one
   * previews immediately — the same first step the product join route takes.
   */
  useEffect(() => {
    if (!initialInviteToken) return;
    let active = true;
    void (async () => {
      try {
        const result = await client.previewInvitation(initialInviteToken);
        if (active) setPreview(result);
      } catch (error) {
        if (active) setStatus(describeError(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [client, initialInviteToken]);

  async function previewInvitation() {
    setStatus("Working…");
    try {
      setPreview(await client.previewInvitation(inviteToken));
      setStatus("Ready");
    } catch (error) {
      setStatus(describeError(error));
    }
  }

  async function createRoom() {
    setStatus("Working…");
    try {
      setCreated(await client.createRoom(JSON.parse(createRoomInput)));
      setStatus("Ready");
    } catch (error) {
      setStatus(describeError(error));
    }
  }

  /**
   * A refused capability is a structured answer, not a thrown error, so the
   * reason is rendered instead of the redirect.
   */
  async function claimInvitation() {
    setStatus("Working…");
    setClaimError("");
    try {
      const result = await client.claimInvitation({ inviteToken });
      setStatus("Ready");
      if (!result.ok) {
        setClaimError(result.error.message);
        return;
      }
      router.push(`/room/${encodeURIComponent(result.data.roomId)}`);
    } catch (error) {
      setStatus(describeError(error));
    }
  }

  return (
    <main className="shell" data-testid="e2e-onboarding-harness">
      <p data-testid="onboarding-status">{status}</p>

      <section aria-label="Create a room">
        <label>
          Room input
          <textarea
            data-testid="create-room-input"
            value={createRoomInput}
            onChange={(event) => setCreateRoomInput(event.target.value)}
          />
        </label>
        <button type="button" data-testid="create-room" onClick={() => void createRoom()}>
          Create room
        </button>
      </section>

      {created ? (
        <section data-testid="created-room">
          <p data-testid="created-room-id">{created.roomId}</p>
          <ul>
            {created.participantInvites.map((invite, index) => (
              <li key={invite.participantId}>
                <span data-testid={`invite-role-${index}`}>{invite.role}</span>
                <span data-testid={`invite-participant-${index}`}>{invite.participantId}</span>
                <span data-testid={`invite-url-${index}`}>{invite.inviteUrl}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="Join with an invitation">
        <label>
          Invite token
          <input
            data-testid="invite-token"
            value={inviteToken}
            onChange={(event) => setInviteToken(event.target.value)}
          />
        </label>
        <button
          type="button"
          data-testid="preview-invitation"
          onClick={() => void previewInvitation()}
        >
          Preview invitation
        </button>
        <button type="button" data-testid="claim-invitation" onClick={() => void claimInvitation()}>
          Claim my seat
        </button>
        {claimError ? <p data-testid="claim-error">{claimError}</p> : null}
      </section>

      {preview ? (
        <section data-testid="invite-preview">
          {/*
            Serialized whole so the E2E can assert the *complete* pre-membership
            payload, not just the fields a friendly renderer chose to show.
          */}
          <pre data-testid="invite-preview-json">{JSON.stringify(preview)}</pre>
          <p data-testid="invite-valid">{String(preview.inviteValid)}</p>
          <p data-testid="invite-already-claimed">{String(preview.alreadyClaimed)}</p>
          {preview.inviteValid ? (
            <>
              <p data-testid="preview-room-id">{preview.roomId}</p>
              <p data-testid="preview-title">{preview.title}</p>
              <p data-testid="preview-brief">{preview.brief}</p>
              <p data-testid="preview-participant-name">{preview.participant.name}</p>
              <p data-testid="preview-participant-role">{preview.participant.role}</p>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
