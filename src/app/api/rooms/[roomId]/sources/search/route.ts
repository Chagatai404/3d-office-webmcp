import { NextResponse } from "next/server";
import { searchMeetingSources } from "@/domain/rooms/sources";
import {
  actionResponse,
  authenticateRoomRequest,
} from "@/app/api/_shared/request";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  return actionResponse(
    await searchMeetingSources(
      auth.repository,
      roomId,
      await request.json(),
      { authUserId: auth.userId, origin: "manual_ui" },
    ),
  );
}
