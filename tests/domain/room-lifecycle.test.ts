import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  advanceDemoRoomPhase,
  advanceRoomPhase,
  castParticipantVote,
  claimRoomInvitation,
  createRoom,
  getMeetingContext,
  markMyInputReady,
  raiseParticipantObjection,
  resolveParticipantObjection,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { CreateRoomInput, RoomState } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const inviteBaseUrl = "https://app.example";

/**
 * Every room here is created at runtime, so this suite never touches the shared
 * `demo` room and cannot race the demo-room domain suite.
 */
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

function ctx(session: Actor, expectedRoomVersion: number): MutationContext {
  return { actor: actorOf(session), expectedRoomVersion };
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

async function snapshot(session: Actor, roomId: string): Promise<RoomState> {
  const room = await getMeetingContext(session.repository, session.userId, roomId);
  if (!room) throw new Error(`Room ${roomId} is not readable by this session.`);
  return room;
}

async function version(session: Actor, roomId: string): Promise<number> {
  return (await snapshot(session, roomId)).version;
}

function seatOf(room: RoomState, name: string): string {
  const participant = room.participants.find((entry) => entry.name === name);
  if (!participant) throw new Error(`No seat named ${name}.`);
  return participant.id;
}

/** A created room whose two invited required participants have claimed their seats. */
async function seatedRoom(organizer: Actor, engineer: Actor, designer: Actor) {
  const created = await createRoom(organizer.repository, roomInput, {
    actor: actorOf(organizer),
    inviteBaseUrl,
  });
  if (!created.ok) throw new Error(`Room creation failed: ${created.error.message}`);
  const roomId = created.data.roomId;
  const [engineerInvite, designerInvite] = created.data.participantInvites;

  for (const [session, invite] of [
    [engineer, engineerInvite],
    [designer, designerInvite],
  ] as const) {
    const token = new URL(invite!.inviteUrl).searchParams.get("invite")!;
    const claim = await claimRoomInvitation(
      session.repository,
      { inviteToken: token },
      actorOf(session),
    );
    if (!claim.ok) throw new Error(`Seat claim failed: ${claim.error.message}`);
  }
  return roomId;
}

async function publishPosition(session: Actor, roomId: string, summary: string) {
  const result = await addParticipantPosition(
    session.repository,
    roomId,
    { summary, category: "scope", priority: "high", constraints: [] },
    ctx(session, await version(session, roomId)),
  );
  if (!result.ok) throw new Error(`Position failed: ${result.error.message}`);
  return result;
}

describe.sequential("participant readiness", () => {
  let organizer: Actor;
  let engineer: Actor;
  let designer: Actor;
  let bystander: Actor;
  let roomId = "";

  beforeAll(async () => {
    [organizer, engineer, designer, bystander] = await Promise.all([
      anonymousActor(),
      anonymousActor(),
      anonymousActor(),
      anonymousActor(),
    ]);
    roomId = await seatedRoom(organizer, engineer, designer);
  });

  it("refuses a session that holds no seat in the room", async () => {
    // Called straight at the repository, with the room's real current version:
    // the domain layer would already stop a non-member at "room not found", so
    // this proves the database itself refuses a caller who knows the opaque
    // room id and its version but holds no seat.
    const result = await bystander.repository.markMyInputReady(
      roomId,
      ctx(bystander, await version(organizer, roomId)),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
    });
  });

  it("refuses to mark ready before a position is published", async () => {
    const before = await version(organizer, roomId);
    const result = await markMyInputReady(
      organizer.repository,
      roomId,
      ctx(organizer, before),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
      roomVersion: before,
    });
    expect(await version(organizer, roomId)).toBe(before);
  });

  it("marks only the caller's own seat, bumping the version and auditing it", async () => {
    await publishPosition(organizer, roomId, "Ship a reduced but complete scope.");
    const before = await version(organizer, roomId);

    const result = await markMyInputReady(
      organizer.repository,
      roomId,
      ctx(organizer, before),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: before + 1 });

    // The version bump is what realtime notifies on; clients then refetch the
    // canonical snapshot rather than receiving state over the channel.
    const room = await snapshot(organizer, roomId);
    expect(room.version).toBe(before + 1);
    expect(
      room.participants.map((participant) => [participant.name, participant.isReady]),
    ).toEqual([
      ["Maya", true],
      ["Emre", false],
      ["Lina", false],
    ]);

    const audited = room.activity.filter(
      (event) => event.action === "participant.input_ready",
    );
    expect(audited).toHaveLength(1);
    expect(audited[0]).toMatchObject({
      actorType: "participant",
      actorId: seatOf(room, "Maya"),
      origin: "manual_ui",
      entityType: "participant",
      previousRoomVersion: before,
      resultingRoomVersion: before + 1,
    });
  });

  it("is idempotent for a seat that is already ready", async () => {
    const before = await version(organizer, roomId);
    const result = await markMyInputReady(
      organizer.repository,
      roomId,
      ctx(organizer, before),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: before });

    const room = await snapshot(organizer, roomId);
    expect(room.version).toBe(before);
    expect(
      room.activity.filter((event) => event.action === "participant.input_ready"),
    ).toHaveLength(1);
  });

  it("rejects a stale expected version", async () => {
    const before = await version(engineer, roomId);
    const result = await markMyInputReady(
      engineer.repository,
      roomId,
      ctx(engineer, before + 7),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "STALE_ROOM_STATE" },
      roomVersion: before,
    });
  });
});

describe.sequential("organizer-only room progression", () => {
  let organizer: Actor;
  let engineer: Actor;
  let designer: Actor;
  let outsider: Actor;
  let roomId = "";
  let proposalId = "";
  let conflictId = "";

  beforeAll(async () => {
    [organizer, engineer, designer, outsider] = await Promise.all([
      anonymousActor(),
      anonymousActor(),
      anonymousActor(),
      anonymousActor(),
    ]);
    roomId = await seatedRoom(organizer, engineer, designer);
  });

  it("refuses a claimed participant who is not the organizer", async () => {
    const before = await version(engineer, roomId);
    const result = await advanceRoomPhase(
      engineer.repository,
      roomId,
      "proposals",
      ctx(engineer, before),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "NOT_AUTHORIZED" },
      roomVersion: before,
    });
    expect((await snapshot(engineer, roomId)).phase).toBe("input");
  });

  it("refuses a session with no seat in the room", async () => {
    const result = await advanceRoomPhase(
      outsider.repository,
      roomId,
      "proposals",
      ctx(outsider, 0),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });

    // Even at the database boundary, organizer authority is what decides.
    const direct = await outsider.repository.advanceRoomPhase(
      roomId,
      "proposals",
      ctx(outsider, 0),
    );
    expect(direct).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("refuses the demo-only endpoint for a created room", async () => {
    const before = await version(organizer, roomId);
    const result = await advanceDemoRoomPhase(
      organizer.repository,
      roomId,
      "proposals",
      ctx(organizer, before),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" } });
  });

  it("refuses to skip a phase", async () => {
    const before = await version(organizer, roomId);
    const result = await advanceRoomPhase(
      organizer.repository,
      roomId,
      "voting",
      ctx(organizer, before),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "WRONG_PHASE" },
      roomVersion: before,
    });
  });

  it("holds the room in input until every required participant is ready", async () => {
    const attempt = async () =>
      advanceRoomPhase(
        organizer.repository,
        roomId,
        "proposals",
        ctx(organizer, await version(organizer, roomId)),
      );

    // Joined, but nobody has published a position yet.
    expect(await attempt()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("publish a position") },
    });

    await publishPosition(engineer, roomId, "Two weeks is only safe at reduced scope.");
    await publishPosition(designer, roomId, "The onboarding flow needs an accessible review.");
    expect(await attempt()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("mark their input ready") },
    });

    const engineerReady = await markMyInputReady(
      engineer.repository,
      roomId,
      ctx(engineer, await version(engineer, roomId)),
    );
    expect(engineerReady.ok).toBe(true);
    expect(await attempt()).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("mark their input ready") },
    });

    const designerReady = await markMyInputReady(
      designer.repository,
      roomId,
      ctx(designer, await version(designer, roomId)),
    );
    expect(designerReady.ok).toBe(true);
    expect((await snapshot(organizer, roomId)).phase).toBe("input");
  });

  it("advances input to proposals for the organizer and audits it", async () => {
    const before = await version(organizer, roomId);
    const result = await advanceRoomPhase(
      organizer.repository,
      roomId,
      "proposals",
      ctx(organizer, before),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: before + 1 });

    const room = await snapshot(organizer, roomId);
    expect(room).toMatchObject({ phase: "proposals", version: before + 1 });
    const advance = room.activity.filter(
      (event) => event.action === "room.phase_advanced",
    );
    expect(advance).toHaveLength(1);
    expect(advance[0]).toMatchObject({
      actorType: "participant",
      actorId: seatOf(room, "Maya"),
      origin: "manual_ui",
      sanitizedInput: { phase: "proposals" },
      previousRoomVersion: before,
      resultingRoomVersion: before + 1,
    });
  });

  it("closes readiness once the input phase is over", async () => {
    const before = await version(engineer, roomId);
    const result = await markMyInputReady(
      engineer.repository,
      roomId,
      ctx(engineer, before),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "WRONG_PHASE" },
      roomVersion: before,
    });
  });

  it("requires an active proposal before deliberation", async () => {
    const before = await version(organizer, roomId);
    expect(
      await advanceRoomPhase(organizer.repository, roomId, "deliberation", ctx(organizer, before)),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("active proposal") },
    });

    const proposal = await submitParticipantProposal(
      engineer.repository,
      roomId,
      {
        title: "Ship the reduced onboarding scope",
        summary: "Ship three of the five onboarding steps in two weeks.",
        rationale: "The remaining two steps carry the accessibility risk.",
        expectedOutcomes: ["Launch on time", "No accessibility regressions"],
        referencedConstraintIds: [],
        parentProposalId: null,
      },
      ctx(engineer, await version(engineer, roomId)),
    );
    expect(proposal.ok).toBe(true);

    const advanced = await advanceRoomPhase(
      organizer.repository,
      roomId,
      "deliberation",
      ctx(organizer, await version(organizer, roomId)),
    );
    expect(advanced.ok).toBe(true);

    const room = await snapshot(organizer, roomId);
    expect(room.phase).toBe("deliberation");
    proposalId = room.activeProposalId!;
    expect(proposalId).toBeTruthy();
  });

  it("keeps voting closed while a blocking conflict is open", async () => {
    const objection = await raiseParticipantObjection(
      designer.repository,
      roomId,
      {
        proposalId,
        constraintId: null,
        reason: "The reduced scope drops the accessibility review entirely.",
        severity: "blocking",
      },
      ctx(designer, await version(designer, roomId)),
    );
    expect(objection.ok).toBe(true);

    expect(
      await advanceRoomPhase(
        organizer.repository,
        roomId,
        "voting",
        ctx(organizer, await version(organizer, roomId)),
      ),
    ).toMatchObject({ ok: false, error: { code: "UNRESOLVED_BLOCKING_CONFLICT" } });
    expect((await snapshot(organizer, roomId)).phase).toBe("deliberation");

    const room = await snapshot(designer, roomId);
    conflictId = room.conflicts.find((conflict) => conflict.status === "open")!.id;
    const resolved = await resolveParticipantObjection(
      designer.repository,
      roomId,
      { conflictId, resolutionNote: "Accessibility review moves into the shipped scope." },
      ctx(designer, room.version),
    );
    expect(resolved.ok).toBe(true);

    const advanced = await advanceRoomPhase(
      organizer.repository,
      roomId,
      "voting",
      ctx(organizer, await version(organizer, roomId)),
    );
    expect(advanced.ok).toBe(true);
    expect((await snapshot(organizer, roomId)).phase).toBe("voting");
  });

  it("reuses the existing decision rules when entering approval", async () => {
    expect(
      await advanceRoomPhase(
        organizer.repository,
        roomId,
        "approval",
        ctx(organizer, await version(organizer, roomId)),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: expect.stringContaining("must vote") },
    });

    for (const voter of [engineer, designer]) {
      const vote = await castParticipantVote(
        voter.repository,
        roomId,
        { proposalId, choice: "support", comment: null },
        ctx(voter, await version(voter, roomId)),
      );
      expect(vote.ok).toBe(true);
    }

    const advanced = await advanceRoomPhase(
      organizer.repository,
      roomId,
      "approval",
      ctx(organizer, await version(organizer, roomId)),
    );
    expect(advanced.ok).toBe(true);

    const room = await snapshot(organizer, roomId);
    expect(room.phase).toBe("approval");
    expect(room.finalDecisionPreview?.decisionHash).toBeTruthy();
    expect(room.finalDecisionPreview?.missingApprovalParticipantIds).toEqual(
      [seatOf(room, "Emre"), seatOf(room, "Lina")].sort(),
    );
  });

  it("leaves finalization to the required humans", async () => {
    const before = await version(organizer, roomId);
    for (const phase of ["finalized", "voting"] as const) {
      expect(
        await advanceRoomPhase(organizer.repository, roomId, phase, ctx(organizer, before)),
      ).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" } });
    }

    const room = await snapshot(organizer, roomId);
    expect(room).toMatchObject({ phase: "approval", version: before, finalizedAt: null });
  });
});
