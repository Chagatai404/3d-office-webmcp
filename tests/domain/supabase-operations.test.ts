import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  advanceDemoRoomPhase,
  claimParticipantSeat,
  getMeetingContext,
  raiseParticipantObjection,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

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
    repository: new SupabaseRoomRepository(authenticatedClient),
  };
}

function context(userId: string, expectedRoomVersion: number): MutationContext {
  return { actor: { authUserId: userId, origin: "manual_ui" }, expectedRoomVersion };
}

describe.sequential("Supabase-backed room domain operations", () => {
  let engineer: Awaited<ReturnType<typeof anonymousActor>>;
  let designer: Awaited<ReturnType<typeof anonymousActor>>;
  let engineerConstraintId = "";
  let proposalId = "";

  beforeAll(async () => {
    engineer = await anonymousActor();
    designer = await anonymousActor();
  });

  it("rejects unauthenticated mutations before repository writes", async () => {
    const result = await claimParticipantSeat(
      engineer.repository,
      "demo",
      { seatId: "demo-engineer" },
      context("", 0),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 0 });
  });

  it("allows two anonymous sessions to claim different seats", async () => {
    const engineerClaim = await claimParticipantSeat(
      engineer.repository, "demo", { seatId: "demo-engineer" }, context(engineer.userId, 0),
    );
    expect(engineerClaim).toMatchObject({ ok: true, roomVersion: 1 });

    const isolationAttempt = await claimParticipantSeat(
      engineer.repository, "demo", { seatId: "demo-designer" }, context(engineer.userId, 1),
    );
    expect(isolationAttempt).toMatchObject({ ok: false, error: { code: "NOT_AUTHORIZED" }, roomVersion: 1 });

    const designerClaim = await claimParticipantSeat(
      designer.repository, "demo", { seatId: "demo-designer" }, context(designer.userId, 1),
    );
    expect(designerClaim).toMatchObject({ ok: true, roomVersion: 2 });

    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room?.selfParticipantId).toBe("demo-engineer");
    expect(room?.participants.find((participant) => participant.id === "demo-designer")?.isClaimed).toBe(true);
  });

  it("atomically creates a position, stable constraints, version, and audit event", async () => {
    const result = await addParticipantPosition(
      engineer.repository,
      "demo",
      {
        summary: "Ship a thin vertical slice using the existing auth flow.",
        category: "delivery",
        priority: "critical",
        constraints: [{ category: "capacity", text: "No authentication rewrite.", priority: "critical" }],
      },
      context(engineer.userId, 2),
    );
    expect(result).toMatchObject({ ok: true, roomVersion: 3 });
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    engineerConstraintId = room!.constraints.find((item) => item.text === "No authentication rewrite.")!.id;
    expect(engineerConstraintId).toBeTruthy();
    expect(room?.activity.at(-1)).toMatchObject({ action: "position.added", previousRoomVersion: 2, resultingRoomVersion: 3 });
  });

  it("rejects invalid input, stale writes, and wrong-phase writes without incrementing", async () => {
    const invalid = await addParticipantPosition(
      engineer.repository,
      "demo",
      { summary: "", category: null, priority: null, constraints: [] },
      context(engineer.userId, 3),
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 3 });

    const stale = await addParticipantPosition(
      engineer.repository,
      "demo",
      { summary: "Stale", category: null, priority: null, constraints: [] },
      context(engineer.userId, 2),
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "STALE_ROOM_STATE" }, roomVersion: 3 });

    const wrongPhase = await submitParticipantProposal(
      engineer.repository,
      "demo",
      { title: "Too early", summary: "Too early", rationale: "Too early", expectedOutcomes: [], referencedConstraintIds: [], parentProposalId: null },
      context(engineer.userId, 3),
    );
    expect(wrongPhase).toMatchObject({ ok: false, error: { code: "WRONG_PHASE" }, roomVersion: 3 });
  });

  it("rejects cross-room references and creates an authorized proposal", async () => {
    const advanced = await advanceDemoRoomPhase(
      engineer.repository, "demo", "proposals", context(engineer.userId, 3),
    );
    expect(advanced).toMatchObject({ ok: true, roomVersion: 4 });

    const crossRoom = await submitParticipantProposal(
      engineer.repository,
      "demo",
      {
        title: "Invalid reference", summary: "Invalid", rationale: "Invalid",
        expectedOutcomes: [], referencedConstraintIds: ["authorization-constraint"], parentProposalId: null,
      },
      context(engineer.userId, 4),
    );
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 4 });

    const created = await submitParticipantProposal(
      engineer.repository,
      "demo",
      {
        title: "Progressive onboarding hints",
        summary: "Add two accessible hints to the existing onboarding flow.",
        rationale: "Fits capacity without an auth rewrite.",
        expectedOutcomes: ["Faster first value"], referencedConstraintIds: [engineerConstraintId], parentProposalId: null,
      },
      context(engineer.userId, 4),
    );
    expect(created).toMatchObject({ ok: true, roomVersion: 5 });
    const room = await getMeetingContext(designer.repository, designer.userId, "demo");
    proposalId = room!.activeProposalId!;
    expect(room?.proposals.find((proposal) => proposal.id === proposalId)?.participantId).toBe("demo-engineer");
  });

  it("validates objection references and records the designer as actor", async () => {
    const advanced = await advanceDemoRoomPhase(
      designer.repository, "demo", "deliberation", context(designer.userId, 5),
    );
    expect(advanced).toMatchObject({ ok: true, roomVersion: 6 });

    const crossRoom = await raiseParticipantObjection(
      designer.repository,
      "demo",
      { proposalId: "authorization-proposal", constraintId: engineerConstraintId, reason: "Cross-room", severity: "blocking" },
      context(designer.userId, 6),
    );
    expect(crossRoom).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" }, roomVersion: 6 });

    const objection = await raiseParticipantObjection(
      designer.repository,
      "demo",
      { proposalId, constraintId: engineerConstraintId, reason: "The hint focus order needs accessibility review.", severity: "blocking" },
      context(designer.userId, 6),
    );
    expect(objection).toMatchObject({ ok: true, roomVersion: 7 });
    const room = await getMeetingContext(engineer.repository, engineer.userId, "demo");
    expect(room?.conflicts.at(-1)).toMatchObject({ raisedByActorId: "demo-designer", constraintId: engineerConstraintId });
    expect(room?.activity.at(-1)).toMatchObject({ action: "objection.raised", resultingRoomVersion: 7 });
  });

  it("does not expose or permit reads from an unrelated room", async () => {
    await expect(getMeetingContext(engineer.repository, engineer.userId, "authorization-fixture")).resolves.toBeNull();
  });
});
