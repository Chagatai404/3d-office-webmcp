"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { JoinRequest, RoomInvitePreview } from "@/contracts/room";
import styles from "@/components/onboarding/onboarding.module.css";

type Props = { roomId?: string; inviteToken?: string | null; client?: RoomOnboardingClient };

export function JoinRoom({ roomId: routeRoomId, inviteToken = null, client: suppliedClient }: Props) {
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

  useEffect(() => {
    if (!joinRequest || joinRequest.status !== "waiting") return;
    let active = true;
    const check = async () => {
      try {
        const result = await client.getMyJoinRequest(joinRequest.id);
        if (!active || !result.ok) return;
        setJoinRequest(result.data);
        if (result.data.status === "admitted") router.push(`/room/${encodeURIComponent(result.data.roomId)}`);
      } catch { /* transient polling failures retain the safe waiting state */ }
    };
    const interval = window.setInterval(() => void check(), 2000);
    return () => { active = false; window.clearInterval(interval); };
  }, [client, joinRequest, router]);

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
      else setJoinRequest(result.data.joinRequest);
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
