import { startDemoScenario } from "@/domain/rooms/operations";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";
import { createServiceRoleServerClient } from "@/lib/supabase/server";

/**
 * The visible, judge-facing "Reset demo" action.
 *
 * Deliberately distinct from `/api/dev/rooms/[roomId]/scenario`: that route
 * is a generic, `ALLOW_DEMO_RESET`-gated developer affordance that accepts a
 * `roomId` route param and any `StartDemoScenarioInput`. This route accepts
 * no room id and no mode/role from the request at all -- both are fixed
 * literals below -- so there is no arbitrary-`roomId` surface for a
 * service-role reset to reach, and it needs no env flag to be reliably
 * available to a judge in a normal deployment. `startDemoScenario` (and the
 * `start_demo_scenario` SQL function beneath it) independently re-check
 * `roomId === "demo"` and `service_role` regardless of what this route does,
 * so this is defense in depth, not the only guard.
 */
export async function POST(request: Request) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const demoRepository = new SupabaseRoomRepository(createServiceRoleServerClient());
  return actionResponse(
    await startDemoScenario(
      demoRepository,
      "demo",
      { mode: "solo_judge", humanRole: "product" },
      auth.userId,
    ),
  );
}
