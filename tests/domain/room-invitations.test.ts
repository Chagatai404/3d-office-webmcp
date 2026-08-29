import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimRoomInvitation,
  createRoom,
  getMeetingContext,
  previewRoomInvitation,
} from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const inviteBaseUrl = "https://app.example";

/**
 * The local secret key is generated per project, so it cannot be checked in.
 * This suite already assumes a CLI-managed local stack -- `npm run test:domain`
 * resets it first -- so asking the CLI is both correct and always current.
 */
function localSecretKey(): string {
  const configured = process.env.SUPABASE_SECRET_KEY;
  if (configured) return configured;
  const status = execFileSync("npx", ["supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const parsed = JSON.parse(status.slice(status.indexOf("{"))) as {
    SECRET_KEY?: string;
  };
  if (!parsed.SECRET_KEY) throw new Error("Local Supabase secret key unavailable.");
  return parsed.SECRET_KEY;
}

/**
 * Privileged client. Used only to age or revoke an invitation row, which has no
 * product surface until the P1 invite-management slice, and to prove that the
 * stored hash is the canonical SHA-256 of the raw capability.
 */
const admin = createClient(url, localSecretKey(), {
  auth: { persistSession: false },
});

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
    repository: new SupabaseRoomRepository(authenticatedClient),
  };
}

type Actor = Awaited<ReturnType<typeof anonymousActor>>;

function actorOf(session: Actor) {
  return { authUserId: session.userId, origin: "manual_ui" as const };
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

/** A fresh room plus the raw capabilities its creation returned exactly once. */
async function invitedRoom(organizer: Actor) {
  const created = await createRoom(organizer.repository, roomInput, {
    actor: actorOf(organizer),
    inviteBaseUrl,
  });
  if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);
  const [engineer, designer] = created.data.participantInvites.map((invite) => ({
    participantId: invite.participantId,
    role: invite.role,
    token: new URL(invite.inviteUrl).searchParams.get("invite")!,
  }));
  return { roomId: created.data.roomId, engineer: engineer!, designer: designer! };
}

describe.sequential("invitation preview", () => {
  let organizer: Actor;
  let invitee: Actor;
  let bystander: Actor;

  beforeAll(async () => {
    organizer = await anonymousActor();
    invitee = await anonymousActor();
    bystander = await anonymousActor();
  });

  it("shows a live invitation only its own safe fields", async () => {
    const room = await invitedRoom(organizer);

    const preview = await previewRoomInvitation(
      invitee.repository,
      room.engineer.token,
      actorOf(invitee),
    );
    if (!preview.ok) throw new Error(`Preview failed: ${preview.error.message}`);

    expect(preview.data).toEqual({
      inviteValid: true,
      alreadyClaimed: false,
      roomId: room.roomId,
      title: roomInput.title,
      brief: roomInput.brief,
      participant: {
        id: room.engineer.participantId,
        name: "Emre",
        role: "Engineer",
      },
    });
  });

  it("never turns a preview into a full-room read", async () => {
    const room = await invitedRoom(organizer);

    const preview = await previewRoomInvitation(
      invitee.repository,
      room.engineer.token,
      actorOf(invitee),
    );
    expect(preview).toMatchObject({ ok: true, data: { inviteValid: true } });

    // `can_read_room` still requires membership, which only a claim creates.
    expect(
      await getMeetingContext(invitee.repository, invitee.userId, room.roomId),
    ).toBeNull();
  });

  it("refuses an unknown token without naming a room", async () => {
    const preview = await previewRoomInvitation(
      invitee.repository,
      "0".repeat(64),
      actorOf(invitee),
    );
    expect(preview).toMatchObject({
      ok: true,
      data: { inviteValid: false, alreadyClaimed: false },
    });
  });

  it("refuses an expired token", async () => {
    const room = await invitedRoom(organizer);
    await expireInvitation(room.roomId, room.engineer.participantId);

    expect(
      await previewRoomInvitation(
        invitee.repository,
        room.engineer.token,
        actorOf(invitee),
      ),
    ).toMatchObject({ ok: true, data: { inviteValid: false, alreadyClaimed: false } });
  });

  it("refuses a revoked token", async () => {
    const room = await invitedRoom(organizer);
    await revokeInvitation(room.roomId, room.engineer.participantId);

    expect(
      await previewRoomInvitation(
        invitee.repository,
        room.engineer.token,
        actorOf(invitee),
      ),
    ).toMatchObject({ ok: true, data: { inviteValid: false, alreadyClaimed: false } });
  });

  it("shows a spent capability to its claimant and to nobody else", async () => {
    const room = await invitedRoom(organizer);
    const claimed = await claimRoomInvitation(
      invitee.repository,
      { inviteToken: room.engineer.token },
      actorOf(invitee),
    );
    expect(claimed.ok).toBe(true);

    expect(
      await previewRoomInvitation(
        invitee.repository,
        room.engineer.token,
        actorOf(invitee),
      ),
    ).toMatchObject({
      ok: true,
      data: { inviteValid: true, alreadyClaimed: true, roomId: room.roomId },
    });

    // Whoever else holds a copy of the spent link learns nothing about the room.
    expect(
      await previewRoomInvitation(
        bystander.repository,
        room.engineer.token,
        actorOf(bystander),
      ),
    ).toMatchObject({
      ok: true,
      data: { inviteValid: false, alreadyClaimed: true },
    });
  });

  it("requires an authenticated session and a token", async () => {
    const room = await invitedRoom(organizer);

    expect(
      await previewRoomInvitation(invitee.repository, room.engineer.token, {
        authUserId: "",
        origin: "manual_ui",
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    expect(
      await previewRoomInvitation(invitee.repository, "", actorOf(invitee)),
    ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
});

describe.sequential("invitation claim", () => {
  let organizer: Actor;
  let engineer: Actor;
  let designer: Actor;

  beforeAll(async () => {
    organizer = await anonymousActor();
    engineer = await anonymousActor();
    designer = await anonymousActor();
  });

  it("seats the claimant and opens the full room to them", async () => {
    const room = await invitedRoom(organizer);
    expect(
      await getMeetingContext(engineer.repository, engineer.userId, room.roomId),
    ).toBeNull();

    const claimed = await claimRoomInvitation(
      engineer.repository,
      { inviteToken: room.engineer.token },
      actorOf(engineer),
    );
    expect(claimed).toMatchObject({
      ok: true,
      roomVersion: 1,
      data: { roomId: room.roomId, participantId: room.engineer.participantId },
    });

    const state = await getMeetingContext(
      engineer.repository,
      engineer.userId,
      room.roomId,
    );
    expect(state?.version).toBe(1);
    expect(state?.selfParticipantId).toBe(room.engineer.participantId);
    expect(
      state?.participants.find((seat) => seat.id === room.engineer.participantId)
        ?.isClaimed,
    ).toBe(true);

    const claimEvents = (state?.activity ?? []).filter(
      (event) => event.action === "participant.seat_claimed",
    );
    expect(claimEvents).toHaveLength(1);
    expect(claimEvents[0]).toMatchObject({
      actorType: "participant",
      actorId: room.engineer.participantId,
      origin: "manual_ui",
      entityType: "participant",
      entityId: room.engineer.participantId,
      previousRoomVersion: 0,
      resultingRoomVersion: 1,
      confirmationRequired: false,
    });
    expect(JSON.stringify(state)).not.toContain(room.engineer.token);
  });

  it("claims only the seat the capability names", async () => {
    const room = await invitedRoom(organizer);

    expect(
      await claimRoomInvitation(
        engineer.repository,
        { inviteToken: room.engineer.token },
        actorOf(engineer),
      ),
    ).toMatchObject({ ok: true, data: { participantId: room.engineer.participantId } });

    // A second capability cannot widen an existing membership.
    expect(
      await claimRoomInvitation(
        engineer.repository,
        { inviteToken: room.designer.token },
        actorOf(engineer),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    // Neither can the organizer, who already holds the first seat.
    expect(
      await claimRoomInvitation(
        organizer.repository,
        { inviteToken: room.designer.token },
        actorOf(organizer),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    // The designer seat is untouched and still claimable by its own invitee.
    expect(
      await claimRoomInvitation(
        designer.repository,
        { inviteToken: room.designer.token },
        actorOf(designer),
      ),
    ).toMatchObject({ ok: true, data: { participantId: room.designer.participantId } });

    const state = await getMeetingContext(
      designer.repository,
      designer.userId,
      room.roomId,
    );
    expect(state?.selfParticipantId).toBe(room.designer.participantId);
    expect(state?.version).toBe(2);
  });

  it("is consumed exactly once across concurrent sessions", async () => {
    const room = await invitedRoom(organizer);

    const [first, second] = await Promise.all([
      claimRoomInvitation(
        engineer.repository,
        { inviteToken: room.engineer.token },
        actorOf(engineer),
      ),
      claimRoomInvitation(
        designer.repository,
        { inviteToken: room.engineer.token },
        actorOf(designer),
      ),
    ]);

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect(first.ok ? second : first).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
    });

    const winner = first.ok ? engineer : designer;
    const afterClaim = await getMeetingContext(
      winner.repository,
      winner.userId,
      room.roomId,
    );
    expect(afterClaim?.version).toBe(1);

    // Replaying one's own claim is a no-op, not a second seat and not a bump.
    expect(
      await claimRoomInvitation(
        winner.repository,
        { inviteToken: room.engineer.token },
        actorOf(winner),
      ),
    ).toMatchObject({
      ok: true,
      data: { participantId: room.engineer.participantId },
    });
    const afterReplay = await getMeetingContext(
      winner.repository,
      winner.userId,
      room.roomId,
    );
    expect(afterReplay?.version).toBe(1);
    expect(
      (afterReplay?.activity ?? []).filter(
        (event) => event.action === "participant.seat_claimed",
      ),
    ).toHaveLength(1);
  });

  it("rejects an unknown, expired or revoked capability", async () => {
    const unknown = await claimRoomInvitation(
      engineer.repository,
      { inviteToken: "0".repeat(64) },
      actorOf(engineer),
    );
    expect(unknown).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    const expiredRoom = await invitedRoom(organizer);
    await expireInvitation(expiredRoom.roomId, expiredRoom.engineer.participantId);
    const expired = await claimRoomInvitation(
      engineer.repository,
      { inviteToken: expiredRoom.engineer.token },
      actorOf(engineer),
    );
    expect(expired).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
    expect(expired.ok ? "" : expired.error.message).toMatch(/expired/i);

    const revokedRoom = await invitedRoom(organizer);
    await revokeInvitation(revokedRoom.roomId, revokedRoom.engineer.participantId);
    const revoked = await claimRoomInvitation(
      engineer.repository,
      { inviteToken: revokedRoom.engineer.token },
      actorOf(engineer),
    );
    expect(revoked).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
    expect(revoked.ok ? "" : revoked.error.message).toMatch(/revoked/i);

    // A refused capability leaves the room at its created version.
    expect(
      await getMeetingContext(organizer.repository, organizer.userId, revokedRoom.roomId),
    ).toMatchObject({ version: 0 });
  });

  it("requires an authenticated session and a well-formed capability", async () => {
    const room = await invitedRoom(organizer);

    expect(
      await claimRoomInvitation(
        engineer.repository,
        { inviteToken: room.engineer.token },
        { authUserId: "", origin: "manual_ui" },
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });

    for (const input of [{}, { inviteToken: "" }, { inviteToken: room.engineer.token, seatId: "x" }]) {
      expect(
        await claimRoomInvitation(
          engineer.repository,
          input as { inviteToken: string },
          actorOf(engineer),
        ),
      ).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
  });

  it("stores only the canonical hash of a capability", async () => {
    const room = await invitedRoom(organizer);

    const rows = await admin
      .from("room_invitations")
      .select("participant_id,token_hash,claimed_at,revoked_at")
      .eq("room_id", room.roomId);
    if (rows.error) throw new Error(rows.error.message);

    expect(rows.data).toHaveLength(2);
    expect(JSON.stringify(rows.data)).not.toContain(room.engineer.token);
    expect(
      rows.data?.find((row) => row.participant_id === room.engineer.participantId)
        ?.token_hash,
    ).toBe(createHash("sha256").update(room.engineer.token, "utf8").digest("hex"));
  });
});

/** No product surface ages an invitation, so the test does it directly. */
async function expireInvitation(roomId: string, participantId: string) {
  const result = await admin
    .from("room_invitations")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("room_id", roomId)
    .eq("participant_id", participantId)
    .select("id");
  if (result.error) throw new Error(result.error.message);
  expect(result.data).toHaveLength(1);
}

/** Revocation is a P1 product feature; the guard it depends on ships now. */
async function revokeInvitation(roomId: string, participantId: string) {
  const result = await admin
    .from("room_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .eq("participant_id", participantId)
    .select("id");
  if (result.error) throw new Error(result.error.message);
  expect(result.data).toHaveLength(1);
}
