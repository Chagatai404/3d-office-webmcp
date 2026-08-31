import { NextResponse } from "next/server";
import { transferOwnership } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest, invalidVersionResponse, mutationContext } from "@/app/api/_shared/request";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const [{ roomId }, body] = await Promise.all([params, request.json().catch(() => null)]);
  return actionResponse(await transferOwnership(auth.repository, roomId, body, context));
}
