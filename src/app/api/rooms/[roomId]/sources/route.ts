import { NextResponse } from "next/server";
import {
  createMeetingSource,
  listMeetingSources,
} from "@/domain/rooms/sources";
import {
  actionResponse,
  authenticateRoomRequest,
  invalidVersionResponse,
  mutationContext,
} from "@/app/api/_shared/request";
import { meetingSourceInputFromRequest } from "./upload";

export const dynamic = "force-dynamic";

const SOURCE_STORAGE_BUCKET = "meeting-sources";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;
  return actionResponse(
    await listMeetingSources(auth.repository, roomId, {
      authUserId: auth.userId,
      origin: "manual_ui",
    }),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();

  const { roomId } = await params;
  const parsed = await meetingSourceInputFromRequest(request, roomId);
  if ("error" in parsed) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: parsed.error }, roomVersion: context.expectedRoomVersion },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input =
    parsed.storagePath.length > 0
      ? { ...parsed.input, storageBucket: SOURCE_STORAGE_BUCKET, storagePath: parsed.storagePath }
      : parsed.input;

  const result = await createMeetingSource(auth.repository, roomId, input, context);

  // Best-effort raw-byte archival to private storage. A storage failure never
  // fails the upload: the metadata row and extracted chunks are the source of
  // truth, and the bucket may not be provisioned in every environment.
  if (result.ok && parsed.rawBytes.byteLength > 0) {
    try {
      await auth.client.storage
        .from(SOURCE_STORAGE_BUCKET)
        .upload(parsed.storagePath, parsed.rawBytes, {
          contentType: parsed.input.mimeType,
          upsert: true,
        });
    } catch {
      // swallow: archival is not on the critical path
    }
  }

  return actionResponse(result);
}
