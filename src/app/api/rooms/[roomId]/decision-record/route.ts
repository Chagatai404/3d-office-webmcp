import { getFinalDecisionRecord } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  return actionResponse(await getFinalDecisionRecord(auth.repository, auth.userId, roomId));
}
