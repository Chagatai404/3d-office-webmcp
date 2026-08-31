import { RoomE2EHarness } from "@/components/room/room-e2e-harness";
import { RoomProvider } from "@/components/room/room-provider";
import { MeetingShell } from "@/components/shell/meeting-shell";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  const useE2EHarness = process.env.E2E_ROOM_HARNESS === "true";

  return (
    <RoomProvider roomId={roomId}>
      {useE2EHarness ? <RoomE2EHarness /> : <MeetingShell />}
    </RoomProvider>
  );
}
