import { NextResponse } from "next/server";
import { previewRoomInvitation } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

/**
 * Resolves an invitation capability into the narrow pre-membership preview.
 *
 * The token travels in the body, not the path, so it stays out of access logs
 * and `Referer` headers. No room version is expected: the caller holds no seat
 * yet and therefore cannot read one.
 */
export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { inviteToken?: unknown } | null;
  return actionResponse(
    await previewRoomInvitation(auth.repository, body?.inviteToken, {
      authUserId: auth.userId,
      origin: "manual_ui",
    }),
  );
}
