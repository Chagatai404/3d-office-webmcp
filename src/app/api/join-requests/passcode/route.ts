import { NextResponse } from "next/server";
import { requestJoinByPasscode } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  return actionResponse(await requestJoinByPasscode(auth.repository, body, {
    authUserId: auth.userId, origin: "manual_ui",
  }));
}
