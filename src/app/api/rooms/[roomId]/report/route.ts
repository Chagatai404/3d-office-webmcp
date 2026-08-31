import { NextResponse } from "next/server";
import { getFinalMeetingReport } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

/** Authenticated canonical JSON report for the finalized-room UI. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  return actionResponse(await getFinalMeetingReport(auth.repository, auth.userId, roomId));
}
