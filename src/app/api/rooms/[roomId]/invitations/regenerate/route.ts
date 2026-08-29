import { regenerateRoomInvitation } from "@/domain/rooms/operations";
import {
  actionResponse,
  authenticateRoomRequest,
  invalidVersionResponse,
  mutationContext,
  requestBaseUrl,
} from "@/app/api/_shared/request";

/**
 * Organizer-only invite rotation. The body names a target participant seat,
 * never an actor; organizer authority is derived from the authenticated
 * session in the database.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId } = await params;
  const body = await request.json().catch(() => null);
  return actionResponse(
    await regenerateRoomInvitation(
      auth.repository,
      roomId,
      body,
      context,
      requestBaseUrl(request),
    ),
  );
}
