import {
  createMeetingSourceInputSchema,
  meetingSourceVisibilitySchema,
  type CreateMeetingSourceInput,
  type MeetingSourceVisibility,
} from "@/contracts/room";

/**
 * Server-side text extraction for meeting sources. This module owns the file
 * -> chunks pipeline; the canonical JSON contract only ever sees the extracted
 * chunks, never the raw bytes.
 *
 * `text` types (`.txt`, `.md`, `.csv`, `.json`) are decoded and chunked inline
 * during upload, so the source lands `ready`. Binary types (`.pdf`, `.docx`)
 * have no registered extractor in this pass: they land `processing` and are
 * finished later by `mark_meeting_source_processed` (once a human re-supplies
 * readable text via the retry flow) or `mark_meeting_source_failed`. Register a
 * real parser in `BINARY_EXTRACTORS` to make them extract inline.
 */

const TEXT_SOURCE_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);
const TEXT_SOURCE_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".csv", ".json"]);

const BINARY_SOURCE_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const BINARY_SOURCE_EXTENSIONS = new Set([".pdf", ".docx"]);

export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const CHUNK_SIZE = 10_000;
export const MAX_CHUNKS = 200;

export const BINARY_EXTRACTION_UNAVAILABLE_MESSAGE =
  "Automatic text extraction for PDF and Word files is not enabled on this deployment. " +
  "Convert the file to Markdown or plain text (or paste its text), then retry the source.";

export type SourceKind = "text" | "binary-pending" | null;

type BinaryExtractor = (bytes: ArrayBuffer, filename: string) => Promise<string>;

/**
 * Intentionally empty. Adding e.g. `"application/pdf": extractPdf` here is the
 * only change needed to extract PDFs inline; the rest of the pipeline already
 * routes through it.
 */
const BINARY_EXTRACTORS: Record<string, BinaryExtractor> = {};

export function classifySource(filename: string, mimeType: string): SourceKind {
  const lowerName = filename.toLowerCase();
  const hasExt = (set: Set<string>) => [...set].some((ext) => lowerName.endsWith(ext));
  if (TEXT_SOURCE_TYPES.has(mimeType) || hasExt(TEXT_SOURCE_EXTENSIONS)) return "text";
  if (BINARY_SOURCE_TYPES.has(mimeType) || hasExt(BINARY_SOURCE_EXTENSIONS)) return "binary-pending";
  return null;
}

/** Runs the registered binary extractor if one exists; otherwise `null`. */
export async function extractBinarySource(
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
): Promise<string | null> {
  const extractor =
    BINARY_EXTRACTORS[mimeType] ??
    (filename.toLowerCase().endsWith(".pdf")
      ? BINARY_EXTRACTORS["application/pdf"]
      : filename.toLowerCase().endsWith(".docx")
        ? BINARY_EXTRACTORS[
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          ]
        : undefined);
  if (!extractor) return null;
  return extractor(bytes, filename);
}

export function chunkSourceText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  for (let index = 0; index < normalized.length; index += CHUNK_SIZE) {
    chunks.push(normalized.slice(index, index + CHUNK_SIZE));
  }
  return chunks;
}

export function summarizeSourceText(text: string): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 280 ? `${normalized.slice(0, 277)}...` : normalized;
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface ParsedSourceUpload {
  input: CreateMeetingSourceInput;
  /** Where the raw bytes belong in private storage; recorded, not required. */
  storagePath: string;
  /** Present only for `binary-pending` sources; kept for a follow-up extractor. */
  rawBytes: ArrayBuffer;
  kind: Exclude<SourceKind, null>;
}

export async function meetingSourceInputFromRequest(
  request: Request,
  roomId: string,
): Promise<ParsedSourceUpload | { error: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    const parsed = createMeetingSourceInputSchema.safeParse(await request.json());
    if (!parsed.success) return { error: "Meeting source input is invalid." };
    return {
      input: parsed.data,
      storagePath: "",
      rawBytes: new ArrayBuffer(0),
      kind: "text",
    };
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "A source file is required." };
  if (file.size > MAX_SOURCE_BYTES) return { error: "Source files are limited to 25 MB." };

  const filename = file.name.trim();
  const mimeType = file.type || "application/octet-stream";
  const kind = classifySource(filename, mimeType);
  if (kind === null) {
    return {
      error:
        "Only text, Markdown, CSV, JSON, PDF, and Word (.docx) sources are supported.",
    };
  }

  const visibility = parseVisibility(form.get("visibility"));
  if (!visibility) return { error: "Source visibility is invalid." };

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const storagePath = `rooms/${roomId}/sources/${sha256}/${filename}`;
  const titleField = stringField(form.get("title")) || filename;

  if (kind === "text") {
    const text = new TextDecoder().decode(bytes);
    const chunks = chunkSourceText(text);
    if (chunks.length === 0) return { error: "The source file did not contain readable text." };
    if (chunks.length > MAX_CHUNKS) {
      return { error: "The source file contains too much extracted text for this pass." };
    }
    const parsed = createMeetingSourceInputSchema.safeParse({
      title: titleField,
      filename,
      mimeType,
      byteSize: file.size,
      sha256,
      visibility,
      chunks,
      summary: summarizeSourceText(text),
    });
    if (!parsed.success) return { error: "Meeting source input is invalid." };
    return { input: parsed.data, storagePath, rawBytes: bytes, kind };
  }

  // binary-pending: create the row now, extract (or fail) out of band.
  const parsed = createMeetingSourceInputSchema.safeParse({
    title: titleField,
    filename,
    mimeType,
    byteSize: file.size,
    sha256,
    visibility,
    chunks: [],
    summary: null,
    expectsExtraction: true,
  });
  if (!parsed.success) return { error: "Meeting source input is invalid." };
  return { input: parsed.data, storagePath, rawBytes: bytes, kind };
}

function parseVisibility(value: FormDataEntryValue | null): MeetingSourceVisibility | null {
  const raw = stringField(value) || "shared_room";
  const parsed = meetingSourceVisibilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function stringField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}
