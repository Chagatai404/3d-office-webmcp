import { JoinRoom } from "@/components/onboarding/join-room";
import { FlowPageChrome } from "@/components/onboarding/flow-page-chrome";

export default function JoinMeetingPage() {
  return (
    <FlowPageChrome backHref="/" brandLabel="Join meeting" step="Request a seat">
      <JoinRoom />
    </FlowPageChrome>
  );
}
