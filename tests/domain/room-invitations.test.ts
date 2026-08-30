import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimRoomInvitation,
  createRoom,
  getMeetingContext,
  previewRoomInvitation,
  regenerateRoomInvitation,
  revokeRoomInvitation,
} from "@/domain/rooms/operations";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Auth failed.");
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, client, repository: new SupabaseRoomRepository(client) };
}

type Actor = Awaited<ReturnType<typeof actor>>;

describe.sequential("deprecated seat invitation compatibility", () => {
  let owner: Actor;
  let invitee: Actor;
  let admin: ReturnType<typeof createClient>;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    [owner, invitee] = await Promise.all([actor(), actor()]);
  });

  async function createProductionRoom() {
    const created = await createRoom(
      owner.repository,
      {
        title: "Invitation compatibility",
        brief: "Keep the old endpoint isolated while production creation stays creator-only.",
        creatorName: "Owner",
        creatorRole: "Founder",
      },
      { actor: { authUserId: owner.userId, origin: "manual_ui" } },
    );
    if (!created.ok) throw new Error(created.error.message);
    return created.data;
  }

  /** Explicit internal fixture; production `createRoom` never performs this. */
  async function addLegacySeat(roomId: string) {
    const participantId = `legacy-${randomUUID()}`;
    const rawToken = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
    const participant = await admin.from("participants").insert({
      id: participantId,
      room_id: roomId,
      name: "Legacy invitee",
      role: "Engineer",
      kind: "human",
      meeting_role: "participant",
      decision_role: "contributor",
      required_for_approval: false,
    } as never);
    if (participant.error) throw participant.error;
    const invitation = await admin.from("room_invitations").insert({
      room_id: roomId,
      participant_id: participantId,
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      created_by_user_id: owner.userId,
    } as never);
    if (invitation.error) throw invitation.error;
    return { participantId, rawToken };
  }

  it("normal creation produces only the bound owner and no invitation rows", async () => {
    const created = await createProductionRoom();
    expect(Object.keys(created).sort()).toEqual(["ownerParticipantId", "roomId"]);
    const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
    expect(room?.participants).toHaveLength(1);
    const invitations = await admin
      .from("room_invitations")
      .select("id")
      .eq("room_id", created.roomId);
    expect(invitations.error).toBeNull();
    expect(invitations.data).toEqual([]);
  });

  it("previews only the narrow legacy DTO and keeps its raw token private", async () => {
    const created = await createProductionRoom();
    const fixture = await addLegacySeat(created.roomId);
    const preview = await previewRoomInvitation(
      invitee.repository,
      fixture.rawToken,
      { authUserId: invitee.userId, origin: "manual_ui" },
    );
    expect(preview).toMatchObject({
      ok: true,
      data: {
        inviteValid: true,
        alreadyClaimed: false,
        roomId: created.roomId,
        participant: { id: fixture.participantId, role: "Engineer" },
      },
    });
    expect(JSON.stringify(preview)).not.toContain(fixture.rawToken);
    const stored = await admin
      .from("room_invitations")
      .select("token_hash")
      .eq("participant_id", fixture.participantId)
      .single();
    expect((stored.data as { token_hash: string } | null)?.token_hash)
      .not.toBe(fixture.rawToken);
  });

  it("atomically binds a legacy fixture seat to the claiming session", async () => {
    const created = await createProductionRoom();
    const fixture = await addLegacySeat(created.roomId);
    const claim = await claimRoomInvitation(
      invitee.repository,
      { inviteToken: fixture.rawToken },
      { authUserId: invitee.userId, origin: "manual_ui" },
    );
    expect(claim).toMatchObject({
      ok: true,
      data: { roomId: created.roomId, participantId: fixture.participantId },
      roomVersion: 1,
    });
    const room = await getMeetingContext(invitee.repository, invitee.userId, created.roomId);
    expect(room?.selfParticipantId).toBe(fixture.participantId);

    const secondClaim = await claimRoomInvitation(
      owner.repository,
      { inviteToken: fixture.rawToken },
      { authUserId: owner.userId, origin: "manual_ui" },
    );
    expect(secondClaim).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("keeps unknown capabilities non-disclosing", async () => {
    const result = await previewRoomInvitation(
      invitee.repository,
      "not-a-live-legacy-capability",
      { authUserId: invitee.userId, origin: "manual_ui" },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { inviteValid: false, alreadyClaimed: false },
    });
    if (result.ok) expect(Object.keys(result.data).sort()).toEqual([
      "alreadyClaimed",
      "inviteValid",
    ]);
  });

  it("retains owner-only revoke/regenerate behavior only for internal legacy seats", async () => {
    const created = await createProductionRoom();
    const fixture = await addLegacySeat(created.roomId);
    const revoked = await revokeRoomInvitation(
      owner.repository,
      created.roomId,
      { participantId: fixture.participantId },
      {
        actor: { authUserId: owner.userId, origin: "manual_ui" },
        expectedRoomVersion: 0,
      },
    );
    expect(revoked).toMatchObject({ ok: true, roomVersion: 1 });
    expect(await previewRoomInvitation(
      invitee.repository,
      fixture.rawToken,
      { authUserId: invitee.userId, origin: "manual_ui" },
    )).toMatchObject({ ok: true, data: { inviteValid: false } });

    const regenerated = await regenerateRoomInvitation(
      owner.repository,
      created.roomId,
      { participantId: fixture.participantId },
      {
        actor: { authUserId: owner.userId, origin: "manual_ui" },
        expectedRoomVersion: 1,
      },
      "https://app.example",
    );
    expect(regenerated).toMatchObject({ ok: true, roomVersion: 2 });
    if (!regenerated.ok) return;
    expect(regenerated.data.inviteUrl).toMatch(
      new RegExp(`^https://app\\.example/room/${created.roomId}/join\\?invite=`),
    );
    expect(regenerated.data.inviteUrl).not.toContain(fixture.rawToken);
  });
});
