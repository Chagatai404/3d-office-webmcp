"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { JoinRequest, RoomInvitePreview } from "@/contracts/room";
import styles from "@/components/onboarding/onboarding.module.css";
import {
  JOIN_REQUEST_CREATED_EVENT,
  readPendingJoinRequest,
  savePendingJoinRequest,
} from "@/webmcp/join-request-store";
import { useOnboardingWebMcpTools } from "@/webmcp/register-tools";

type Props = { roomId?: string; inviteToken?: string | null; client?: RoomOnboardingClient };

export function JoinRoom({ roomId: routeRoomId, inviteToken = null, client: suppliedClient }: Props) {
  useOnboardingWebMcpTools("join");
  const router = useRouter();
  const [client] = useState(() => suppliedClient ?? new ApiRoomOnboardingClient());
  const [roomId, setRoomId] = useState(routeRoomId ?? "");
  const [passcode, setPasscode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");
  const [preview, setPreview] = useState<RoomInvitePreview | null>(null);
  const [joinRequest, setJoinRequest] = useState<JoinRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  // Resumes a join request `join_meeting` (a WebMCP tool) created for this
  // browser session, whether it happened before this page mounted (read on
  // mount) or while it is already open (the `webmcp:join-request-created`
  // event `savePendingJoinRequest` dispatches).
  useEffect(() => {
    async function adopt(pendingRequest: { joinRequestId: string; roomId: string }) {
      const result = await client.getMyJoinRequest(pendingRequest.joinRequestId);
      if (result.ok) setJoinRequest(result.data);
    }
    const initial = readPendingJoinRequest();
    if (initial) void adopt(initial);

    function onCreated(event: Event) {
      const detail = (event as CustomEvent<{ joinRequestId: string; roomId: string }>).detail;
      if (detail) void adopt(detail);
    }
    window.addEventListener(JOIN_REQUEST_CREATED_EVENT, onCreated);
    return () => window.removeEventListener(JOIN_REQUEST_CREATED_EVENT, onCreated);
  }, [client]);

  useEffect(() => {
    if (!inviteToken) return;
    let active = true;
    client.previewInvite(inviteToken)
      .then((value) => {
        if (!active) return;
        setPreview(value);
        if (value.inviteValid) setRoomId(value.roomId);
      })
      .catch(() => { if (active) setError("We couldn’t check this invitation."); });
    return () => { active = false; };
  }, [client, inviteToken]);

  // Depends only on the id/status pair, not the whole `joinRequest` object --
  // every successful "still waiting" poll below produces a fresh object
  // reference, and depending on that would tear down and recreate this
  // interval on every tick instead of ticking steadily every 2s.
  useEffect(() => {
    if (!joinRequest || joinRequest.status !== "waiting") return;
    let active = true;
    const check = async () => {
      try {
        const result = await client.getMyJoinRequest(joinRequest.id);
        if (!active || !result.ok) return;
        setJoinRequest(result.data);
      } catch { /* transient polling failures retain the safe waiting state */ }
    };
    const interval = window.setInterval(() => void check(), 2000);
    return () => { active = false; window.clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- id/status is the intentional, minimal dependency; see the comment above.
  }, [client, joinRequest?.id, joinRequest?.status]);

  // Handles every path that can produce an admitted `joinRequest` -- the poll
  // above, but also `adopt()` finding a request that was already admitted by
  // the time this page (re)mounted -- so the "Opening the meeting..." state
  // always actually navigates instead of sometimes sitting there forever.
  useEffect(() => {
    if (joinRequest?.status === "admitted") {
      router.push(`/room/${encodeURIComponent(joinRequest.roomId)}`);
    }
  }, [joinRequest, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (!displayName.trim() || !role.trim() || (!inviteToken && (!roomId.trim() || !passcode))) {
      setError("Complete all join details.");
      return;
    }
    submitting.current = true;
    setPending(true);
    try {
      const result = inviteToken
        ? await client.requestJoinByInvite({ inviteToken, displayName: displayName.trim(), role: role.trim() })
        : await client.requestJoinByPasscode({ roomId: roomId.trim(), passcode, displayName: displayName.trim(), role: role.trim() });
      if (!result.ok) setError(result.error.message);
      else {
        setJoinRequest(result.data.joinRequest);
        savePendingJoinRequest({
          joinRequestId: result.data.joinRequest.id,
          roomId: result.data.roomId,
        }, false);
      }
    } catch {
      setError("We couldn’t submit your join request.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (joinRequest?.status === "waiting") return <JoinStatus title="Waiting for the meeting owner to admit you." detail="This page checks your private request status automatically." />;
  if (joinRequest?.status === "rejected") return <JoinStatus title="Your join request was declined." detail="The owner did not admit this request." rejected />;
  if (joinRequest?.status === "admitted") return <JoinStatus title="You’re admitted." detail="Opening the meeting…" />;
  if (inviteToken && preview && !preview.inviteValid) return <JoinStatus title="This invitation can’t be used." detail="It may be invalid, expired, or revoked." rejected />;

  return (
    <main className={styles.joinPage}>
      <header className={styles.joinHeader}><Link className={styles.brand} href="/">Quorum</Link><span className={styles.secureLabel}>Secure waiting room</span></header>
      <section className={styles.joinStage}>
        <form className={styles.joinCard} onSubmit={submit} aria-label="Join meeting">
          <div className={styles.joinCardIntro}>
            <p className={styles.eyebrow}>{inviteToken ? "Invitation" : "Join meeting"}</p>
            <h1>{preview?.inviteValid ? preview.title : "Request a seat"}</h1>
            <p>{preview?.inviteValid ? preview.brief : "A valid passcode or invite lets you request admission. The owner decides who enters."}</p>
          </div>
          {!inviteToken ? <>
            <label>Room ID<input name="roomId" value={roomId} onChange={(event) => setRoomId(event.target.value)} /></label>
            <label>Passcode<input name="passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} /></label>
          </> : null}
          <label>Your name<input name="displayName" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          <label>Your role<input name="role" value={role} onChange={(event) => setRole(event.target.value)} placeholder="Designer" /></label>
          {error ? <div className={styles.claimFeedback} role="alert">{error}</div> : null}
          <button className={styles.submitButton} type="submit" disabled={pending || (Boolean(inviteToken) && !preview?.inviteValid)}>{pending ? "Requesting…" : "Request admission"}</button>
        </form>
      </section>
    </main>
  );
}

function JoinStatus({ title, detail, rejected = false }: { title: string; detail: string; rejected?: boolean }) {
  return <main className={styles.joinPage}><section className={styles.joinStage}><div className={styles.joinStateCard} role="status"><p className={styles.eyebrow}>{rejected ? "Request closed" : "Waiting room"}</p><h1>{title}</h1><p>{detail}</p>{rejected ? <Link className={styles.secondaryAction} href="/">Back to start</Link> : null}</div></section></main>;
}
