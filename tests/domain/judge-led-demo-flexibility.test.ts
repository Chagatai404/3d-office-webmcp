import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  approveParticipantFinalDecision,
  claimParticipantSeat,
  expressMyAlignment,
  getFinalDecisionRecord,
  getMeetingContext,
  proposeParticipantTradeoff,
  startDemoScenario,
} from "@/domain/rooms/operations";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A7: judge-led demo behavior. `run_solo_demo_orchestration`
 * (`supabase/migrations/20260828190000_solo_demo_orchestration.sql`,
 * `.../20260830130000_alignment_and_decision_policy.sql`) reacts to the
 * *actual text* of whatever proposal is active via `demo_proposal_text` +
 * regex predicates (`demo_is_ambitious_proposal`,
 * `demo_needs_accessibility_objection`, `demo_threatens_deadline`,
 * `demo_revision_is_acceptable`) -- never a hardcoded proposal id.
 *
 * The seed proposal ('seed-proposal-onboarding-v1',
 * `.../20260831160000_demo_seed_proposal_activation.sql`) is active from the
 * moment the room enters Proposals, so a judge/agent can no longer sail an
 * unrelated root proposal straight through Deliberation -- the seed's own
 * ambitious text always triggers the Engineer's capacity objection first.
 * (The Designer's accessibility objection never fires against the seed
 * specifically: `demo_needs_accessibility_objection` requires the proposal
 * text NOT mention "accessib*", and the seed's own rationale already says
 * "...has not yet been reconciled with engineering capacity, accessibility,
 * or data-handling constraints" -- a quirk of the seed's own wording, not a
 * general rule; `tests/domain/supabase-operations.test.ts`'s differently
 * worded "ambitious rebuild" proposal does trigger both.) This file proves
 * the A7 exit gate a different way: a judge-authored *revision* of the seed,
 * whose text matches every phrase `demo_revision_is_acceptable` looks for
 * (reuses the existing auth model, reduced/incremental scope, holds the
 * campaign date, keeps accessibility, improves onboarding/first-value),
 * resolves the objection deterministically and completes the protocol.
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
  return { userId: data.user.id, repository: new SupabaseRoomRepository(client) };
}

type Actor = Awaited<ReturnType<typeof actor>>;
function context(session: Actor, expectedRoomVersion: number): MutationContext {
  return { actor: { authUserId: session.userId, origin: "manual_ui" }, expectedRoomVersion };
}

describe.sequential("A7: a judge-led revision that needs no further compromise also completes the protocol", () => {
  let product: Actor;
  let demoAdminRepository: SupabaseRoomRepository;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    demoAdminRepository = new SupabaseRoomRepository(
      createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    product = await actor();
  });

  it("resolves both auto-raised objections in one clean revision, then finalizes, for a revision matching every deterministic acceptance pattern", async () => {
    const reset = await startDemoScenario(
      demoAdminRepository, "demo", { mode: "solo_judge", humanRole: "product" }, product.userId,
    );
    if (!reset.ok) throw new Error(reset.error.message);

    const claim = await claimParticipantSeat(
      product.repository, "demo", { seatId: "demo-product" }, context(product, reset.roomVersion),
    );
    if (!claim.ok) throw new Error(claim.error.message);

    const position = await addParticipantPosition(
      product.repository, "demo",
      { summary: "Improve first-time completion without new engineering risk.", category: "outcome", priority: "high", constraints: [] },
      context(product, claim.roomVersion),
    );
    if (!position.ok) throw new Error(position.error.message);

    // The seed proposal is active the moment Proposals is entered, so the
    // settle pass triggered by this read cascades input -> proposals ->
    // deliberation and raises the Engineer's capacity objection against it in
    // the same pass. (Not the Designer's -- see the file docstring above.)
    let room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room?.phase).toBe("deliberation");
    expect(room?.activeProposalId).toBe("seed-proposal-onboarding-v1");
    const blockers = room!.conflicts.filter(
      (conflict) => conflict.status === "open" && conflict.severity === "blocking",
    );
    expect(blockers).toHaveLength(1);
    expect(blockers.map((conflict) => conflict.raisedByActorId)).toEqual(["demo-engineer"]);

    // Deliberately matches every phrase demo_revision_is_acceptable requires
    // (existing auth, reduced/incremental scope, the campaign launch date,
    // accessibility, onboarding/first-value) -- a materially different shape
    // from the "ambitious rebuild" the sibling test in
    // supabase-operations.test.ts exercises, and a materially different
    // *outcome* (fully resolved vs. one deliberate lingering warning) from
    // that same sibling test's revision.
    const safeRevision = await proposeParticipantTradeoff(
      product.repository, "demo",
      {
        conflictIds: blockers.map((conflict) => conflict.id),
        description: "Replace the AI-personalization scope with two contextual tooltips on the existing flow.",
        expectedEffect: "Removes every trigger pattern: no custom UI, reuses the existing authentication model with no auth rewrite, holds the campaign launch date, and keeps full keyboard/screen-reader accessibility.",
        revisedProposal: {
          title: "Two contextual tooltips on the existing flow",
          summary: "Add two short contextual tooltips to the existing onboarding flow, reusing the existing authentication model with no auth rewrite, holding the two-week campaign launch date, with full keyboard and screen-reader accessibility.",
          rationale: "A small, incremental addition to the existing flow that reuses the existing authentication model, needs no new engineering rework, keeps interaction patterns and accessibility unchanged, and holds the campaign launch date -- while still improving onboarding completion.",
          expectedOutcomes: ["Improve first-time completion"],
          referencedConstraintIds: [],
        },
      },
      context(product, position.roomVersion),
    );
    if (!safeRevision.ok) throw new Error(safeRevision.error.message);

    room = await getMeetingContext(product.repository, product.userId, "demo");
    // The revision's text satisfies demo_revision_is_acceptable, so the
    // settle pass resolves both simulated objections and advances straight
    // through the rest of Deliberation into Alignment within the same pass.
    expect(room?.phase).toBe("voting");
    expect(room?.conflicts.filter((conflict) => conflict.status === "open")).toHaveLength(0);
    expect(room?.alignments.filter((alignment) => alignment.participantId !== "demo-product")).toHaveLength(3);
    expect(room?.alignments.every((alignment) => alignment.choice === "support")).toBe(true);

    const humanAlignment = await expressMyAlignment(
      product.repository, "demo",
      { proposalId: room!.activeProposalId!, choice: "support", comment: "Low risk, ship it." },
      context(product, safeRevision.roomVersion),
    );
    if (!humanAlignment.ok) throw new Error(humanAlignment.error.message);
    room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room?.phase).toBe("approval");
    expect(room?.finalDecisionPreview?.requiredApprovalParticipantIds).toEqual(["demo-product"]);

    const decisionHash = room!.finalDecisionPreview!.decisionHash;
    const approval = await approveParticipantFinalDecision(
      product.repository, "demo", { decisionHash },
      { ...context(product, humanAlignment.roomVersion), humanConfirmed: true },
    );
    // The human confirmation gate is the same real gate every other room
    // uses -- the deterministic scenario never finalizes anything itself.
    expect(approval).toMatchObject({ ok: true });

    const record = await getFinalDecisionRecord(product.repository, product.userId, "demo");
    if (!record.ok) throw new Error("Final decision record unavailable.");
    expect(record.data.decision.proposal.title).toBe("Two contextual tooltips on the existing flow");
    expect(record.data.decision.dissent).toEqual([]);
  });
});
