import { OrganizerSetup } from "@/components/onboarding/organizer-setup";

export default async function RoomSetupPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return <OrganizerSetup roomId={roomId} />;
}
