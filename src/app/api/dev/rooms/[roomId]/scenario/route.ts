import { startDemoScenarioInputSchema } from "@/contracts/room";
import { startDemoScenario } from "@/domain/rooms/operations";
import {
  actionResponse,
  authenticateRoomRequest,
} from "@/app/api/_shared/request";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";
import { createServiceRoleServerClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  if (process.env.ALLOW_DEMO_RESET !== "true") {
    return Response.json({ error: "Demo reset is disabled." }, { status: 404 });
  }
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  const parsed = startDemoScenarioInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid demo scenario input." }, { status: 400 });
  }
  const demoRepository = new SupabaseRoomRepository(createServiceRoleServerClient());
  return actionResponse(
    await startDemoScenario(demoRepository, roomId, parsed.data, auth.userId),
  );
}
