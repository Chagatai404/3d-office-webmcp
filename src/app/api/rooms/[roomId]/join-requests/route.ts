import { NextResponse } from "next/server";
import { listJoinRequests } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  return actionResponse(await listJoinRequests(auth.repository, roomId, {
    authUserId: auth.userId, origin: "manual_ui",
  }));
}
