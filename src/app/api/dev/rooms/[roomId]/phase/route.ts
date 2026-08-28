import { advanceDemoRoomPhase } from "@/domain/rooms/operations";
import {
  actionResponse, authenticateRoomRequest, invalidVersionResponse, mutationContext,
} from "@/app/api/_shared/request";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (process.env.ALLOW_DEMO_PHASE_TRANSITIONS !== "true") {
    return Response.json({ error: "Demo phase transitions are disabled." }, { status: 404 });
  }
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId } = await params;
  const body = (await request.json()) as { phase?: unknown };
  return actionResponse(
    await advanceDemoRoomPhase(auth.repository, roomId, body.phase as never, context),
  );
}
