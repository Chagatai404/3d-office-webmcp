import { NextResponse } from "next/server";
import { readMeetingSourceContent } from "@/domain/rooms/sources";
import {
  actionResponse,
  authenticateRoomRequest,
} from "@/app/api/_shared/request";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string; sourceId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { roomId, sourceId } = await params;
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || null;
  const rawMaxChunks = Number(url.searchParams.get("maxChunks") ?? "5");

  return actionResponse(
    await readMeetingSourceContent(
      auth.repository,
      roomId,
      {
        sourceId,
        cursor,
        maxChunks: Number.isSafeInteger(rawMaxChunks) ? rawMaxChunks : 5,
      },
      { authUserId: auth.userId, origin: "manual_ui" },
    ),
  );
}
