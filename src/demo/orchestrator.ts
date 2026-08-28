import { z } from "zod";
import { actionResultSchema, type ActionResult } from "@/contracts/room";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Settles only the deterministic shared demo. The database operation accepts
 * no actor or reaction parameters, so callers cannot direct simulation
 * authority toward a participant or action of their choosing.
 */
export async function settleSoloDemoScenario(
  client: SupabaseClient,
  roomId: string,
): Promise<ActionResult> {
  const { data, error } = await client.rpc("run_solo_demo_orchestration", {
    p_room_id: roomId,
  });
  if (error) throw new Error(error.message);
  return actionResultSchema(z.null()).parse(data) as ActionResult;
}
