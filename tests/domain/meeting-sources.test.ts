import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  admitJoinRequest,
  createRoom,
  getMeetingContext,
  requestJoinByInvite,
} from "@/domain/rooms/operations";
import {
  createMeetingSource,
  listMeetingSources,
  markMeetingSourceFailed,
  markMeetingSourceProcessed,
  readMeetingSourceContent,
  removeMeetingSource,
  searchMeetingSources,
  shareMeetingSource,
} from "@/domain/rooms/sources";
import type { CreateRoomInput } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, client, repository: new SupabaseRoomRepository(client) };
}

const roomInput: CreateRoomInput = {
  title: "Meeting Source Launch",
  brief: "Decide which uploaded launch context should shape the meeting.",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

function mutation(
  userId: string,
  expectedRoomVersion: number,
  origin: MutationContext["actor"]["origin"] = "manual_ui",
): MutationContext {
  return { actor: { authUserId: userId, origin }, expectedRoomVersion };
}

function inviteToken(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get("invite") ?? "";
}

describe.sequential("meeting source files", () => {
  let owner: Awaited<ReturnType<typeof actor>>;
  let alice: Awaited<ReturnType<typeof actor>>;

  beforeAll(async () => {
    [owner, alice] = await Promise.all([actor(), actor()]);
  });

  it("creates source metadata, stores content separately, and audits without raw text", async () => {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
    });
    if (!created.ok) throw new Error(created.error.message);

    const sourceText = "Launch goal: improve onboarding without rewriting authentication.";
    const added = await createMeetingSource(
      owner.repository,
      created.data.roomId,
      {
        title: "Launch brief",
        filename: "launch-brief.md",
        mimeType: "text/markdown",
        byteSize: sourceText.length,
        sha256: "d".repeat(64),
        visibility: "shared_room",
        chunks: [sourceText],
        summary: "Launch goal and auth guardrail.",
      },
      mutation(owner.userId, 0),
    );

    expect(added).toMatchObject({ ok: true, roomVersion: 1 });
    if (!added.ok) return;
    expect(added.data).toMatchObject({
      uploadedByParticipantId: created.data.ownerParticipantId,
      visibility: "shared_room",
      status: "ready",
      title: "Launch brief",
    });

    const room = await getMeetingContext(owner.repository, owner.userId, created.data.roomId);
    expect(room?.sources).toHaveLength(1);
    expect(JSON.stringify(room?.sources)).not.toContain(sourceText);

    const content = await readMeetingSourceContent(
      owner.repository,
      created.data.roomId,
      { sourceId: added.data.id, cursor: null, maxChunks: 5 },
      { authUserId: owner.userId, origin: "manual_ui" },
    );
    expect(content.ok).toBe(true);
    if (!content.ok) return;
    expect(content.data.chunks[0]?.text).toBe(sourceText);

    const events = await owner.client
      .from("audit_events")
      .select("action,sanitized_input")
      .eq("room_id", created.data.roomId)
      .eq("action", "source.uploaded");
    expect(events.error).toBeNull();
    expect(events.data).toHaveLength(1);
    expect(JSON.stringify(events.data?.[0]?.sanitized_input)).toContain("launch-brief.md");
    expect(JSON.stringify(events.data?.[0]?.sanitized_input)).not.toContain(sourceText);
  });

  it("keeps private sources visible only to the uploading participant", async () => {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
    });
    if (!created.ok) throw new Error(created.error.message);

    const join = await requestJoinByInvite(
      alice.repository,
      {
        inviteToken: inviteToken(created.data.inviteUrl),
        displayName: "Alice",
        role: "Engineer",
      },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    if (!join.ok) throw new Error(join.error.message);
    const admitted = await admitJoinRequest(
      owner.repository,
      created.data.roomId,
      { joinRequestId: join.data.joinRequest.id },
      mutation(owner.userId, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);

    const privateText = "Private launch risk: supplier terms are still under review.";
    const added = await createMeetingSource(
      owner.repository,
      created.data.roomId,
      {
        title: "Private owner note",
        filename: "owner-note.txt",
        mimeType: "text/plain",
        byteSize: privateText.length,
        sha256: "e".repeat(64),
        visibility: "private_to_participant",
        chunks: [privateText],
        summary: "Private supplier-risk note.",
      },
      mutation(owner.userId, admitted.roomVersion),
    );
    if (!added.ok) throw new Error(added.error.message);

    const ownerSources = await listMeetingSources(owner.repository, created.data.roomId, {
      authUserId: owner.userId,
      origin: "manual_ui",
    });
    expect(ownerSources.ok).toBe(true);
    if (!ownerSources.ok) return;
    expect(ownerSources.data.map((source) => source.id)).toContain(added.data.id);

    const aliceRoom = await getMeetingContext(alice.repository, alice.userId, created.data.roomId);
    expect(aliceRoom?.sources).toHaveLength(0);

    const aliceRead = await readMeetingSourceContent(
      alice.repository,
      created.data.roomId,
      { sourceId: added.data.id, cursor: null, maxChunks: 5 },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    expect(aliceRead).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
    });

    const shared = await shareMeetingSource(
      owner.repository,
      created.data.roomId,
      { sourceId: added.data.id },
      mutation(owner.userId, added.roomVersion),
    );
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.data.visibility).toBe("shared_room");

    const aliceSources = await listMeetingSources(alice.repository, created.data.roomId, {
      authUserId: alice.userId,
      origin: "manual_ui",
    });
    expect(aliceSources.ok).toBe(true);
    if (!aliceSources.ok) return;
    expect(aliceSources.data.map((source) => source.id)).toContain(added.data.id);

    const aliceSearch = await searchMeetingSources(
      alice.repository,
      created.data.roomId,
      { query: "supplier", sourceIds: [], limit: 5 },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    expect(aliceSearch.ok).toBe(true);
    if (!aliceSearch.ok) return;
    expect(aliceSearch.data.results[0]).toMatchObject({
      sourceId: added.data.id,
      sourceTitle: "Private owner note",
    });

    const removed = await removeMeetingSource(
      owner.repository,
      created.data.roomId,
      { sourceId: added.data.id },
      mutation(owner.userId, shared.roomVersion),
    );
    expect(removed.ok).toBe(true);

    const afterRemoval = await listMeetingSources(owner.repository, created.data.roomId, {
      authUserId: owner.userId,
      origin: "manual_ui",
    });
    expect(afterRemoval.ok).toBe(true);
    if (!afterRemoval.ok) return;
    expect(afterRemoval.data.map((source) => source.id)).not.toContain(added.data.id);
  });

  it("transitions a pending binary source through processing to ready, and back on retry", async () => {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
    });
    if (!created.ok) throw new Error(created.error.message);
    const roomId = created.data.roomId;

    const pending = await createMeetingSource(
      owner.repository,
      roomId,
      {
        title: "Product brief",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        byteSize: 4096,
        sha256: "1".repeat(64),
        visibility: "shared_room",
        chunks: [],
        summary: null,
        expectsExtraction: true,
      },
      mutation(owner.userId, 0),
    );
    if (!pending.ok) throw new Error(pending.error.message);
    expect(pending.data).toMatchObject({ status: "processing", processedAt: null });
    let version = pending.roomVersion;

    // A processing source has no readable chunks yet.
    const early = await readMeetingSourceContent(
      owner.repository,
      roomId,
      { sourceId: pending.data.id, cursor: null, maxChunks: 5 },
      { authUserId: owner.userId, origin: "manual_ui" },
    );
    expect(early.ok).toBe(true);
    if (early.ok) expect(early.data.chunks).toHaveLength(0);

    const failed = await markMeetingSourceFailed(
      owner.repository,
      roomId,
      { sourceId: pending.data.id, errorMessage: "PDF extraction is not enabled." },
      mutation(owner.userId, version),
    );
    if (!failed.ok) throw new Error(failed.error.message);
    expect(failed.data).toMatchObject({ status: "failed", errorMessage: "PDF extraction is not enabled." });
    version = failed.roomVersion;

    // Alice (neither uploader nor owner) cannot process it.
    const joinAlice = await requestJoinByInvite(
      alice.repository,
      { inviteToken: inviteToken(created.data.inviteUrl), displayName: "Alice", role: "Engineer" },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    if (!joinAlice.ok) throw new Error(joinAlice.error.message);
    const admittedAlice = await admitJoinRequest(
      owner.repository,
      roomId,
      { joinRequestId: joinAlice.data.joinRequest.id },
      mutation(owner.userId, version),
    );
    if (!admittedAlice.ok) throw new Error(admittedAlice.error.message);
    version = admittedAlice.roomVersion;

    const aliceAttempt = await markMeetingSourceProcessed(
      alice.repository,
      roomId,
      { sourceId: pending.data.id, chunks: ["Injected"], summary: null },
      mutation(alice.userId, version),
    );
    expect(aliceAttempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    const processed = await markMeetingSourceProcessed(
      owner.repository,
      roomId,
      { sourceId: pending.data.id, chunks: ["Extracted brief text."], summary: "Extracted brief." },
      mutation(owner.userId, version),
    );
    if (!processed.ok) throw new Error(processed.error.message);
    expect(processed.data).toMatchObject({ status: "ready", errorMessage: null, summary: "Extracted brief." });
    version = processed.roomVersion;

    const content = await readMeetingSourceContent(
      owner.repository,
      roomId,
      { sourceId: pending.data.id, cursor: null, maxChunks: 5 },
      { authUserId: owner.userId, origin: "manual_ui" },
    );
    expect(content.ok).toBe(true);
    if (content.ok) expect(content.data.chunks[0]?.text).toBe("Extracted brief text.");

    const events = await owner.client
      .from("audit_events")
      .select("action")
      .eq("room_id", roomId)
      .in("action", ["source.processed", "source.processing_failed"]);
    expect(events.data?.map((row) => row.action).sort()).toEqual([
      "source.processed",
      "source.processing_failed",
    ]);
  });
});
