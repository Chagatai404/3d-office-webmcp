import Link from "next/link";
import { CreateRoomForm } from "@/components/onboarding/create-room-form";

/**
 * Create — step one of the meeting flow.
 *
 * The room is already visible behind the form (the stage is owned by the flow
 * layout, so the camera glides here from the welcome pose rather than
 * cutting). Ported from the "Meeting Flow" design's create artboard.
 */
export default function NewRoomPage() {
  return (
    <main className="flow-page">
      <div className="flow-scrim flow-scrim-panel" aria-hidden="true" />

      <div className="flow-content">
        <div className="flow-topbar">
          <div className="flow-topbar-group">
            <Link className="flow-back" href="/">
              <span aria-hidden="true">←</span> Back
            </Link>
            <span className="flow-chip">
              <span aria-hidden="true" className="flow-brand-mark" />
              <span className="flow-chip-name">New meeting</span>
              <span aria-hidden="true" className="flow-chip-divider" />
              <span className="flow-chip-step">Step 1 · Set the question</span>
            </span>
          </div>
        </div>

        <CreateRoomForm />
      </div>

      <aside className="flow-caption" aria-label="About your room">
        <span className="flow-caption-fact">
          <span className="flow-caption-label">Your room</span>
          <strong className="flow-caption-value">Being prepared</strong>
        </span>
        <span aria-hidden="true" className="flow-caption-divider" />
        <span className="flow-caption-note">
          Seats appear at the table as roles are set.
        </span>
      </aside>
    </main>
  );
}
