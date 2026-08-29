import { advanceRoomPhase } from "@/domain/rooms/operations";
import {
  actionResponse, authenticateRoomRequest, invalidVersionResponse, mutationContext,
} from "@/app/api/_shared/request";

/**
 * Production, organizer-only phase progression. Distinct from
 * `/api/dev/rooms/[roomId]/phase`, which is demo-only and gated by an
 * environment flag; this route is always available and derives organizer
 * authority from the authenticated session in the database.
 */
export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId } = await params;
  const body = (await request.json().catch(() => null)) as { phase?: unknown } | null;
  return actionResponse(
    await advanceRoomPhase(auth.repository, roomId, body?.phase as never, context),
  );
}
