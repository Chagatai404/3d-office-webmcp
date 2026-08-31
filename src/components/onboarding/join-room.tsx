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
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const submitting = useRef(false);

  function followInviteLink() {
    const target = parseInviteLink(linkDraft);
    if (!target) {
      setLinkError("That doesn’t look like a meeting invite link.");
      return;
    }
    setLinkError(null);
    router.push(target);
  }

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
            <div className={styles.pasteRow}>
              <label htmlFor="invite-link">Paste your invite link</label>
              <div className={styles.pasteField}>
                <input
                  id="invite-link"
                  name="inviteLink"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://…/room/…/join?invite=…"
                  value={linkDraft}
                  onChange={(event) => setLinkDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      followInviteLink();
                    }
                  }}
                />
                <button type="button" className={styles.inlineButton} onClick={followInviteLink}>
                  Continue
                </button>
              </div>
              {linkError ? <p className={styles.linkHint} role="alert">{linkError}</p> : null}
              <p className={styles.linkHint}>
                The link is the whole invitation — it carries the room and skips the code below.
              </p>
            </div>
            <details className={styles.manualJoin}>
              <summary>I only have a room code, not a link</summary>
              <div className={styles.manualJoinBody}>
                <label>Room ID<input name="roomId" value={roomId} onChange={(event) => setRoomId(event.target.value)} /></label>
                <label>Passcode<input name="passcode" type="password" value={passcode} onChange={(event) => setPasscode(event.target.value)} /></label>
              </div>
            </details>
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

/**
 * Turns a pasted invite URL (absolute or a bare path) into the local
 * `/room/{id}/join?invite=…` route. Returns null for anything that isn't a
 * meeting invite link, so the caller can show a hint instead of navigating.
 */
function parseInviteLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, window.location.origin);
  } catch {
    return null;
  }
  const match = url.pathname.match(/\/room\/([^/]+)\/join\/?$/);
  const invite = url.searchParams.get("invite");
  if (!match || !match[1] || !invite) return null;
  return `/room/${encodeURIComponent(decodeURIComponent(match[1]))}/join?invite=${encodeURIComponent(invite)}`;
}

function JoinStatus({ title, detail, rejected = false }: { title: string; detail: string; rejected?: boolean }) {
  return <main className={styles.joinPage}><section className={styles.joinStage}><div className={styles.joinStateCard} role="status"><p className={styles.eyebrow}>{rejected ? "Request closed" : "Waiting room"}</p><h1>{title}</h1><p>{detail}</p>{rejected ? <Link className={styles.secondaryAction} href="/">Back to start</Link> : null}</div></section></main>;
}
