"use client";

import { useRoom } from "./room-provider";

export function MeetingBrief() {
  const { room } = useRoom();

  return (
    <section className="panel-block" aria-labelledby="brief-heading">
      <h2 className="panel-heading" id="brief-heading">
        Decision brief
      </h2>
      <p className="brief-text">{room.brief}</p>
      <p className="panel-note">
        Agents negotiate. People decide. Every action below is recorded against
        the participant who holds the authority for it.
      </p>
    </section>
  );
}
