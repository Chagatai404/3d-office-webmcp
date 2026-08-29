import { NextResponse } from "next/server";
import { claimRoomInvitation } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

/**
 * Claims the one seat an invitation names. Thin adapter only: the capability is
 * resolved, validated and consumed atomically in the domain and database
 * layers. No room version is expected, because the caller cannot read the room
 * until this call succeeds.
 */
export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  return actionResponse(
    await claimRoomInvitation(auth.repository, body, {
      authUserId: auth.userId,
      origin: "manual_ui",
    }),
  );
}
