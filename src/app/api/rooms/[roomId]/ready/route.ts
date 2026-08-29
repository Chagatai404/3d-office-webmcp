import { markMyInputReady } from "@/domain/rooms/operations";
import {
  actionResponse, authenticateRoomRequest, invalidVersionResponse, mutationContext,
} from "@/app/api/_shared/request";

/**
 * The caller marks their own input ready. The request carries no body: the
 * acting seat is derived from the authenticated session, never from input.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId } = await params;
  return actionResponse(await markMyInputReady(auth.repository, roomId, context));
}
