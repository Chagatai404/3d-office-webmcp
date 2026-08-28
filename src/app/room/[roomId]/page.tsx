import { notFound } from "next/navigation";
import { demoRoom } from "@/fixtures/demo-room";
import { createRoomVisualizationState } from "@/visualization/room-view-model";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  if (roomId !== demoRoom.id) notFound();

  const visualization = createRoomVisualizationState(demoRoom);

  return (
    <main className="shell">
      <p className="eyebrow">Room · {demoRoom.phase}</p>
      <h1>{demoRoom.title}</h1>
      <p className="lede">{demoRoom.brief}</p>
      <section className="panel" aria-labelledby="participants-heading">
        <div>
          <p className="label">Canonical room version</p>
          <p className="metric">{demoRoom.version}</p>
        </div>
        <div>
          <p className="label" id="participants-heading">
            Participants
          </p>
          <p className="metric">{visualization.participants.length}</p>
        </div>
        <div>
          <p className="label">Recent activity</p>
          <p className="metric">{visualization.recentActivity.length}</p>
        </div>
      </section>
      <p className="note">
        Baseline only: both the future 2D client and 3D scene consume the same
        canonical room state.
      </p>
    </main>
  );
}
