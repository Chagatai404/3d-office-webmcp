import { NextResponse } from "next/server";
import {
  markMeetingSourceFailed,
  markMeetingSourceProcessed,
} from "@/domain/rooms/sources";
import {
  actionResponse,
  authenticateRoomRequest,
  invalidVersionResponse,
  mutationContext,
} from "@/app/api/_shared/request";
import {
  BINARY_EXTRACTION_UNAVAILABLE_MESSAGE,
  MAX_CHUNKS,
  MAX_SOURCE_BYTES,
  chunkSourceText,
  classifySource,
  extractBinarySource,
  summarizeSourceText,
} from "../../upload";

export const dynamic = "force-dynamic";

/**
 * Finish a `processing` source, or retry a `failed` one. Accepts either
 * already-extracted `{ chunks, summary }` JSON, or a multipart file the human
 * re-selected (extracted here, then marked processed or failed).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string; sourceId: string }> },
) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const context = mutationContext(request, auth.userId);
  if (!context) return invalidVersionResponse();
  const { roomId, sourceId } = await params;

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return actionResponse(
      await markMeetingSourceProcessed(
        auth.repository,
        roomId,
        { sourceId, ...(await request.json()) },
        context,
      ),
    );
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "A source file is required." }, roomVersion: context.expectedRoomVersion },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_ERROR", message: "Source files are limited to 25 MB." }, roomVersion: context.expectedRoomVersion },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const filename = file.name.trim();
  const mimeType = file.type || "application/octet-stream";
  const bytes = await file.arrayBuffer();
  const kind = classifySource(filename, mimeType);

  let text: string | null = null;
  if (kind === "text") {
    text = new TextDecoder().decode(bytes);
  } else if (kind === "binary-pending") {
    text = await extractBinarySource(bytes, filename, mimeType);
  }

  if (text === null) {
    return actionResponse(
      await markMeetingSourceFailed(
        auth.repository,
        roomId,
        { sourceId, errorMessage: BINARY_EXTRACTION_UNAVAILABLE_MESSAGE },
        context,
      ),
    );
  }

  const chunks = chunkSourceText(text);
  if (chunks.length === 0 || chunks.length > MAX_CHUNKS) {
    return actionResponse(
      await markMeetingSourceFailed(
        auth.repository,
        roomId,
        {
          sourceId,
          errorMessage:
            chunks.length === 0
              ? "The file contained no readable text."
              : "The file contains too much extracted text for this pass.",
        },
        context,
      ),
    );
  }

  return actionResponse(
    await markMeetingSourceProcessed(
      auth.repository,
      roomId,
      { sourceId, chunks, summary: summarizeSourceText(text) },
      context,
    ),
  );
}
