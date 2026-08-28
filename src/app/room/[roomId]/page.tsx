import { RoomClientView } from "./room-client";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  return <RoomClientView roomId={(await params).roomId} />;
}
