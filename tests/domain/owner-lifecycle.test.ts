import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  createRoom,
  getMeetingContext,
  lockMeeting,
  removeParticipant,
  requestJoinByInvite,
  requestJoinByPasscode,
  transferOwnership,
  unlockMeeting,
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

function mutation(userId: string, expectedRoomVersion: number) {
  return { actor: { authUserId: userId, origin: "manual_ui" as const }, expectedRoomVersion };
}

const roomInput: CreateRoomInput = {
  title: "Owner lifecycle scenario",
  brief: "Should we ship the reduced-scope onboarding revision?",
  creatorName: "Maya",
  creatorRole: "Founder",
};

describe.sequential("owner lifecycle: lock, removal, ownership transfer", () => {
  let owner: Actor;
  let alice: Actor; // admitted participant
  let bob: Actor; // admitted participant
  let outsider: Actor;
  let admin: SupabaseClient;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    [owner, alice, bob, outsider] = await Promise.all([actor(), actor(), actor(), actor()]);
  });

  function inviteTokenOf(inviteUrl: string): string {
    const token = new URL(inviteUrl).searchParams.get("invite");
    if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
    return token;
  }

  async function createRoomWithTwoParticipants() {
    const created = await createRoom(owner.repository, roomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
      baseUrl: "https://app.example",
    });
    if (!created.ok) throw new Error(created.error.message);

    const aliceRequest = await requestJoinByInvite(
      alice.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Alice", role: "Designer" },
      { authUserId: alice.userId, origin: "manual_ui" },
    );
    if (!aliceRequest.ok) throw new Error(aliceRequest.error.message);
    const aliceAdmitted = await admitJoinRequest(owner.repository, created.data.roomId, {
      joinRequestId: aliceRequest.data.joinRequest.id,
    }, mutation(owner.userId, 0));
    if (!aliceAdmitted.ok) throw new Error(aliceAdmitted.error.message);

    const bobRequest = await requestJoinByInvite(
      bob.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Bob", role: "Engineer" },
      { authUserId: bob.userId, origin: "manual_ui" },
    );
    if (!bobRequest.ok) throw new Error(bobRequest.error.message);
    const bobAdmitted = await admitJoinRequest(owner.repository, created.data.roomId, {
      joinRequestId: bobRequest.data.joinRequest.id,
    }, mutation(owner.userId, 1));
    if (!bobAdmitted.ok) throw new Error(bobAdmitted.error.message);

    const room = await getMeetingContext(owner.repository, owner.userId, created.data.roomId);
    if (!room) throw new Error("Room not readable after admission.");
    const aliceParticipantId = room.participants.find((p) => p.name === "Alice")!.id;
    const bobParticipantId = room.participants.find((p) => p.name === "Bob")!.id;

    return { ...created.data, aliceParticipantId, bobParticipantId, version: room.version };
  }

  describe("meeting lock", () => {
    it("lets the owner lock and unlock, and refuses a participant", async () => {
      const created = await createRoomWithTwoParticipants();

      const nonOwnerLock = await lockMeeting(alice.repository, created.roomId, mutation(alice.userId, created.version));
      expect(nonOwnerLock).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const locked = await lockMeeting(owner.repository, created.roomId, mutation(owner.userId, created.version));
      expect(locked).toMatchObject({ ok: true, roomVersion: created.version + 1 });

      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room?.isLocked).toBe(true);

      const unlocked = await unlockMeeting(owner.repository, created.roomId, mutation(owner.userId, created.version + 1));
      expect(unlocked).toMatchObject({ ok: true, roomVersion: created.version + 2 });
      expect((await getMeetingContext(owner.repository, owner.userId, created.roomId))?.isLocked).toBe(false);
    });

    it("refuses new passcode and invite join requests while locked, but keeps an existing waiting request manageable", async () => {
      const created = await createRoomWithTwoParticipants();
      const locked = await lockMeeting(owner.repository, created.roomId, mutation(owner.userId, created.version));
      if (!locked.ok) throw new Error(locked.error.message);

      const byPasscode = await requestJoinByPasscode(
        outsider.repository,
        { roomId: created.roomId, passcode: created.passcode, displayName: "Cara", role: "Marketing" },
        { authUserId: outsider.userId, origin: "manual_ui" },
      );
      expect(byPasscode).toMatchObject({ ok: false, error: { code: "MEETING_LOCKED" } });

      const secondOutsider = await actor();
      const byInvite = await requestJoinByInvite(
        secondOutsider.repository,
        { inviteToken: inviteTokenOf(created.inviteUrl), displayName: "Dan", role: "Support" },
        { authUserId: secondOutsider.userId, origin: "manual_ui" },
      );
      expect(byInvite).toMatchObject({ ok: false, error: { code: "MEETING_LOCKED" } });
    });

    it("still lets an already-admitted participant read and mutate the room while locked", async () => {
      const created = await createRoomWithTwoParticipants();
      const locked = await lockMeeting(owner.repository, created.roomId, mutation(owner.userId, created.version));
      if (!locked.ok) throw new Error(locked.error.message);

      const position = await addParticipantPosition(
        alice.repository,
        created.roomId,
        { summary: "Keep accessibility intact.", category: "quality", priority: "high", constraints: [] },
        mutation(alice.userId, locked.roomVersion),
      );
      expect(position.ok).toBe(true);
    });
  });

  describe("participant removal", () => {
    it("lets the owner remove an active human participant and rejects a non-owner", async () => {
      const created = await createRoomWithTwoParticipants();

      const nonOwnerRemove = await removeParticipant(
        alice.repository,
        created.roomId,
        { participantId: created.bobParticipantId },
        mutation(alice.userId, created.version),
      );
      expect(nonOwnerRemove).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const removed = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, created.version),
      );
      expect(removed).toMatchObject({ ok: true, roomVersion: created.version + 1 });
    });

    it("prevents the owner from removing themselves", async () => {
      const created = await createRoomWithTwoParticipants();
      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      const selfRemove = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: room!.ownerParticipantId },
        mutation(owner.userId, created.version),
      );
      expect(selfRemove).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
    });

    it("rejects a cross-room target and is safe against a duplicate removal", async () => {
      const roomA = await createRoomWithTwoParticipants();
      const roomB = await createRoomWithTwoParticipants();

      const crossRoom = await removeParticipant(
        owner.repository,
        roomA.roomId,
        { participantId: roomB.aliceParticipantId },
        mutation(owner.userId, roomA.version),
      );
      expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const first = await removeParticipant(
        owner.repository,
        roomA.roomId,
        { participantId: roomA.aliceParticipantId },
        mutation(owner.userId, roomA.version),
      );
      expect(first.ok).toBe(true);
      const duplicate = await removeParticipant(
        owner.repository,
        roomA.roomId,
        { participantId: roomA.aliceParticipantId },
        mutation(owner.userId, first.ok ? first.roomVersion : 0),
      );
      expect(duplicate).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });

    it("removes read and mutation authority from the removed participant's own session while preserving their history", async () => {
      const created = await createRoomWithTwoParticipants();
      const position = await addParticipantPosition(
        alice.repository,
        created.roomId,
        { summary: "Preserve the existing interaction pattern.", category: "quality", priority: "high", constraints: [] },
        mutation(alice.userId, created.version),
      );
      if (!position.ok) throw new Error("Setup failed.");

      const removed = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, position.roomVersion),
      );
      if (!removed.ok) throw new Error(removed.error.message);

      // Removed session loses room read authority entirely.
      expect(await getMeetingContext(alice.repository, alice.userId, created.roomId)).toBeNull();

      // Removed session loses mutation authority: `getRoom` for a removed
      // session now returns null (the same as an unrelated room), so the
      // domain layer's own pre-flight refuses the write before it can even
      // reach the database's redundant `status = 'active'` check.
      const staleWrite = await addParticipantPosition(
        alice.repository,
        created.roomId,
        { summary: "Should not be recorded.", category: "quality", priority: "low", constraints: [] },
        mutation(alice.userId, removed.roomVersion),
      );
      expect(staleWrite).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      // Historical contributions remain visible to an active member.
      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      expect(room?.positions.some((p) => p.participantId === created.aliceParticipantId)).toBe(true);
      const aliceRow = room?.participants.find((p) => p.id === created.aliceParticipantId);
      expect(aliceRow).toMatchObject({ status: "removed" });
      expect(aliceRow?.removedAt).not.toBeNull();
    });

    it("records a participant.removed audit event and bumps the room version exactly once", async () => {
      const created = await createRoomWithTwoParticipants();
      const removed = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: created.bobParticipantId },
        mutation(owner.userId, created.version),
      );
      expect(removed).toMatchObject({ ok: true, roomVersion: created.version + 1 });

      const events = await admin
        .from("audit_events")
        .select("action, entity_id")
        .eq("room_id", created.roomId)
        .eq("action", "participant.removed");
      expect(events.data).toHaveLength(1);
      expect(events.data?.[0]).toMatchObject({ entity_id: created.bobParticipantId });
    });
  });

  describe("ownership transfer", () => {
    it("atomically moves authority: pointer, roles, exactly one owner, one version bump, and an audit event", async () => {
      const created = await createRoomWithTwoParticipants();
      const transferred = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, created.version),
      );
      expect(transferred).toMatchObject({ ok: true, roomVersion: created.version + 1 });

      const room = await getMeetingContext(alice.repository, alice.userId, created.roomId);
      expect(room?.ownerParticipantId).toBe(created.aliceParticipantId);
      const owners = room?.participants.filter((p) => p.meetingRole === "owner");
      expect(owners).toHaveLength(1);
      expect(owners?.[0]?.id).toBe(created.aliceParticipantId);

      const newOwner = room?.participants.find((p) => p.id === created.aliceParticipantId);
      expect(newOwner).toMatchObject({ meetingRole: "owner", decisionRole: "decision_maker" });

      const oldOwner = room?.participants.find((p) => p.name === "Maya");
      expect(oldOwner).toMatchObject({ meetingRole: "participant", decisionRole: "decision_maker" });

      const events = await admin
        .from("audit_events")
        .select("action")
        .eq("room_id", created.roomId)
        .eq("action", "ownership.transferred");
      expect(events.data).toHaveLength(1);
    });

    it("refuses a non-owner, a cross-room target, and an already-removed target", async () => {
      const created = await createRoomWithTwoParticipants();
      const otherRoom = await createRoomWithTwoParticipants();

      const nonOwner = await transferOwnership(
        alice.repository,
        created.roomId,
        { participantId: created.bobParticipantId },
        mutation(alice.userId, created.version),
      );
      expect(nonOwner).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const crossRoom = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: otherRoom.aliceParticipantId },
        mutation(owner.userId, created.version),
      );
      expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

      const removed = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, created.version),
      );
      if (!removed.ok) throw new Error(removed.error.message);
      const toRemoved = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, removed.roomVersion),
      );
      expect(toRemoved).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });

    it("refuses a simulation target", async () => {
      const created = await createRoomWithTwoParticipants();
      const simulationId = `simulation-${created.roomId}`;
      const insert = await admin.from("participants").insert({
        id: simulationId,
        room_id: created.roomId,
        name: "Simulated Advisor",
        role: "Advisor",
        kind: "simulation",
        meeting_role: "participant",
        decision_role: "advisor",
        required_for_approval: false,
      } as never);
      expect(insert.error).toBeNull();

      const toSimulation = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: simulationId },
        mutation(owner.userId, created.version),
      );
      expect(toSimulation).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    });

    it("revokes the old owner's authority immediately and grants it to the new owner", async () => {
      const created = await createRoomWithTwoParticipants();
      const transferred = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: created.aliceParticipantId },
        mutation(owner.userId, created.version),
      );
      if (!transferred.ok) throw new Error(transferred.error.message);

      const oldOwnerTriesLock = await lockMeeting(
        owner.repository,
        created.roomId,
        mutation(owner.userId, transferred.roomVersion),
      );
      expect(oldOwnerTriesLock).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const oldOwnerTriesRemove = await removeParticipant(
        owner.repository,
        created.roomId,
        { participantId: created.bobParticipantId },
        mutation(owner.userId, transferred.roomVersion),
      );
      expect(oldOwnerTriesRemove).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const oldOwnerTriesTransferBack = await transferOwnership(
        owner.repository,
        created.roomId,
        { participantId: created.bobParticipantId },
        mutation(owner.userId, transferred.roomVersion),
      );
      expect(oldOwnerTriesTransferBack).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

      const newOwnerLocks = await lockMeeting(
        alice.repository,
        created.roomId,
        mutation(alice.userId, transferred.roomVersion),
      );
      expect(newOwnerLocks.ok).toBe(true);
    });

    it("never allows two simultaneous transfer attempts to both succeed", async () => {
      const created = await createRoomWithTwoParticipants();

      const [toAlice, toBob] = await Promise.all([
        transferOwnership(
          owner.repository,
          created.roomId,
          { participantId: created.aliceParticipantId },
          mutation(owner.userId, created.version),
        ),
        transferOwnership(
          owner.repository,
          created.roomId,
          { participantId: created.bobParticipantId },
          mutation(owner.userId, created.version),
        ),
      ]);

      const outcomes = [toAlice, toBob];
      expect(outcomes.filter((result) => result.ok)).toHaveLength(1);
      expect(outcomes.filter((result) => !result.ok)).toHaveLength(1);

      const room = await getMeetingContext(owner.repository, owner.userId, created.roomId);
      const owners = room?.participants.filter((p) => p.meetingRole === "owner");
      expect(owners).toHaveLength(1);
      expect([created.aliceParticipantId, created.bobParticipantId]).toContain(room?.ownerParticipantId);
    });
  });
});
