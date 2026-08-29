import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { createRoom, getMeetingContext } from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

const inviteBaseUrl = "https://app.example";

async function anonymousActor() {
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInAnonymously();
  if (error || !data.user || !data.session) {
    throw error ?? new Error("Anonymous auth failed.");
  }
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
  participants: [
    { name: "Maya", role: "Product Manager", requiredForApproval: false },
    { name: "Emre", role: "Engineer", requiredForApproval: true },
    { name: "Lina", role: "Designer", requiredForApproval: true },
  ],
};

function context(userId: string) {
  return { actor: { authUserId: userId, origin: "manual_ui" as const }, inviteBaseUrl };
}

describe.sequential("room creation and organizer authority", () => {
  let organizer: Awaited<ReturnType<typeof anonymousActor>>;
  let outsider: Awaited<ReturnType<typeof anonymousActor>>;

  beforeAll(async () => {
    organizer = await anonymousActor();
    outsider = await anonymousActor();
  });

  it("rejects creation without an authenticated session", async () => {
    const result = await createRoom(organizer.repository, roomInput, {
      actor: { authUserId: "", origin: "manual_ui" },
      inviteBaseUrl,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("rejects a room with fewer than two participants", async () => {
    const result = await createRoom(
      organizer.repository,
      { ...roomInput, participants: [roomInput.participants[0]!] },
      context(organizer.userId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects duplicate participant names", async () => {
    const result = await createRoom(
      organizer.repository,
      {
        ...roomInput,
        participants: [roomInput.participants[0]!, roomInput.participants[0]!],
      },
      context(organizer.userId),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });

  it("creates an opaque input-phase room seated by the organizer", async () => {
    const created = await createRoom(
      organizer.repository,
      roomInput,
      context(organizer.userId),
    );
    if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);

    expect(created.data.roomId).toMatch(/^rm_[0-9A-Z]{8}$/);
    expect(created.data.roomId).not.toBe("demo");

    const room = await getMeetingContext(
      organizer.repository,
      organizer.userId,
      created.data.roomId,
    );
    expect(room).toMatchObject({ phase: "input", version: 0, demoMode: null });
    expect(room?.participants.map((participant) => participant.name)).toEqual([
      "Maya",
      "Emre",
      "Lina",
    ]);
    expect(room?.selfParticipantId).toBe(room?.participants[0]?.id);
    expect(
      room?.participants.map((participant) => participant.isClaimed),
    ).toEqual([true, false, false]);
    expect(
      room?.participants.map((participant) => participant.requiredForApproval),
    ).toEqual([false, true, true]);
  });

  it("returns one distinct invite URL per unclaimed seat and audits creation", async () => {
    const created = await createRoom(
      organizer.repository,
      roomInput,
      context(organizer.userId),
    );
    if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);
    const roomId = created.data.roomId;

    const room = await getMeetingContext(organizer.repository, organizer.userId, roomId);
    expect(created.data.participantInvites).toHaveLength(2);
    expect(created.data.participantInvites.map((invite) => invite.role)).toEqual([
      "Engineer",
      "Designer",
    ]);
    expect(
      created.data.participantInvites.map((invite) => invite.participantId),
    ).toEqual(room?.participants.slice(1).map((participant) => participant.id));

    const inviteUrls = created.data.participantInvites.map((invite) => invite.inviteUrl);
    expect(new Set(inviteUrls).size).toBe(2);
    for (const inviteUrl of inviteUrls) {
      expect(inviteUrl.startsWith(`${inviteBaseUrl}/room/${roomId}/join?invite=`)).toBe(true);
      expect(new URL(inviteUrl).searchParams.get("invite")).toMatch(/^[0-9a-f]{64}$/);
    }

    expect(room?.activity).toHaveLength(1);
    expect(room?.activity[0]).toMatchObject({
      action: "room.created",
      actorType: "participant",
      actorId: room?.participants[0]?.id,
      origin: "manual_ui",
      entityType: "room",
      entityId: roomId,
      previousRoomVersion: 0,
      resultingRoomVersion: 0,
      confirmationRequired: false,
    });
    expect(JSON.stringify(room?.activity)).not.toContain(
      new URL(inviteUrls[0]!).searchParams.get("invite"),
    );
  });

  it("never lets a raw invite token reach the database or the room snapshot", async () => {
    const created = await createRoom(
      organizer.repository,
      roomInput,
      context(organizer.userId),
    );
    if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);
    const rawToken = new URL(created.data.participantInvites[0]!.inviteUrl)
      .searchParams.get("invite")!;

    const room = await getMeetingContext(
      organizer.repository,
      organizer.userId,
      created.data.roomId,
    );
    expect(JSON.stringify(room)).not.toContain(rawToken);

    // The invitation table is reachable only through SECURITY DEFINER functions.
    const invitations = await organizer.client
      .from("room_invitations")
      .select("token_hash")
      .eq("room_id", created.data.roomId);
    expect(invitations.data ?? []).toHaveLength(0);
  });

  it("derives the organizer from the session, not from the request", async () => {
    const created = await createRoom(
      organizer.repository,
      roomInput,
      // A request body cannot carry organizer identity; even a hostile actor id
      // in the domain context only ever names the caller's own session.
      context(organizer.userId),
    );
    if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);

    const organizerCheck = await organizer.client.rpc("is_room_organizer", {
      target_room_id: created.data.roomId,
    });
    expect(organizerCheck.data).toBe(true);

    const outsiderCheck = await outsider.client.rpc("is_room_organizer", {
      target_room_id: created.data.roomId,
    });
    expect(outsiderCheck.data).toBe(false);

    // Organizer authority does not leak across rooms.
    const outsiderRoom = await createRoom(
      outsider.repository,
      roomInput,
      context(outsider.userId),
    );
    if (!outsiderRoom.ok) throw new Error("Second room creation failed.");
    expect(
      (await organizer.client.rpc("is_room_organizer", {
        target_room_id: outsiderRoom.data.roomId,
      })).data,
    ).toBe(false);
  });

  it("keeps a created room unreadable for a non-member", async () => {
    const created = await createRoom(
      organizer.repository,
      roomInput,
      context(organizer.userId),
    );
    if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);

    expect(
      await getMeetingContext(outsider.repository, outsider.userId, created.data.roomId),
    ).toBeNull();
  });

  it("leaves the seeded demo room untouched", async () => {
    const demo = await getMeetingContext(organizer.repository, organizer.userId, "demo");
    expect(demo).toMatchObject({ id: "demo", demoMode: "multi_user" });
    const demoRow = await organizer.client
      .from("rooms")
      .select("id,organizer_user_id")
      .eq("id", "demo")
      .maybeSingle();
    expect(demoRow.data?.organizer_user_id).toBeNull();
    expect(demo?.participants.map((participant) => participant.id)).toEqual([
      "demo-product",
      "demo-engineer",
      "demo-designer",
      "demo-marketing",
    ]);
  });
});
