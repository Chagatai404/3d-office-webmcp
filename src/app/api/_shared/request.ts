import { NextResponse } from "next/server";
import type { ActionResult, ActionOrigin } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { createAuthenticatedServerClient } from "@/lib/supabase/server";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

export async function authenticateRoomRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token) return null;
  const client = createAuthenticatedServerClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    repository: new SupabaseRoomRepository(client),
  };
}

export function mutationContext(
  request: Request,
  userId: string,
  origin: ActionOrigin = "manual_ui",
  humanConfirmed = false,
): MutationContext | null {
  const raw = request.headers.get("if-match")?.replaceAll('"', "");
  const expectedRoomVersion = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isSafeInteger(expectedRoomVersion) || expectedRoomVersion < 0) return null;
  return {
    actor: { authUserId: userId, origin },
    expectedRoomVersion,
    humanConfirmed,
  };
}

/**
 * Absolute origin used to build shareable links. An explicit deployment URL
 * wins; otherwise the proxy-forwarded host, then the request URL itself.
 */
export function requestBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const protocol = request.headers.get("x-forwarded-proto") ?? "https";
    return `${protocol}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export function actionResponse<T>(result: ActionResult<T>) {
  const status = result.ok
    ? 200
    : result.error.code === "NOT_AUTHORIZED"
      ? 403
      : result.error.code === "STALE_ROOM_STATE"
        ? 409
        : result.error.code === "WRONG_PHASE"
          ? 409
          : 400;
  return NextResponse.json(result, { status, headers: { "Cache-Control": "no-store" } });
}

export function invalidVersionResponse() {
  return NextResponse.json(
    { error: "A non-negative integer If-Match room version is required." },
    { status: 428, headers: { "Cache-Control": "no-store" } },
  );
}
