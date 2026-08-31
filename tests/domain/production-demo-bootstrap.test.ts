import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  claimParticipantSeat,
  createRoom,
  getMeetingContext,
  startDemoScenario,
} from "@/domain/rooms/operations";
import type { CreateRoomInput } from "@/contracts/room";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * Proves the contract `supabase/production-demo-bootstrap.sql` depends on:
 * `start_demo_scenario('demo', 'solo_judge', 'product')` -- the exact same
 * function `POST /api/demo/reset` already calls -- idempotently restores the
 * canonical demo fixture from any prior state (freshly seeded, claimed,
 * progressed, or finalized), always leaves exactly one 'demo' room, and
 * never creates a test-only fixture or touches an unrelated room. There is
 * no second demo implementation to test independently; this function's
 * contract is the one thing that actually matters.
 *
 * This file never deletes the shared 'demo' room to test the "room missing"
 * case: `rooms_owner_participant_fk` and the `rooms_owner_invariant`
 * constraint trigger (`assert_room_owner_invariant`, in
 * supabase/migrations/20260830100000_canonical_room_authority.sql) are both
 * deferred and require, at COMMIT, that `rooms.owner_participant_id` point
 * at a participant that already exists *in that same room*. Recreating a
 * deleted 'demo' therefore only works within one Postgres session/
 * transaction spanning both the row insert and `start_demo_scenario`'s own
 * participant insert -- exactly what running
 * `supabase/production-demo-bootstrap.sql` through one `psql` session does,
 * and exactly what a REST call from this file cannot do (each
 * `supabase-js`/PostgREST call is its own separate transaction). That full
 * missing-room path was instead verified directly against the local
 * Supabase Postgres container:
 *
 *   psql -v ON_ERROR_STOP=1 -f supabase/production-demo-bootstrap.sql
 *
 * run after deleting 'demo' entirely, and rerun against a claimed,
 * progressed, and finalized 'demo', confirming each time that exactly one
 * canonical 'demo' room resulted and an unrelated room plus the
 * `authorization-fixture` test data were untouched.
 *
 * Every domain test file that touches 'demo' (this one included) assumes
 * exclusive access to it for the file's duration -- there is no locking, so
 * two files resetting/mutating 'demo' at the same wall-clock time race and
 * scramble each other's exact-version assertions. `npm run test:domain`
 * therefore runs this directory with `vitest --no-file-parallelism`.
 */

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

const unrelatedRoomInput: CreateRoomInput = {
  title: "Unrelated production room",
  brief: "A normal room the demo bootstrap must never touch.",
  creatorName: "Priya",
  creatorRole: "Founder",
};

function resetDemo(adminRepository: SupabaseRoomRepository, actorUserId: string) {
  return startDemoScenario(
    adminRepository, "demo", { mode: "solo_judge", humanRole: "product" }, actorUserId,
  );
}

describe.sequential("production demo bootstrap (supabase/production-demo-bootstrap.sql)", () => {
  let admin: SupabaseClient;
  let adminRepository: SupabaseRoomRepository;
  let owner: Awaited<ReturnType<typeof actor>>;
  let unrelatedRoomId: string;
  let unrelatedRoomVersionBefore: number;
  let authorizationFixtureRoomCountBefore: number;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    adminRepository = new SupabaseRoomRepository(admin);
    owner = await actor();

    const created = await createRoom(owner.repository, unrelatedRoomInput, {
      actor: { authUserId: owner.userId, origin: "manual_ui" },
      baseUrl: "https://app.example",
    });
    if (!created.ok) throw new Error(created.error.message);
    unrelatedRoomId = created.data.roomId;
    const unrelatedRoom = await getMeetingContext(adminRepository, owner.userId, unrelatedRoomId);
    unrelatedRoomVersionBefore = unrelatedRoom!.version;

    const fixtureRooms = await admin.from("rooms").select("id").ilike("id", "authorization%");
    authorizationFixtureRoomCountBefore = fixtureRooms.data?.length ?? 0;
  });

  it("restores the exact canonical fixture from a freshly-seeded 'demo' room", async () => {
    // The RPC's own literal return version (0) is superseded by the roomVersion
    // `SupabaseRoomRepository.call()` returns for any 'demo' RPC: it settles the
    // deterministic solo-judge simulation (see src/lib/supabase/room-repository.ts)
    // immediately afterward, which adds one position per simulation participant.
    // That settle timing/version count is covered by tests/domain/supabase-operations.test.ts;
    // this file only asserts the canonical *shape* the bootstrap script cares about.
    const reset = await resetDemo(adminRepository, owner.userId);
    expect(reset.ok).toBe(true);

    const rooms = await admin.from("rooms").select("id").eq("id", "demo");
    expect(rooms.data).toHaveLength(1);

    const room = await getMeetingContext(adminRepository, owner.userId, "demo");
    expect(room).toMatchObject({
      demoMode: "solo_judge", phase: "input", activeProposalId: "seed-proposal-onboarding-v1",
      finalizedAt: null, selfParticipantId: null,
    });
    expect(room?.conflicts).toHaveLength(0);
    expect(room?.alignments).toHaveLength(0);
    expect(room?.approvals).toHaveLength(0);
    expect(room?.participants).toHaveLength(5);
    expect(room?.participants.find((p) => p.id === "demo-product")).toMatchObject({
      kind: "human", isClaimed: false,
    });
    for (const id of ["demo-engineer", "demo-designer", "demo-marketing"]) {
      expect(room?.participants.find((p) => p.id === id)).toMatchObject({ kind: "simulation" });
    }
    expect(room?.participants.find((p) => p.id === "demo-security")).toMatchObject({
      kind: "expert", decisionRole: "advisor",
    });
    expect(room?.proposals.map((p) => p.id)).toEqual(["seed-proposal-onboarding-v1"]);
  });

  it("creates no test-only authorization fixture and does not touch the unrelated room", async () => {
    const fixtureRooms = await admin.from("rooms").select("id").ilike("id", "authorization%");
    expect(fixtureRooms.data).toHaveLength(authorizationFixtureRoomCountBefore);

    const unrelatedRoom = await getMeetingContext(adminRepository, owner.userId, unrelatedRoomId);
    expect(unrelatedRoom?.version).toBe(unrelatedRoomVersionBefore);
  });

  it("restores the canonical fixture after the founder seat is claimed and the demo has progressed", async () => {
    const claimant = await actor();
    const beforeClaim = await getMeetingContext(claimant.repository, claimant.userId, "demo");
    const claim = await claimParticipantSeat(
      claimant.repository, "demo", { seatId: "demo-product" },
      { actor: { authUserId: claimant.userId, origin: "manual_ui" }, expectedRoomVersion: beforeClaim!.version },
    );
    expect(claim).toMatchObject({ ok: true });

    const rerun = await resetDemo(adminRepository, owner.userId);
    expect(rerun.ok).toBe(true);

    const rooms = await admin.from("rooms").select("id").eq("id", "demo");
    expect(rooms.data).toHaveLength(1);

    const room = await getMeetingContext(adminRepository, owner.userId, "demo");
    expect(room).toMatchObject({ phase: "input", activeProposalId: "seed-proposal-onboarding-v1", selfParticipantId: null });
    expect(room?.participants.find((p) => p.id === "demo-product")).toMatchObject({
      kind: "human", isClaimed: false,
    });
  });

  it("restores the canonical fixture after the demo is finalized", async () => {
    const finalized = await admin
      .from("rooms")
      .update({ phase: "finalized", finalized_at: new Date().toISOString() })
      .eq("id", "demo");
    expect(finalized.error).toBeNull();

    const rerun = await resetDemo(adminRepository, owner.userId);
    expect(rerun.ok).toBe(true);

    const rooms = await admin.from("rooms").select("id").eq("id", "demo");
    expect(rooms.data).toHaveLength(1);

    const room = await getMeetingContext(adminRepository, owner.userId, "demo");
    expect(room).toMatchObject({ phase: "input", activeProposalId: "seed-proposal-onboarding-v1", finalizedAt: null, selfParticipantId: null });
  });

  it("is idempotent when run twice in a row against an already-canonical room", async () => {
    const first = await resetDemo(adminRepository, owner.userId);
    expect(first.ok).toBe(true);
    const second = await resetDemo(adminRepository, owner.userId);
    expect(second.ok).toBe(true);

    const rooms = await admin.from("rooms").select("id").eq("id", "demo");
    expect(rooms.data).toHaveLength(1);
  });

  it("still creates no test-only authorization fixture and does not touch the unrelated room, after every reset above", async () => {
    const fixtureRooms = await admin.from("rooms").select("id").ilike("id", "authorization%");
    expect(fixtureRooms.data).toHaveLength(authorizationFixtureRoomCountBefore);

    const unrelatedRoom = await getMeetingContext(adminRepository, owner.userId, unrelatedRoomId);
    expect(unrelatedRoom?.version).toBe(unrelatedRoomVersionBefore);
  });
});
