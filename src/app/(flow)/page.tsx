"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { useFlowStage } from "@/components/onboarding/flow-stage";
import { useOnboardingWebMcpTools } from "@/webmcp/register-tools";

/**
 * Welcome — arriving inside the product, not in front of it.
 *
 * The screen is split: everything you read and press is a single column on
 * the left, and the room sits whole in its own frame on the right, seen from
 * outside as one object. Nothing here explains the product a second time; the
 * room already does that.
 *
 * "Create a meeting" is a real link, but with the stage mounted it flies the
 * camera into the room first and navigates on arrival. The frame opens from
 * the right-hand panel into the whole window on the same curve, so the room
 * travels to the centre as the camera moves in and the create form is
 * revealed by that move rather than replacing the page.
 */
export default function Home() {
  useOnboardingWebMcpTools("landing");
  const { enter, leaving } = useFlowStage();

  function flyToCreate(event: MouseEvent<HTMLAnchorElement>) {
    // Without a stage — no JavaScript yet, no WebGL, a new tab — the link is
    // left to do exactly what it says.
    if (!enter) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;

    event.preventDefault();
    enter("/new", "create");
  }

  function flyToJoin(event: MouseEvent<HTMLAnchorElement>) {
    if (!enter) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.button !== 0) return;

    event.preventDefault();
    enter("/join", "join");
  }

  return (
    <main className="flow-page welcome" data-leaving={leaving ? "" : undefined}>
      <div className="welcome-lead">
        <Link className="flow-brand" href="/">
          <span aria-hidden="true" className="flow-brand-mark" />
          <span className="flow-brand-name">Quorum</span>
          <span aria-hidden="true" className="flow-brand-divider" />
          <span className="flow-brand-tag">Decision rooms</span>
        </Link>

        <div className="welcome-intro">
          <h1 className="welcome-title">
            Walk in with a question. Leave with a decision.
          </h1>
          <p className="welcome-lede">
            A room where every seat holds one person — and, if they want, their
            own agent. Constraints, objections, alignment and decisions all happen
            in the same place, in the open.
          </p>

          <nav className="welcome-actions" aria-label="Enter a room">
            <Link
              className="flow-btn flow-btn-primary"
              href="/new"
              onClick={flyToCreate}
            >
              Create a meeting
            </Link>
            <Link
              className="flow-btn flow-btn-primary"
              href="/join"
              onClick={flyToJoin}
            >
              Join a meeting
            </Link>
            <Link className="flow-btn flow-btn-ghost" href="/room/demo">
              Open the demo room
            </Link>
          </nav>
        </div>

        <p className="flow-agent-note welcome-note">
          <span aria-hidden="true" className="flow-agent-note-dot" />
          Bring your own agent — it reads, drafts and negotiates from your seat.
          It never decides for you.
        </p>
      </div>
    </main>
  );
}
