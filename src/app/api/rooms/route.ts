import { NextResponse } from "next/server";
import { createRoom } from "@/domain/rooms/operations";
import {
  actionResponse,
  authenticateRoomRequest,
  requestBaseUrl,
} from "@/app/api/_shared/request";

/**
 * Creates a private room. Thin adapter only: every creation rule, the
 * server-derived owner live in the domain and database layers. No room version
 * is expected, because the room does not exist yet.
 */
export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  return actionResponse(
    await createRoom(auth.repository, body, {
      actor: { authUserId: auth.userId, origin: "manual_ui" },
      baseUrl: requestBaseUrl(request),
    }),
  );
}
