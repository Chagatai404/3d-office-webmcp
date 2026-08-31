import { NextResponse } from "next/server";
import { requestJoinByInvite } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";
import { consumeJoinAttempt, joinRateLimitResponse } from "@/app/api/_shared/join-rate-limit";

export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const target = typeof body === "object" && body !== null && "inviteToken" in body
    ? String(body.inviteToken)
    : "invalid-invite-request";
  const retryAfter = consumeJoinAttempt({ request, actorUserId: auth.userId, target: `invite:${target}` });
  if (retryAfter !== null) return joinRateLimitResponse(retryAfter);
  return actionResponse(await requestJoinByInvite(auth.repository, body, {
    authUserId: auth.userId, origin: "manual_ui",
  }));
}
