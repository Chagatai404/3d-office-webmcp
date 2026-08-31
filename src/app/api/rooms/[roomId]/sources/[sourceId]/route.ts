import { NextResponse } from "next/server";
import { removeMeetingSource } from "@/domain/rooms/sources";
import {
  actionResponse,
  authenticateRoomRequest,
  invalidVersionResponse,
  mutationContext,
} from "@/app/api/_shared/request";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ roomId: string; sourceId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId, sourceId } = await params;
  return actionResponse(
    await removeMeetingSource(auth.repository, roomId, { sourceId }, context),
  );
}
