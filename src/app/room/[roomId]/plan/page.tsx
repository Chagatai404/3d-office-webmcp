import { RoomProvider } from "@/components/room/room-provider";
import { FloorPlanShell } from "@/components/plan/plan-shell";
import "./plan.css";

/**
 * The 2D floor-plan view of a room.
 *
 * The same room, the same provider, and the same `RoomClient` as the 3D office
 * at `/room/[roomId]`. Only the projection and the presentation differ.
 */
export default async function RoomPlanPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return (
    <RoomProvider roomId={roomId}>
      <FloorPlanShell />
    </RoomProvider>
  );
}
