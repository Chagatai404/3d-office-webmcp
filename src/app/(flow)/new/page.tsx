import { CreateRoomForm } from "@/components/onboarding/create-room-form";
import { FlowPageChrome } from "@/components/onboarding/flow-page-chrome";

/**
 * Create — step one of the meeting flow.
 *
 * The room is already visible behind the form (the stage is owned by the flow
 * layout, so the camera glides here from the welcome pose rather than
 * cutting). Ported from the "Meeting Flow" design's create artboard.
 */
export default function NewRoomPage() {
  return (
    <FlowPageChrome
      backHref="/"
      brandLabel="New meeting"
      step="Step 1 · Set the question"
      caption={
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
      }
    >
      <CreateRoomForm />
    </FlowPageChrome>
  );
}
