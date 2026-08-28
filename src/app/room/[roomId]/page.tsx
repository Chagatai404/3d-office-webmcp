import { RoomProvider } from "@/components/room/room-provider";
import { DesktopShell } from "@/components/shell/desktop-shell";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  // Room existence is a server concern. The provider surfaces a load failure
  // rather than the page guessing which rooms exist.
  return (
    <RoomProvider roomId={roomId}>
      <DesktopShell />
    </RoomProvider>
  );
}
