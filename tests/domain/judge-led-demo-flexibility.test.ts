import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  approveParticipantFinalDecision,
  claimParticipantSeat,
  expressMyAlignment,
  getFinalDecisionRecord,
  getMeetingContext,
  startDemoScenario,
  submitParticipantProposal,
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
 * `demo_revision_is_acceptable`) -- never a hardcoded proposal id. This
 * file proves that against real Postgres with a proposal that is
 * *materially different* from the one
 * `tests/domain/supabase-operations.test.ts`'s "runs an idempotent
 * solo-judge scenario" already exercises: that one deliberately triggers
 * every objection and needs the canned compromise revision; this one
 * deliberately triggers none of them and must sail straight through
 * Deliberation with zero blocking conflicts. Two structurally different
 * judge-authored proposals both completing the full protocol is exactly
 * the A7 exit gate.
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

describe.sequential("A7: a judge-created proposal that needs no compromise also completes the protocol", () => {
  let product: Actor;
  let demoAdminRepository: SupabaseRoomRepository;

  beforeAll(async () => {
    if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required.");
    demoAdminRepository = new SupabaseRoomRepository(
      createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    );
    product = await actor();
  });

  it("reaches Alignment with zero blocking conflicts, then finalizes, for a proposal matching none of the deterministic trigger patterns", async () => {
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
    let room = await getMeetingContext(product.repository, product.userId, "demo");
    expect(room?.phase).toBe("proposals");

    // Deliberately avoids every trigger phrase `demo_is_ambitious_proposal`,
    // `demo_needs_accessibility_objection`, and `demo_threatens_deadline`
    // look for -- no "rebuild"/"custom"/"multi-step" language, no deadline
    // language, reuses the existing auth model explicitly. A materially
    // different shape from the "ambitious rebuild + compromise" proposal
    // the sibling test in supabase-operations.test.ts exercises.
    const safeProposal = await submitParticipantProposal(
      product.repository, "demo",
      {
        title: "Two contextual tooltips on the current flow",
        summary: "Add two short contextual tooltips to the current onboarding flow, reusing the existing authentication and design system, keeping the current campaign timeline.",
        rationale: "A small, low-risk addition to the existing flow that does not require new engineering work or a scope change.",
        expectedOutcomes: ["Improve first-time completion"],
        referencedConstraintIds: [],
        parentProposalId: null,
      },
      context(product, position.roomVersion),
    );
    if (!safeProposal.ok) throw new Error(safeProposal.error.message);

    room = await getMeetingContext(product.repository, product.userId, "demo");
    // The deterministic scenario found nothing to object to in this
    // proposal's text and advanced straight through Deliberation into
    // Alignment within the same settle pass -- no engineer/designer/
    // marketing objection, no compromise revision needed.
    expect(room?.phase).toBe("voting");
    expect(room?.conflicts.filter((conflict) => conflict.status === "open")).toHaveLength(0);
    expect(room?.tradeoffs).toHaveLength(0);
    expect(room?.alignments.filter((alignment) => alignment.participantId !== "demo-product")).toHaveLength(3);
    expect(room?.alignments.every((alignment) => alignment.choice === "support")).toBe(true);

    const humanAlignment = await expressMyAlignment(
      product.repository, "demo",
      { proposalId: room!.activeProposalId!, choice: "support", comment: "Low risk, ship it." },
      context(product, safeProposal.roomVersion),
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
    expect(record.data.decision.proposal.title).toBe("Two contextual tooltips on the current flow");
    expect(record.data.decision.dissent).toEqual([]);
  });
});
