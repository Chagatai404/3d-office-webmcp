import { NextResponse } from "next/server";
import { getMyJoinRequest } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

export async function GET(request: Request, { params }: { params: Promise<{ joinRequestId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { joinRequestId } = await params;
  return actionResponse(await getMyJoinRequest(auth.repository, joinRequestId, {
    authUserId: auth.userId, origin: "manual_ui",
  }));
}
