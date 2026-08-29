import { JoinRoom } from "@/components/onboarding/join-room";

export default async function JoinRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ invite?: string | string[] }>;
}) {
  const [{ roomId }, query] = await Promise.all([params, searchParams]);
  const inviteToken = typeof query.invite === "string" ? query.invite : null;

  return <JoinRoom roomId={roomId} inviteToken={inviteToken} />;
}
