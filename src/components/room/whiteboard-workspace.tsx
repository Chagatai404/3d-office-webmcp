"use client";

import { useMemo, useState, type FormEvent } from "react";
import type {
  MeetingSource,
  MeetingSourceContent,
  MeetingSourceSearchResults,
  MeetingSourceVisibility,
} from "@/contracts/room";
import { useRoom } from "./room-provider";

const ACCEPTED_SOURCE_TYPES =
  ".txt,.md,.markdown,.csv,.json,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type SourcePreview =
  | { status: "idle" | "loading" }
  | { status: "ready"; content: MeetingSourceContent }
  | { status: "failed"; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function visibilityLabel(visibility: MeetingSourceVisibility): string {
  return visibility === "shared_room" ? "Shared" : "Private";
}

function sourceStatusLabel(source: MeetingSource): string {
  if (source.status === "ready") return visibilityLabel(source.visibility);
  if (source.status === "failed") return "Failed";
  if (source.status === "processing") return "Processing";
  return "Uploading";
}

/** A seated participant's id, or `"input"` for the viewer's own upload tab. */
export type WhiteboardWorkspaceTab = string;

export function WhiteboardWorkspace({ tab }: { tab: WhiteboardWorkspaceTab }) {
  const { room, self, actions } = useRoom();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<MeetingSourceVisibility>("shared_room");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, SourcePreview>>({});
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<MeetingSourceSearchResults | null>(null);

  const sources = useMemo(
    () => room.sources.filter((source) => source.status !== "removed"),
    [room.sources],
  );
  const participantNames = useMemo(
    () => new Map(room.participants.map((participant) => [participant.id, participant.name])),
    [room.participants],
  );
  const canUpload = room.phase === "input" && self?.status === "active" && self.isClaimed;

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setError(null);
    if (!file) {
      setError("Choose a source file first.");
      return;
    }
    setBusy(true);
    try {
      const trimmedTitle = title.trim();
      const result = await actions.uploadMeetingSource({
        file,
        visibility,
        ...(trimmedTitle ? { title: trimmedTitle } : {}),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setFile(null);
      setTitle("");
      setNotice(`${result.data.title} is attached.`);
    } finally {
      setBusy(false);
    }
  }

  async function readSource(sourceId: string) {
    setPreviews((current) => ({ ...current, [sourceId]: { status: "loading" } }));
    const result = await actions.readMeetingSourceContent({
      sourceId,
      cursor: null,
      maxChunks: 3,
    });
    setPreviews((current) => ({
      ...current,
      [sourceId]: result.ok
        ? { status: "ready", content: result.data }
        : { status: "failed", message: result.error.message },
    }));
  }

  async function shareSource(sourceId: string) {
    setNotice(null);
    setError(null);
    const result = await actions.shareMeetingSource(sourceId);
    if (result.ok) setNotice(`${result.data.title} is shared with the room.`);
    else setError(result.error.message);
  }

  async function removeSource(sourceId: string) {
    setNotice(null);
    setError(null);
    const result = await actions.removeMeetingSource(sourceId);
    if (result.ok) setNotice("Source removed.");
    else setError(result.error.message);
  }

  async function retrySource(sourceId: string, retryFile: File) {
    setNotice(null);
    setError(null);
    const result = await actions.retryMeetingSource(sourceId, retryFile);
    if (result.ok && result.data.status === "ready") {
      setNotice(`${result.data.title} is ready.`);
    } else if (result.ok) {
      setError(result.data.errorMessage ?? "The source could not be processed.");
    } else {
      setError(result.error.message);
    }
  }

  async function searchSources(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchResult(null);
    const result = await actions.searchMeetingSources({
      query: trimmed,
      sourceIds: [],
      limit: 8,
    });
    if (result.ok) {
      setSearchResult(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }

  if (tab === "input") {
    return (
      <section className="panel-block source-workspace" aria-labelledby="sources-heading" data-testid="whiteboard-workspace">
        <h2 className="visually-hidden" id="sources-heading">Add a source</h2>

        <form className="source-form" onSubmit={onUpload}>
          <label className="source-field">
            <span>File</span>
            <input
              type="file"
              accept={ACCEPTED_SOURCE_TYPES}
              disabled={!canUpload || busy}
              onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <label className="source-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              placeholder={file?.name ?? "Optional display name"}
              disabled={!canUpload || busy}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>
          <label className="source-field">
            <span>Visibility</span>
            <select
              value={visibility}
              disabled={!canUpload || busy}
              onChange={(event) => setVisibility(event.currentTarget.value as MeetingSourceVisibility)}
            >
              <option value="shared_room">Shared with room</option>
              <option value="private_to_participant">Private to me</option>
            </select>
          </label>
          <button type="submit" className="button" disabled={!canUpload || busy}>
            {busy ? "Attaching..." : "Attach source"}
          </button>
        </form>

        {!canUpload ? (
          <p className="panel-empty">Sources can be attached by an admitted participant while the room is in Input.</p>
        ) : null}
        {notice ? <p className="source-notice" role="status">{notice}</p> : null}
        {error ? <p className="source-error" role="alert">{error}</p> : null}

        <form className="source-search" onSubmit={searchSources}>
          <input
            type="search"
            value={query}
            placeholder="Search attached sources"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button type="submit" className="button-quiet">Search</button>
        </form>

        {searchResult ? (
          <div className="source-search-results" aria-live="polite">
            {searchResult.results.length === 0 ? (
              <p className="panel-empty">No source excerpts matched.</p>
            ) : (
              searchResult.results.map((result) => (
                <article key={`${result.sourceId}-${result.chunkIndex}`} className="source-excerpt">
                  <span>{result.sourceTitle}</span>
                  <p>{result.excerpt}</p>
                </article>
              ))
            )}
          </div>
        ) : null}
      </section>
    );
  }

  const owner = room.participants.find((participant) => participant.id === tab);
  const theirSources = sources.filter((source) => source.uploadedByParticipantId === tab);

  return (
    <section className="panel-block source-workspace" aria-labelledby="sources-heading" data-testid="whiteboard-workspace">
      <div className="source-workspace-head">
        <div>
          <h2 className="panel-heading" id="sources-heading">{owner?.name ?? "Participant"}</h2>
        </div>
        <span className="source-count">{theirSources.length}</span>
      </div>

      <div className="source-list">
        {theirSources.length === 0 ? (
          <p className="panel-empty">No source files attached yet.</p>
        ) : (
          theirSources.map((source) => {
            const canManage =
              self !== null &&
              (source.uploadedByParticipantId === self.id ||
                (self.id === room.ownerParticipantId && self.meetingRole === "owner"));
            const preview = previews[source.id] ?? { status: "idle" };
            return (
              <article key={source.id} className="source-row" data-board-item={source.id}>
                <div className="source-row-main">
                  <span className="source-file-mark" aria-hidden="true" />
                  <div>
                    <h3>{source.title}</h3>
                    <p>
                      {source.filename} - {formatBytes(source.byteSize)} - {sourceStatusLabel(source)}
                      {" - "}
                      {participantNames.get(source.uploadedByParticipantId) ?? "Unknown uploader"}
                    </p>
                  </div>
                  <span className="source-hash">sha256 {source.sha256.slice(0, 12)}</span>
                </div>
                {source.summary ? <p className="source-summary">{source.summary}</p> : null}
                {source.status === "failed" && source.errorMessage ? (
                  <p className="source-error" role="alert">{source.errorMessage}</p>
                ) : null}
                {source.status === "processing" ? (
                  <p className="source-notice" role="status">Extracting text…</p>
                ) : null}
                <div className="source-actions">
                  {source.status === "ready" ? (
                    <button type="button" className="button-quiet" onClick={() => readSource(source.id)}>
                      {preview.status === "loading" ? "Reading..." : "Read preview"}
                    </button>
                  ) : null}
                  {source.visibility === "private_to_participant" && canManage && source.status === "ready" ? (
                    <button type="button" className="button-quiet" onClick={() => shareSource(source.id)}>
                      Share
                    </button>
                  ) : null}
                  {canManage && (source.status === "failed" || source.status === "processing") ? (
                    <label className="button-quiet source-retry">
                      {source.status === "failed" ? "Retry with a file" : "Finish with a file"}
                      <input
                        type="file"
                        accept={ACCEPTED_SOURCE_TYPES}
                        hidden
                        onChange={(event) => {
                          const retryFile = event.currentTarget.files?.[0];
                          if (retryFile) void retrySource(source.id, retryFile);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                  {canManage ? (
                    <button type="button" className="button-quiet" onClick={() => removeSource(source.id)}>
                      Remove
                    </button>
                  ) : null}
                </div>
                {preview.status === "ready" ? (
                  <div className="source-preview">
                    {preview.content.chunks.map((chunk) => (
                      <p key={chunk.id}>{chunk.text}</p>
                    ))}
                  </div>
                ) : preview.status === "failed" ? (
                  <p className="source-error" role="alert">{preview.message}</p>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
