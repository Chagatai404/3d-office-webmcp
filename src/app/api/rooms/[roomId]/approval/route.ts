import { approveParticipantFinalDecision } from "@/domain/rooms/operations";
import {
  actionResponse,
  authenticateRoomRequest,
  invalidVersionResponse,
  mutationContext,
} from "@/app/api/_shared/request";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(
    request,
    auth.userId,
    "manual_ui",
    request.headers.get("x-human-confirmed") === "true",
  );
  if (!context) return invalidVersionResponse();
  const { roomId } = await params;
  return actionResponse(
    await approveParticipantFinalDecision(auth.repository, roomId, await request.json(), context),
  );
}
