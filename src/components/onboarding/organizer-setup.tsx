"use client";

import Link from "next/link";

/**
 * Deprecated compatibility page for old `/setup` bookmarks. Slice 1 sends a
 * newly-created owner straight to the room; general admission arrives in
 * Slice 2 and must not reuse the old predetermined-seat handoff.
 */
export function OrganizerSetup({ roomId }: { roomId: string }) {
  return (
    <main className="flow-page">
      <div className="flow-scrim flow-scrim-panel" aria-hidden="true" />
      <div className="flow-content flow-content-centered">
        <section className="flow-recovery" aria-labelledby="room-ready-title">
          <p className="flow-eyebrow">Meeting created</p>
          <h1 id="room-ready-title">Your room is ready.</h1>
          <p>
            You are already its owner and decision-maker. Participant admission
            will be added in the next product slice.
          </p>
          <div className="flow-actions">
            <Link className="flow-btn flow-btn-primary" href={`/room/${roomId}`}>
              Enter room
            </Link>
            <Link className="flow-btn flow-btn-ghost" href="/">Back to start</Link>
          </div>
        </section>
      </div>
    </main>
  );
}
