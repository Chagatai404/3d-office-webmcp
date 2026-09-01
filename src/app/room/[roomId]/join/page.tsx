import { JoinRoom } from "@/components/onboarding/join-room";
import { FlowPageChrome } from "@/components/onboarding/flow-page-chrome";

export default async function JoinRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [{ roomId }, query] = await Promise.all([params, searchParams]);
  const inviteToken = typeof query.invite === "string" ? query.invite : null;

  return (
    <FlowPageChrome backHref="/" brandLabel="Join meeting" step="Request a seat">
      <JoinRoom roomId={roomId} inviteToken={inviteToken} />
    </FlowPageChrome>
  );
}
