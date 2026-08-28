import { RoomProvider } from "@/components/room/room-provider";
import { DesktopShell } from "@/components/shell/desktop-shell";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return (
    <RoomProvider roomId={roomId}>
      <DesktopShell />
    </RoomProvider>
  );
}