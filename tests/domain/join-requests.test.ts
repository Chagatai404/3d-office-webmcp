import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  admitJoinRequest,
  createRoom,
  getMeetingContext,
  getMyJoinRequest,
  listJoinRequests,
  rejectJoinRequest,
  requestJoinByInvite,
  requestJoinByPasscode,
} from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

type Actor = Awaited<ReturnType<typeof actor>>;

function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function mutation(userId: string, expectedRoomVersion: number) {
  return { actor: { authUserId: userId, origin: "manual_ui" as const }, expectedRoomVersion };
}

const roomInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks?",
  creatorName: "Maya",
  creatorRole: "Founder",
};

describe.sequential("dynamic join and owner admission", () => {
  let owner: Actor;
  let requester: Actor;
  let bystander: Actor;
  let admin: SupabaseClient;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    [owner, requester, bystander] = await Promise.all([actor(), actor(), actor()]);
  });

  async function createProductionRoom() {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
      baseUrl: "https://app.example",
    });
    if (!created.ok) throw new Error(created.error.message);
    return created.data;
  }

  function inviteTokenOf(inviteUrl: string): string {
    const token = new URL(inviteUrl).searchParams.get("invite");
    if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
    return token;
  }

  it("stores only a bcrypt passcode hash, never plaintext, and it is not browser-readable", async () => {
    const created = await createProductionRoom();
    expect(created.passcode).toMatch(/^[0-9A-Z]{6,}$/);

    const asOwner = await owner.client.from("rooms").select("passcode_hash").eq("id", created.roomId);
    expect(asOwner.error).toBeTruthy(); // passcode_hash is not in the granted column list, even for the room's own owner

    const asAdmin = await admin.from("rooms").select("passcode_hash").eq("id", created.roomId).single();
    expect(asAdmin.error).toBeNull();
    const passcodeHash = (asAdmin.data as { passcode_hash: string } | null)?.passcode_hash;
    expect(passcodeHash).toBeTruthy();
    expect(passcodeHash).not.toBe(created.passcode);
    expect(passcodeHash?.startsWith("$2")).toBe(true); // bcrypt
  });

  it("stores only a token hash for the generic invite, never the raw token", async () => {
    const created = await createProductionRoom();
    const rawToken = inviteTokenOf(created.inviteUrl);

    const invites = await admin.from("room_invites").select("token_hash").eq("room_id", created.roomId).single();
    expect(invites.error).toBeNull();
    const stored = (invites.data as { token_hash: string } | null)?.token_hash;
    expect(stored).toBe(sha256Hex(rawToken));
    expect(stored).not.toBe(rawToken);

    const asOutsider = await bystander.client.from("room_invites").select("id");
    expect(asOutsider.error).toBeTruthy();
  });

  it("creates a waiting request for the correct passcode and refuses a wrong one", async () => {
    const created = await createProductionRoom();

    const wrong = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: "WRONGCODE", displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(wrong).toMatchObject({ ok: false, error: { code: "INVALID_JOIN_CREDENTIALS" }, roomVersion: 0 });

    const right = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(right).toMatchObject({
      ok: true,
      data: { roomId: created.roomId, joinRequest: { status: "waiting", displayName: "Jane", role: "Designer" } },
    });

    // No participant is created merely by waiting.
    const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
    expect(room?.participants).toHaveLength(1);
  });

  it("is idempotent: a repeated passcode submission reuses the same waiting request", async () => {
    const created = await createProductionRoom();
    const submit = () =>
      requestJoinByPasscode(
        requester.repository,
        { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
        { authUserId: requester.userId, origin: "manual_ui" },
      );
    const first = await submit();
    const second = await submit();
    if (!first.ok || !second.ok) throw new Error("Expected both passcode requests to succeed.");
    expect(second.data.joinRequest.id).toBe(first.data.joinRequest.id);

    const waiting = await admin
      .from("join_requests")
      .select("id")
      .eq("room_id", created.roomId)
      .eq("requester_user_id", requester.userId)
      .eq("status", "waiting");
    expect(waiting.data).toHaveLength(1);
  });

  it("refuses a join request from a session that is already a participant", async () => {
    const created = await createProductionRoom();
    const result = await requestJoinByPasscode(
      owner.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Maya", role: "Founder" },
      { authUserId: owner.userId, origin: "manual_ui" },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ALREADY_PARTICIPANT" } });
  });

  it("creates a waiting request for a valid invite and refuses unknown, expired, and revoked tokens", async () => {
    const created = await createProductionRoom();

    const unknown = await requestJoinByInvite(
      requester.repository,
      { inviteToken: "not-a-live-capability", displayName: "Alex", role: "Engineer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(unknown).toMatchObject({ ok: false, error: { code: "INVALID_JOIN_CREDENTIALS" } });

    const expiredToken = `expired-${randomUUID()}`;
    await admin.from("room_invites").insert({
      room_id: created.roomId,
      token_hash: sha256Hex(expiredToken),
      created_by_participant_id: created.ownerParticipantId,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    } as never);
    const expired = await requestJoinByInvite(
      requester.repository,
      { inviteToken: expiredToken, displayName: "Alex", role: "Engineer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(expired).toMatchObject({ ok: false, error: { code: "INVALID_JOIN_CREDENTIALS" } });

    const revokedToken = `revoked-${randomUUID()}`;
    await admin.from("room_invites").insert({
      room_id: created.roomId,
      token_hash: sha256Hex(revokedToken),
      created_by_participant_id: created.ownerParticipantId,
      revoked_at: new Date().toISOString(),
    } as never);
    const revoked = await requestJoinByInvite(
      requester.repository,
      { inviteToken: revokedToken, displayName: "Alex", role: "Engineer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(revoked).toMatchObject({ ok: false, error: { code: "INVALID_JOIN_CREDENTIALS" } });

    const valid = await requestJoinByInvite(
      requester.repository,
      { inviteToken: inviteTokenOf(created.inviteUrl), displayName: "Alex", role: "Engineer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    expect(valid).toMatchObject({ ok: true, data: { joinRequest: { status: "waiting" } } });
  });

  it("lets only the owner list waiting requests, not an admitted participant or an outsider", async () => {
    const created = await createProductionRoom();
    const requested = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requested.ok) throw new Error(requested.error.message);

    const asOwner = await listJoinRequests(owner.repository, created.roomId, {
      authUserId: owner.userId, origin: "manual_ui",
    });
    expect(asOwner).toMatchObject({ ok: true, data: [{ displayName: "Jane" }] });

    const asBystander = await listJoinRequests(bystander.repository, created.roomId, {
      authUserId: bystander.userId, origin: "manual_ui",
    });
    expect(asBystander).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    // Admit a second human, then confirm that non-owner participant still
    // cannot see the waiting room even though they can now read the room.
    const secondRequest = await requestJoinByInvite(
      bystander.repository,
      { inviteToken: inviteTokenOf(created.inviteUrl), displayName: "Alex", role: "Engineer" },
      { authUserId: bystander.userId, origin: "manual_ui" },
    );
    if (!secondRequest.ok) throw new Error(secondRequest.error.message);
    const admitted = await admitJoinRequest(owner.repository, created.roomId, {
      joinRequestId: secondRequest.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    expect(admitted.ok).toBe(true);

    const asNewParticipant = await listJoinRequests(bystander.repository, created.roomId, {
      authUserId: bystander.userId, origin: "manual_ui",
    });
    expect(asNewParticipant).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("admits atomically: creates one participant bound to the requester with default authority", async () => {
    const created = await createProductionRoom();
    const requested = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requested.ok) throw new Error(requested.error.message);

    const admitted = await admitJoinRequest(owner.repository, created.roomId, {
      joinRequestId: requested.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    expect(admitted).toMatchObject({ ok: true, roomVersion: 1, data: { status: "admitted" } });

    const room = await getMeetingContext(requester.repository, requester.userId, created.roomId);
    expect(room?.version).toBe(1);
    expect(room?.participants).toHaveLength(2);
    const newParticipant = room?.participants.find((participant) => participant.id === room.selfParticipantId);
    expect(newParticipant).toMatchObject({
      name: "Jane",
      role: "Designer",
      kind: "human",
      meetingRole: "participant",
      decisionRole: "contributor",
      isClaimed: true,
    });

    const ownParticipantRow = await requester.client
      .from("participants")
      .select("user_id")
      .eq("id", newParticipant!.id)
      .single();
    expect(ownParticipantRow.data).toMatchObject({ user_id: requester.userId });

    const requestStatus = await getMyJoinRequest(requester.repository, requested.data.joinRequest.id, {
      authUserId: requester.userId, origin: "manual_ui",
    });
    expect(requestStatus).toMatchObject({ ok: true, data: { status: "admitted" } });
    if (requestStatus.ok) expect(requestStatus.data.resolvedAt).not.toBeNull();
  });

  it("rejects without creating a participant, and a second resolution fails safely", async () => {
    const created = await createProductionRoom();
    const requested = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requested.ok) throw new Error(requested.error.message);

    const rejected = await rejectJoinRequest(owner.repository, created.roomId, {
      joinRequestId: requested.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    expect(rejected).toMatchObject({ ok: true, roomVersion: 1, data: { status: "rejected" } });

    const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
    expect(room?.participants).toHaveLength(1);

    const secondAdmit = await admitJoinRequest(owner.repository, created.roomId, {
      joinRequestId: requested.data.joinRequest.id,
    }, mutation(owner.userId, 1));
    expect(secondAdmit).toMatchObject({ ok: false, error: { code: "REQUEST_ALREADY_RESOLVED" } });
    expect((await getMeetingContext(owner.repository, owner.userId, created.roomId))?.participants).toHaveLength(1);
  });

  it("refuses admission from a non-owner and from a request that belongs to a different room", async () => {
    const roomA = await createProductionRoom();
    const roomB = await createProductionRoom();

    const requestedInA = await requestJoinByPasscode(
      requester.repository,
      { roomId: roomA.roomId, passcode: roomA.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requestedInA.ok) throw new Error(requestedInA.error.message);

    // roomB's owner is the same auth user as roomA's owner here, but the
    // request still belongs to roomA -- the target room must be checked.
    const crossRoom = await admitJoinRequest(owner.repository, roomB.roomId, {
      joinRequestId: requestedInA.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    // A real, admitted non-owner participant of room A -- not just an
    // outsider -- must still be refused; owner authority is not membership.
    const bystanderJoined = await requestJoinByInvite(
      bystander.repository,
      { inviteToken: inviteTokenOf(roomA.inviteUrl), displayName: "Alex", role: "Engineer" },
      { authUserId: bystander.userId, origin: "manual_ui" },
    );
    if (!bystanderJoined.ok) throw new Error(bystanderJoined.error.message);
    const bystanderAdmitted = await admitJoinRequest(owner.repository, roomA.roomId, {
      joinRequestId: bystanderJoined.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    if (!bystanderAdmitted.ok) throw new Error(bystanderAdmitted.error.message);

    const nonOwnerAdmit = await admitJoinRequest(bystander.repository, roomA.roomId, {
      joinRequestId: requestedInA.data.joinRequest.id,
    }, mutation(bystander.userId, 1));
    expect(nonOwnerAdmit).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    expect((await getMeetingContext(owner.repository, owner.userId, roomA.roomId))?.participants).toHaveLength(2);
  });

  it("keeps a waiting outsider unable to read room state or another requester's status", async () => {
    const created = await createProductionRoom();
    const requested = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requested.ok) throw new Error(requested.error.message);

    expect(await getMeetingContext(requester.repository, requester.userId, created.roomId)).toBeNull();

    const own = await getMyJoinRequest(requester.repository, requested.data.joinRequest.id, {
      authUserId: requester.userId, origin: "manual_ui",
    });
    expect(own).toMatchObject({ ok: true, data: { status: "waiting", displayName: "Jane" } });

    const foreign = await getMyJoinRequest(bystander.repository, requested.data.joinRequest.id, {
      authUserId: bystander.userId, origin: "manual_ui",
    });
    expect(foreign).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    // The requester's own auth user id is not even in the granted column
    // list, so a direct table read cannot reference it at all -- only the
    // RLS-scoped SECURITY DEFINER RPC above can look a request up by id.
    const columnDenied = await requester.client.from("join_requests").select("requester_user_id");
    expect(columnDenied.error).toBeTruthy();

    // RLS scopes rows to this requester's own submissions across every room
    // they have ever asked to join, never anyone else's -- so this row is
    // present, but the count is not asserted here since earlier tests in
    // this sequential suite reuse the same requester actor.
    const unfiltered = await requester.client.from("join_requests").select("id");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data).toEqual(
      expect.arrayContaining([{ id: requested.data.joinRequest.id }]),
    );
  });

  it("records join.requested and join.admitted/rejected audit events without leaking secrets", async () => {
    const created = await createProductionRoom();
    const requested = await requestJoinByPasscode(
      requester.repository,
      { roomId: created.roomId, passcode: created.passcode, displayName: "Jane", role: "Designer" },
      { authUserId: requester.userId, origin: "manual_ui" },
    );
    if (!requested.ok) throw new Error(requested.error.message);
    const admitted = await admitJoinRequest(owner.repository, created.roomId, {
      joinRequestId: requested.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    expect(admitted.ok).toBe(true);

    const events = await admin
      .from("audit_events")
      .select("action, sanitized_input, result")
      .eq("room_id", created.roomId)
      .order("created_at");
    expect(events.error).toBeNull();
    const actions = (events.data ?? []).map((event) => (event as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(["room.created", "join.requested", "join.admitted"]));
    const serialized = JSON.stringify(events.data);
    expect(serialized).not.toContain(created.passcode);
    expect(serialized).not.toContain(inviteTokenOf(created.inviteUrl));
  });
});
