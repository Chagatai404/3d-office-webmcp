import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  createRoom,
  markMyInputReady,
  previewFinalDecision,
  requestJoinByInvite,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import { createMeetingSource } from "@/domain/rooms/sources";
import type { CreateRoomInput } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * Slices 4 & 6: participant inputs cite the meeting sources that informed
 * them, a citation to a source the caller cannot read is rejected, and the
 * frozen decision candidate carries deterministic `sourceProvenance` for the
 * shared sources only.
 */

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

function mutation(userId: string, expectedRoomVersion: number): MutationContext {
  return { actor: { authUserId: userId, origin: "manual_ui" }, expectedRoomVersion };
}

function inviteToken(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get("invite") ?? "";
}

const roomInput: CreateRoomInput = {
  title: "Source-cited decision",
  brief: "Decide the reduced onboarding scope using the attached context.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("meeting source provenance in decisions", () => {
  let owner: Awaited<ReturnType<typeof actor>>;
  let alice: Awaited<ReturnType<typeof actor>>;

  beforeAll(async () => {
    [owner, alice] = await Promise.all([actor(), actor()]);
  });

  it("carries shared-source provenance into the frozen candidate and rejects unreadable citations", async () => {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
    });
    if (!created.ok) throw new Error(created.error.message);
    const roomId = created.data.roomId;

    const join = await requestJoinByInvite(
      alice.repository,
      { inviteToken: inviteToken(created.data.inviteUrl), displayName: "Alice", role: "Engineer" },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    if (!join.ok) throw new Error(join.error.message);
    const admitted = await admitJoinRequest(
      owner.repository,
      roomId,
      { joinRequestId: join.data.joinRequest.id },
      mutation(owner.userId, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);
    let version = admitted.roomVersion;

    const sharedSha = "1".repeat(64);
    const shared = await createMeetingSource(
      owner.repository,
      roomId,
      {
        title: "Launch brief",
        filename: "brief.md",
        mimeType: "text/markdown",
        byteSize: 64,
        sha256: sharedSha,
        visibility: "shared_room",
        chunks: ["Ship the smallest complete onboarding scope before the campaign."],
        summary: "Reduced scope, fixed deadline.",
      },
      mutation(owner.userId, version),
    );
    if (!shared.ok) throw new Error(shared.error.message);
    version = shared.roomVersion;

    const priv = await createMeetingSource(
      alice.repository,
      roomId,
      {
        title: "Engineering note",
        filename: "eng.txt",
        mimeType: "text/plain",
        byteSize: 40,
        sha256: "2".repeat(64),
        visibility: "private_to_participant",
        chunks: ["No authentication rewrite is possible this quarter."],
        summary: "Auth rewrite is out of scope.",
      },
      mutation(alice.userId, version),
    );
    if (!priv.ok) throw new Error(priv.error.message);
    version = priv.roomVersion;

    // Owner cannot cite Alice's private source.
    const badPosition = await addParticipantPosition(
      owner.repository,
      roomId,
      {
        summary: "Scope must fit the deadline.",
        category: "outcome",
        priority: "high",
        referencedSourceIds: [priv.data.id],
        constraints: [],
      },
      mutation(owner.userId, version),
    );
    expect(badPosition).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const position = await addParticipantPosition(
      owner.repository,
      roomId,
      {
        summary: "Scope must fit the deadline.",
        category: "outcome",
        priority: "high",
        referencedSourceIds: [shared.data.id],
        constraints: [],
      },
      mutation(owner.userId, version),
    );
    if (!position.ok) throw new Error(position.error.message);
    version = position.roomVersion;

    const ready = await markMyInputReady(owner.repository, roomId, mutation(owner.userId, version));
    if (!ready.ok) throw new Error(ready.error.message);
    version = ready.roomVersion;

    const toProposals = await advanceRoomPhase(owner.repository, roomId, "proposals", mutation(owner.userId, version));
    if (!toProposals.ok) throw new Error(toProposals.error.message);
    version = toProposals.roomVersion;

    const badProposal = await submitParticipantProposal(
      owner.repository,
      roomId,
      {
        title: "Reduced scope",
        summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline.",
        expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [],
        referencedSourceIds: [priv.data.id],
        parentProposalId: null,
      },
      mutation(owner.userId, version),
    );
    expect(badProposal).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    const proposal = await submitParticipantProposal(
      owner.repository,
      roomId,
      {
        title: "Reduced scope",
        summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline.",
        expectedOutcomes: ["Launch on time"],
        referencedConstraintIds: [],
        referencedSourceIds: [shared.data.id],
        parentProposalId: null,
      },
      mutation(owner.userId, version),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    version = proposal.roomVersion;

    version = (await advanceRoomPhase(owner.repository, roomId, "deliberation", mutation(owner.userId, version))).roomVersion;
    version = (await advanceRoomPhase(owner.repository, roomId, "voting", mutation(owner.userId, version))).roomVersion;
    const toApproval = await advanceRoomPhase(owner.repository, roomId, "approval", mutation(owner.userId, version));
    if (!toApproval.ok) throw new Error(toApproval.error.message);
    version = toApproval.roomVersion;

    const preview = await previewFinalDecision(owner.repository, owner.userId, roomId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.data.proposal.referencedSourceIds).toEqual([shared.data.id]);
    expect(preview.data.sourceProvenance).toEqual([
      {
        sourceId: shared.data.id,
        uploadedByParticipantId: shared.data.uploadedByParticipantId,
        visibility: "shared_room",
        sha256: sharedSha,
        status: "ready",
      },
    ]);

    // Hash is stable across repeated previews of the same candidate.
    const second = await previewFinalDecision(owner.repository, owner.userId, roomId);
    if (!second.ok) throw new Error("second preview failed");
    expect(second.data.decisionHash).toBe(preview.data.decisionHash);
  });
});
