import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createRoom, getMeetingContext } from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function anonymousActor() {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const authenticatedClient = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    userId: data.user.id,
    client: authenticatedClient,
    repository: new SupabaseRoomRepository(authenticatedClient),
  };
}

const roomInput: CreateRoomInput = {
  title: "Two-Week Onboarding Launch",
  brief: "Should we ship the onboarding update within two weeks, and at what scope?",
  creatorName: "Maya",
  creatorRole: "Product Manager",
};

function context(userId: string) {
  return { actor: { authUserId: userId, origin: "manual_ui" as const } };
}

describe.sequential("creator-only room creation", () => {
  let creator: Awaited<ReturnType<typeof anonymousActor>>;
  let outsider: Awaited<ReturnType<typeof anonymousActor>>;

  beforeAll(async () => {
    creator = await anonymousActor();
    outsider = await anonymousActor();
  });

  it("rejects creation without an authenticated session", async () => {
    const result = await createRoom(creator.repository, roomInput, context(""));
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("strictly validates creator details", async () => {
    const result = await createRoom(
      creator.repository,
      { ...roomInput, creatorName: "   " },
      context(creator.userId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("atomically creates one bound human owner and a valid audit event", async () => {
    const created = await createRoom(creator.repository, roomInput, context(creator.userId));
    if (!created.ok) throw new Error(created.error.message);

    expect(created.data).toEqual({
      roomId: created.data.roomId,
      ownerParticipantId: created.data.ownerParticipantId,
    });
    expect(created.data.roomId).toMatch(/^rm_[0-9A-Z]{8}$/);

    const room = await getMeetingContext(creator.repository, creator.userId, created.data.roomId);
    expect(room).toMatchObject({
      phase: "input",
      version: 0,
      ownerParticipantId: created.data.ownerParticipantId,
      decisionPolicy: "owner_decides",
      selfParticipantId: created.data.ownerParticipantId,
      demoMode: null,
    });
    expect(room?.participants).toHaveLength(1);
    expect(room?.participants[0]).toMatchObject({
      id: created.data.ownerParticipantId,
      name: "Maya",
      role: "Product Manager",
      kind: "human",
      meetingRole: "owner",
      decisionRole: "decision_maker",
      isClaimed: true,
    });
    expect("requiredForApproval" in (room?.participants[0] ?? {})).toBe(false);
    expect(room?.activity).toHaveLength(1);
    expect(room?.activity[0]).toMatchObject({
      action: "room.created",
      actorType: "participant",
      actorId: created.data.ownerParticipantId,
      origin: "manual_ui",
      previousRoomVersion: 0,
      resultingRoomVersion: 0,
    });

    const participantRow = await creator.client
      .from("participants")
      .select("id,user_id,meeting_role,decision_role")
      .eq("room_id", created.data.roomId)
      .single();
    expect(participantRow.error).toBeNull();
    expect(participantRow.data).toMatchObject({
      id: created.data.ownerParticipantId,
      user_id: creator.userId,
      meeting_role: "owner",
      decision_role: "decision_maker",
    });

    const authoritySpoof = await creator.client
      .from("participants")
      .update({ meeting_role: "participant" })
      .eq("id", created.data.ownerParticipantId);
    expect(authoritySpoof.error).toBeTruthy();

    const legacyInvitations = await creator.client
      .from("room_invitations")
      .select("id")
      .eq("room_id", created.data.roomId);
    expect(legacyInvitations.error).toBeTruthy();
    if (serviceRoleKey) {
      const admin = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const internalInvitations = await admin
        .from("room_invitations")
        .select("id")
        .eq("room_id", created.data.roomId);
      expect(internalInvitations.error).toBeNull();
      expect(internalInvitations.data).toEqual([]);
    }
  });

  it("persists a requested equal-authority policy without fabricating seats", async () => {
    const created = await createRoom(
      creator.repository,
      { ...roomInput, decisionPolicy: "equal_authority_consensus" },
      context(creator.userId),
    );
    if (!created.ok) throw new Error(created.error.message);
    const room = await getMeetingContext(creator.repository, creator.userId, created.data.roomId);
    expect(room?.decisionPolicy).toBe("equal_authority_consensus");
    expect(room?.participants).toHaveLength(1);
  });

  it("derives ownership from auth.uid() and keeps outsiders out", async () => {
    const created = await createRoom(creator.repository, roomInput, context(creator.userId));
    if (!created.ok) throw new Error(created.error.message);
    expect((await creator.client.rpc("is_room_organizer", {
      target_room_id: created.data.roomId,
    })).data).toBe(true);
    expect((await outsider.client.rpc("is_room_organizer", {
      target_room_id: created.data.roomId,
    })).data).toBe(false);
    expect(await getMeetingContext(outsider.repository, outsider.userId, created.data.roomId)).toBeNull();
  });

  it("preserves the explicit seeded demo scenario", async () => {
    const demo = await getMeetingContext(creator.repository, creator.userId, "demo");
    expect(demo).toMatchObject({
      id: "demo",
      ownerParticipantId: "demo-product",
      decisionPolicy: "equal_authority_consensus",
    });
    expect(demo?.participants).toHaveLength(4);
    expect(demo?.participants.some((participant) => participant.kind === "simulation")).toBe(false);
  });
});
