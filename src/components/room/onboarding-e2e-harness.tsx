"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { CreatedRoom, JoinRequest, RoomInvitePreview } from "@/contracts/room";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

/**
 * Minimal browser-integration surface for the pre-membership onboarding lane,
 * and the counterpart to `RoomE2EHarness`.
 *
 * It is never rendered in the normal product UI. It drives the real
 * `ApiRoomOnboardingClient`, so the E2E suite exercises anonymous auth,
 * `POST /api/rooms`, the passcode/invite join-request endpoints, the waiting
 * poll, and the post-admission redirect without coupling that proof to the
 * product's own `/new` and `/join` presentation.
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

  const [roomId, setRoomId] = useState("");
  const [passcode, setPasscode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [joinError, setJoinError] = useState("");
  const [joinRequest, setJoinRequest] = useState<JoinRequest | null>(null);

  /**
   * An invite link carries its capability in `?invite=`, so opening one
   * previews immediately -- the same first step the product join route takes.
   */
  useEffect(() => {
    if (!initialInviteToken) return;
    let active = true;
    void (async () => {
      try {
        const result = await client.previewInvite(initialInviteToken);
        if (active) setPreview(result);
      } catch (error) {
        if (active) setStatus(describeError(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [client, initialInviteToken]);

  /**
   * While a request is waiting, poll its private status the same way the
   * product join page does, and follow the same admitted-redirect.
   */
  useEffect(() => {
    if (!joinRequest || joinRequest.status !== "waiting") return;
    let active = true;
    const check = async () => {
      try {
        const result = await client.getMyJoinRequest(joinRequest.id);
        if (!active || !result.ok) return;
        setJoinRequest(result.data);
        if (result.data.status === "admitted") {
          router.push(`/room/${encodeURIComponent(result.data.roomId)}`);
        }
      } catch {
        /* transient polling failures retain the safe waiting state */
      }
    };
    const interval = window.setInterval(() => void check(), 500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, joinRequest, router]);

  async function previewInvite() {
    setStatus("Working…");
    try {
      setPreview(await client.previewInvite(inviteToken));
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

  async function requestJoinByPasscode() {
    setStatus("Working…");
    setJoinError("");
    try {
      const result = await client.requestJoinByPasscode({
        roomId,
        passcode,
        displayName,
        role,
      });
      setStatus("Ready");
      if (!result.ok) {
        setJoinError(result.error.message);
        return;
      }
      setJoinRequest(result.data.joinRequest);
    } catch (error) {
      setStatus(describeError(error));
    }
  }

  async function requestJoinByInvite() {
    setStatus("Working…");
    setJoinError("");
    try {
      const result = await client.requestJoinByInvite({
        inviteToken,
        displayName,
        role,
      });
      setStatus("Ready");
      if (!result.ok) {
        setJoinError(result.error.message);
        return;
      }
      setJoinRequest(result.data.joinRequest);
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
          <p data-testid="created-owner-participant-id">{created.ownerParticipantId}</p>
          <p data-testid="created-passcode">{created.passcode}</p>
          <p data-testid="created-invite-url">{created.inviteUrl}</p>
        </section>
      ) : null}

      <section aria-label="Join by room ID and passcode">
        <label>
          Room ID
          <input data-testid="join-room-id" value={roomId} onChange={(event) => setRoomId(event.target.value)} />
        </label>
        <label>
          Passcode
          <input data-testid="join-passcode" value={passcode} onChange={(event) => setPasscode(event.target.value)} />
        </label>
        <label>
          Display name
          <input data-testid="join-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label>
          Role
          <input data-testid="join-role" value={role} onChange={(event) => setRole(event.target.value)} />
        </label>
        <button type="button" data-testid="request-join-by-passcode" onClick={() => void requestJoinByPasscode()}>
          Request admission by passcode
        </button>
      </section>

      <section aria-label="Join with an invitation">
        <label>
          Invite token
          <input
            data-testid="invite-token"
            value={inviteToken}
            onChange={(event) => setInviteToken(event.target.value)}
          />
        </label>
        <button type="button" data-testid="preview-invite" onClick={() => void previewInvite()}>
          Preview invitation
        </button>
        <button type="button" data-testid="request-join-by-invite" onClick={() => void requestJoinByInvite()}>
          Request admission by invite
        </button>
      </section>

      {preview ? (
        <section data-testid="invite-preview">
          {/*
            Serialized whole so the E2E can assert the *complete* pre-membership
            payload, not just the fields a friendly renderer chose to show.
          */}
          <pre data-testid="invite-preview-json">{JSON.stringify(preview)}</pre>
          <p data-testid="invite-valid">{String(preview.inviteValid)}</p>
          {preview.inviteValid ? (
            <>
              <p data-testid="preview-room-id">{preview.roomId}</p>
              <p data-testid="preview-title">{preview.title}</p>
              <p data-testid="preview-brief">{preview.brief}</p>
              <p data-testid="preview-owner-display-name">{preview.ownerDisplayName}</p>
            </>
          ) : null}
        </section>
      ) : null}

      {joinError ? <p data-testid="join-error">{joinError}</p> : null}

      {joinRequest ? (
        <section data-testid="join-request">
          <pre data-testid="join-request-json">{JSON.stringify(joinRequest)}</pre>
          <p data-testid="join-request-status">{joinRequest.status}</p>
        </section>
      ) : null}
    </main>
  );
}
