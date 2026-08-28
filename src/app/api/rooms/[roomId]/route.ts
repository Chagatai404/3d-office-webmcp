import { NextResponse } from "next/server";
import { getMeetingContext } from "@/domain/rooms/operations";
import { authenticateRoomRequest } from "@/app/api/_shared/request";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  const room = await getMeetingContext(auth.repository, auth.userId, roomId);
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  return NextResponse.json(room, { headers: { "Cache-Control": "private, no-store" } });
}
